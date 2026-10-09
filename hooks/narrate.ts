import { formatPrompt } from '../engine/src/prompt.ts';
import { translateBash } from '../engine/src/rules/bash-rules.ts';
import { translateFileTool } from '../engine/src/rules/file-rules.ts';
import { translateOutcome } from '../engine/src/rules/outcome-rules.ts';
import type { CodevibezEvent, Level, Line } from '../engine/src/types.ts';
import { counted, plural } from '../engine/src/words.ts';
import { redactSecrets } from './redact.ts';

/**
 * Turns one tool call, as a transcript row sees it, into plain English.
 *
 * Pure functions only: no `$`, no clock, no disk. The same row in gives the
 * same sentence out, which is what lets the hooks memoize them per call.
 */

const LEVEL: Level = 'plain';

export type Tone = 'info' | 'read' | 'success' | 'failure' | 'danger' | 'stopped';

export type Sentence = {
  glyph: string;
  text: string;
  tone: Tone;
};

export type Narration = {
  /** What the call does. */
  action: Sentence;
  /** What came of it, when there is something worth saying. */
  outcome?: Sentence;
};

/** A tool call as the `ToolUse` row and each call of a `ToolGroup` carry it. */
export type CallView = {
  tool: string;
  input: unknown;
  isRunning: boolean;
  isErrored: boolean;
  isInterrupted: boolean;
  output?: unknown;
};

type Input = Record<string, unknown>;

function isRecord(value: unknown): value is Input {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function quoted(value: string, limit = 60): string {
  return `"${formatPrompt(value, limit)}"`;
}

function sentence(glyph: string, words: string, tone: Tone): Sentence {
  return { glyph, text: redactSecrets(words), tone };
}

function fromLine(line: Line): Sentence {
  const tone: Tone =
    line.severity === 'danger'
      ? 'danger'
      : line.severity === 'failure'
        ? 'failure'
        : line.severity === 'success'
          ? 'success'
          : line.tier === 'read'
            ? 'read'
            : 'info';
  return sentence(line.glyph, line.text, tone);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function serviceOf(tool: string): { service: string; action: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (match === null) return null;
  const service = (match[1] ?? '').replace(/^plugin_[^_]+_/, '').replace(/[_-]+/g, ' ');
  const action = (match[2] ?? '').replace(/[_-]+/g, ' ');
  return service === '' || action === '' ? null : { service, action };
}

type Todo = { status?: unknown };

function todoCounts(todos: readonly Todo[]): string {
  const done = todos.filter((todo) => todo.status === 'completed').length;
  return `(${done} of ${counted(todos.length, 'item')} done)`;
}

/** What the call does, or null when the call is not one this mod knows. */
function describeAction(view: CallView): Sentence | null {
  const { tool, input } = view;
  if (!isRecord(input)) return null;

  switch (tool) {
    case 'Bash': {
      const command = text(input.command);
      if (command === null) return null;
      const line = fromLine(translateBash(command, LEVEL));
      return input.run_in_background === true
        ? { ...line, text: `${line.text} (in the background)` }
        : line;
    }

    case 'Read':
    case 'Edit':
    case 'MultiEdit': {
      if (text(input.file_path) === null) return null;
      const line = translateFileTool(tool, input, LEVEL);
      return line === null ? null : fromLine(line);
    }

    case 'Grep':
    case 'Glob': {
      if (text(input.pattern) === null) return null;
      const line = translateFileTool(tool, input, LEVEL);
      return line === null ? null : fromLine(line);
    }

    case 'Write': {
      if (text(input.file_path) === null) return null;
      // Whether this creates a file or replaces one is only known once it ran.
      const kind = isRecord(view.output) ? view.output.type : undefined;
      if (kind !== 'create' && kind !== 'update') {
        return sentence('✎', 'Writing code to a file', 'info');
      }
      const line = translateFileTool(
        'Write',
        { ...input, codevibez_exists: kind === 'update' },
        LEVEL,
      );
      return line === null ? null : fromLine(line);
    }

    case 'NotebookEdit': {
      if (text(input.notebook_path) === null) return null;
      if (input.edit_mode === 'delete') {
        return sentence('⚠', 'Deleting a section of a notebook', 'danger');
      }
      return input.edit_mode === 'insert'
        ? sentence('✎', 'Adding a section to a notebook', 'info')
        : sentence('✎', 'Updating a section of a notebook', 'info');
    }

    case 'WebFetch': {
      const url = text(input.url);
      if (url === null) return null;
      const host = hostOf(url);
      return sentence(
        '→',
        host === null ? 'Reading a web page' : `Reading a web page (${host})`,
        'read',
      );
    }

    case 'WebSearch': {
      const query = text(input.query);
      if (query === null) return null;
      return sentence('→', `Searching the web for ${quoted(query)}`, 'read');
    }

    case 'Agent':
    case 'Task': {
      const task = text(input.description) ?? text(input.prompt);
      if (task === null) return null;
      return sentence('→', `Handing a task to a helper: ${quoted(task)}`, 'info');
    }

    case 'TodoWrite': {
      if (!Array.isArray(input.todos)) return null;
      const todos = input.todos.filter(isRecord);
      return sentence('→', `Updating its to-do list ${todoCounts(todos)}`, 'read');
    }

    case 'TaskCreate': {
      const subject = text(input.subject);
      if (subject === null) return null;
      return sentence('→', `Adding a to-do: ${quoted(subject)}`, 'read');
    }

    case 'TaskUpdate': {
      if (text(input.taskId) === null) return null;
      const words =
        input.status === 'completed'
          ? 'Marking a to-do as done'
          : input.status === 'in_progress'
            ? 'Starting on a to-do'
            : input.status === 'deleted'
              ? 'Removing a to-do'
              : 'Updating a to-do';
      return sentence('→', words, 'read');
    }

    case 'TaskList':
    case 'TaskGet':
      return sentence('→', 'Checking its to-do list', 'read');

    case 'TaskStop':
      return sentence('→', 'Stopping a task running in the background', 'info');

    case 'Skill': {
      const skill = text(input.skill);
      if (skill === null) return null;
      return sentence('→', `Following a saved set of instructions (${skill})`, 'info');
    }

    case 'ToolSearch':
      return sentence('→', 'Looking for the right tool for the job', 'read');

    case 'AskUserQuestion':
      return sentence('→', 'Asking you a question', 'info');

    case 'EnterPlanMode':
      return sentence('→', 'Making a plan before changing anything', 'info');

    case 'ExitPlanMode':
      return sentence('→', 'Showing you its plan for approval', 'info');

    case 'LSP':
      return sentence('→', 'Checking how the code fits together', 'read');

    case 'Monitor':
      return sentence('→', 'Keeping an eye on something in the background', 'info');

    default: {
      const mcp = serviceOf(tool);
      if (mcp === null) return null;
      return sentence(
        '→',
        `Using the connected service "${mcp.service}" (${mcp.action})`,
        'info',
      );
    }
  }
}

const KNOWN_TOOLS = new Set([
  'Bash', 'Read', 'Edit', 'MultiEdit', 'Grep', 'Glob', 'Write', 'NotebookEdit',
  'WebFetch', 'WebSearch', 'Agent', 'Task', 'TodoWrite', 'TaskCreate', 'TaskUpdate',
  'TaskList', 'TaskGet', 'TaskStop', 'Skill', 'ToolSearch', 'AskUserQuestion',
  'EnterPlanMode', 'ExitPlanMode', 'LSP', 'Monitor',
]);

/** Whether this mod has English for the tool at all, judged by name alone. */
export function isKnownTool(tool: string): boolean {
  return KNOWN_TOOLS.has(tool) || serviceOf(tool) !== null;
}

/** The text a failed call handed back, whatever shape it came in. */
function errorText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (isRecord(output)) {
    for (const key of ['error', 'stderr', 'message', 'text']) {
      const value = output[key];
      if (typeof value === 'string' && value !== '') return value;
    }
  }
  if (Array.isArray(output)) {
    return output
      .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .join('\n');
  }
  return '';
}

function plainReason(error: string): string | null {
  if (/string to replace not found|old_string/i.test(error)) {
    return 'the text it meant to change was not there';
  }
  if (/has not been read|read it first/i.test(error)) {
    return 'it had not looked at the file first';
  }
  if (/does not exist|no such file|not found|enoent\b|cannot find/i.test(error)) {
    return 'something it needed could not be found';
  }
  if (/permission denied|eacces\b|eperm\b|not permitted/i.test(error)) {
    return 'it was not allowed to';
  }
  if (/timed? ?out\b|timeout/i.test(error)) return 'it took too long';
  if (/econnrefused\b|enotfound\b|network|fetch failed|unreachable/i.test(error)) {
    return 'the network could not be reached';
  }
  return null;
}

const FAILED_STEP: Readonly<Record<string, string>> = {
  Read: 'Could not open the file',
  Edit: 'Could not change the file',
  MultiEdit: 'Could not change the file',
  Write: 'Could not save the file',
  NotebookEdit: 'Could not change the notebook',
  Grep: 'The search failed',
  Glob: 'The search failed',
  WebFetch: 'Could not read the web page',
  WebSearch: 'The web search failed',
  Agent: 'The helper could not finish its task',
  Task: 'The helper could not finish its task',
};

function bashFailure(command: string, error: string): Sentence {
  const exit = /^\s*Exit code (\d+)\s*\n?/.exec(error);
  const exitCode = exit === null ? undefined : Number(exit[1]);
  const output = exit === null ? error : error.slice(exit[0].length);
  const event: CodevibezEvent = {
    v: 1,
    ts: '',
    session: '',
    agent: 'claude-code',
    kind: 'tool.post',
    tool: 'Bash',
    raw: { command },
    outcome: {
      ok: false,
      ...(exitCode === undefined ? {} : { exitCode }),
      stdout: output,
      stderr: '',
    },
  };
  const line = translateOutcome(event, LEVEL);
  if (line === null) {
    return sentence('✗', 'The command failed', 'failure');
  }
  // A test run's own line carries the exact counts; anything else gets the
  // exit code, which is the one number every failed command has.
  if (line.id === 'out.fail' && exitCode !== undefined) {
    return sentence('✗', `${line.stem ?? line.text} (exit code ${exitCode})`, 'failure');
  }
  return fromLine(line);
}

function describeFailure(view: CallView): Sentence {
  const error = errorText(view.output);
  if (/doesn't want to proceed|was rejected/i.test(error)) {
    return sentence('✗', 'Not run: you said no', 'failure');
  }
  if (/has been denied|permission to use .* (?:was|has been) denied/i.test(error)) {
    return sentence('✗', 'Not run: a permission rule blocked it', 'failure');
  }
  if (view.tool === 'Bash' && isRecord(view.input) && typeof view.input.command === 'string') {
    return bashFailure(view.input.command, error);
  }
  const step = FAILED_STEP[view.tool] ?? (serviceOf(view.tool) === null
    ? 'That step failed'
    : 'The connected service reported a failure');
  const reason = plainReason(error);
  const status = /status code (\d{3})/i.exec(error)?.[1];
  const words = [step, reason === null ? '' : `: ${reason}`, status === undefined ? '' : ` (error ${status})`].join('');
  return sentence('✗', words, 'failure');
}

/** What came of a finished call that did not fail, when it is worth a line. */
function describeSuccess(view: CallView): Sentence | undefined {
  const { tool, input, output } = view;
  if (tool === 'Bash' && isRecord(input) && typeof input.command === 'string' && isRecord(output)) {
    const event: CodevibezEvent = {
      v: 1,
      ts: '',
      session: '',
      agent: 'claude-code',
      kind: 'tool.post',
      tool: 'Bash',
      raw: { command: input.command },
      outcome: {
        ok: true,
        stdout: typeof output.stdout === 'string' ? output.stdout : '',
        stderr: typeof output.stderr === 'string' ? output.stderr : '',
      },
    };
    const line = translateOutcome(event, LEVEL);
    return line === null ? undefined : fromLine(line);
  }
  if (tool === 'WebFetch' && isRecord(output) && typeof output.code === 'number' && output.code >= 400) {
    const status = typeof output.codeText === 'string' && output.codeText !== ''
      ? `${output.code} ${output.codeText}`
      : String(output.code);
    return sentence('✗', `The web page answered with an error (${status})`, 'failure');
  }
  return undefined;
}

/**
 * The English for one call, or null when this mod does not know the tool or
 * the row's shape, so Claude Code draws its own row.
 */
export function describeCall(view: CallView): Narration | null {
  const action = describeAction(view);
  if (action === null) return null;
  if (view.isRunning) return { action };
  if (view.isInterrupted) {
    return { action, outcome: sentence('■', 'Stopped before it finished', 'stopped') };
  }
  if (view.isErrored) return { action, outcome: describeFailure(view) };
  const outcome = describeSuccess(view);
  return outcome === undefined ? { action } : { action, outcome };
}

type GroupCall = CallView;

const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'ToolSearch']);

/**
 * One line for a run of calls Claude Code folds together (reads, searches,
 * listings), with every failure and every destructive step spelled out.
 */
export function describeGroup(calls: readonly GroupCall[]): Narration[] | null {
  if (calls.length === 0) return null;
  const described = calls.map((call) => ({ call, narration: describeCall(call) }));
  if (described.some((item) => item.narration === null)) return null;

  let files = 0;
  let searches = 0;
  let commands = 0;
  let pages = 0;
  let other = 0;
  for (const { call } of described) {
    if (call.tool === 'Read') files += 1;
    else if (SEARCH_TOOLS.has(call.tool)) searches += 1;
    else if (call.tool === 'Bash') commands += 1;
    else if (call.tool === 'WebFetch') pages += 1;
    else other += 1;
  }
  const parts = [
    files > 0 ? `${counted(files, 'file')} read` : '',
    searches > 0 ? counted(searches, 'search', 'searches') : '',
    commands > 0 ? counted(commands, 'command') : '',
    pages > 0 ? `${counted(pages, 'web page')} read` : '',
    other > 0 ? counted(other, 'other step') : '',
  ].filter((part) => part !== '');

  const lines: Narration[] = [
    {
      action: sentence('→', `Getting familiar with your code (${parts.join(', ')})`, 'read'),
    },
  ];

  // Anything that is not routine is never folded into the count line.
  for (const { narration } of described) {
    if (narration === null) continue;
    if (narration.action.tone === 'danger') lines.push({ action: narration.action });
  }
  const failed = described.filter(
    (item) => item.narration?.outcome?.tone === 'failure',
  );
  if (failed.length > 0) {
    const first = failed[0]?.narration?.outcome;
    const total = described.length;
    const head = `${failed.length} of ${total} ${plural(total, 'step')} failed`;
    lines.push({
      action: sentence(
        '✗',
        failed.length === 1 && first !== undefined ? `${head}: ${first.text}` : head,
        'failure',
      ),
    });
  }
  const stopped = described.filter((item) => item.narration?.outcome?.tone === 'stopped').length;
  if (stopped > 0) {
    lines.push({
      action: sentence('■', `${counted(stopped, 'step')} stopped before finishing`, 'stopped'),
    });
  }
  return lines;
}
