import { detectDanger } from '../engine/src/bash.ts';
import { isTestCommand } from '../engine/src/rules/bash-rules.ts';
import { parseTestCounts } from '../engine/src/rules/outcome-rules.ts';
import { counted, plural } from '../engine/src/words.ts';
import { isDeclined } from './narrate.ts';

/**
 * What one turn changed, kept in memory only and counted exactly, so the line
 * under the answer can say it in plain words. Nothing here touches the disk.
 */
export type Ledger = {
  created: Set<string>;
  changed: Set<string>;
  deleted: Set<string>;
  commands: number;
  failedCommands: number;
  failedSteps: number;
  declined: number;
  destructive: number;
  tests: TestRun | null;
};

type TestRun =
  | { kind: 'counted'; failed: number; passed: number }
  | { kind: 'failed' }
  | { kind: 'passed' };

/** A finished call as `tool.call` saw it: the tool, its input, its result. */
export type FinishedCall = {
  tool: string;
  input: Record<string, unknown>;
  isError: boolean;
  isDenied: boolean;
  result: unknown;
  text: string;
};

export function createLedger(): Ledger {
  return {
    created: new Set(),
    changed: new Set(),
    deleted: new Set(),
    commands: 0,
    failedCommands: 0,
    failedSteps: 0,
    declined: 0,
    destructive: 0,
    tests: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function touched(ledger: Ledger, path: unknown): void {
  if (typeof path !== 'string' || path === '') return;
  if (!ledger.created.has(path)) ledger.changed.add(path);
}

function testRun(output: string, ok: boolean): TestRun {
  const counts = parseTestCounts(output);
  if (counts !== null) return { kind: 'counted', ...counts };
  return ok ? { kind: 'passed' } : { kind: 'failed' };
}

/** Records one finished call. Never throws on a shape it does not expect. */
export function observe(ledger: Ledger, call: FinishedCall): void {
  if (call.isDenied) return;
  const { tool, input, result } = call;
  // A step the person said no to never ran: not a command, not a failure.
  if (call.isError && isDeclined(call.text || (typeof result === 'string' ? result : ''))) {
    ledger.declined += 1;
    return;
  }

  if (tool === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    ledger.commands += 1;
    if (call.isError) ledger.failedCommands += 1;
    if (command !== '' && detectDanger(command) !== null) ledger.destructive += 1;
    if (command !== '' && isTestCommand(command)) {
      const output = isRecord(result)
        ? `${typeof result.stdout === 'string' ? result.stdout : ''}\n${
            typeof result.stderr === 'string' ? result.stderr : ''
          }`
        : call.text;
      ledger.tests = testRun(output, !call.isError);
    }
    const diff = isRecord(result) ? result.bashEditDiff : undefined;
    if (isRecord(diff) && Array.isArray(diff.files)) {
      for (const file of diff.files) {
        if (!isRecord(file) || typeof file.filePath !== 'string') continue;
        if (file.deleted === true) ledger.deleted.add(file.filePath);
        else if (file.created === true) ledger.created.add(file.filePath);
        else touched(ledger, file.filePath);
      }
    }
    return;
  }

  if (call.isError) {
    ledger.failedSteps += 1;
    return;
  }

  if (tool === 'Write' && isRecord(result)) {
    const path = typeof result.filePath === 'string' ? result.filePath : input.file_path;
    if (result.type === 'create' && typeof path === 'string') ledger.created.add(path);
    else touched(ledger, path);
  } else if (tool === 'Edit' || tool === 'MultiEdit') {
    touched(ledger, input.file_path);
  } else if (tool === 'NotebookEdit') {
    touched(ledger, input.notebook_path);
    if (input.edit_mode === 'delete') ledger.destructive += 1;
  }
}

function testWords(run: TestRun): string {
  if (run.kind === 'counted') {
    const total = run.failed + run.passed;
    return run.failed > 0
      ? `${run.failed} of ${total} ${plural(total, 'check')} failed`
      : `all ${counted(run.passed, 'check')} passed`;
  }
  return run.kind === 'failed'
    ? 'the checks failed (codevibez could not read how many)'
    : 'the checks passed';
}

export type Summary = {
  glyph: string;
  text: string;
  tone: 'info' | 'failure' | 'danger';
};

/**
 * One plain line for the turn, or null when nothing changed and nothing ran.
 */
export function summarize(ledger: Ledger): Summary | null {
  const parts: string[] = [];
  const files = ledger.created.size + ledger.changed.size;
  if (files > 0) {
    parts.push(
      ledger.created.size > 0
        ? `changed ${counted(files, 'file')} (${ledger.created.size} new)`
        : `changed ${counted(files, 'file')}`,
    );
  }
  if (ledger.deleted.size > 0) parts.push(`deleted ${counted(ledger.deleted.size, 'file')}`);
  if (ledger.commands > 0) {
    parts.push(
      ledger.failedCommands > 0
        ? `ran ${counted(ledger.commands, 'command')} (${ledger.failedCommands} failed)`
        : `ran ${counted(ledger.commands, 'command')}`,
    );
  }
  if (ledger.tests !== null) parts.push(testWords(ledger.tests));
  if (ledger.failedSteps > 0) {
    parts.push(`${counted(ledger.failedSteps, 'other step')} failed`);
  }
  if (ledger.destructive > 0) {
    parts.push(`${counted(ledger.destructive, 'destructive step')}`);
  }
  if (ledger.declined > 0) {
    parts.push(`you said no to ${counted(ledger.declined, 'step')}`);
  }
  if (parts.length === 0) return null;

  const failed =
    ledger.failedCommands > 0 ||
    ledger.failedSteps > 0 ||
    (ledger.tests?.kind === 'counted' && ledger.tests.failed > 0) ||
    ledger.tests?.kind === 'failed';
  const text = `This turn: ${parts.join(', ')}.`;
  if (failed) return { glyph: '✗', text, tone: 'failure' };
  if (ledger.destructive > 0) return { glyph: '⚠', text, tone: 'danger' };
  return { glyph: '●', text, tone: 'info' };
}
