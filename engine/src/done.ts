import { isTestCommand } from './rules/bash-rules.ts';
import { parseTestCounts } from './rules/outcome-rules.ts';
import { formatPrompt } from './prompt.ts';
import { counted, plural } from './words.ts';
import type {
  Line,
  CodevibezEvent,
  CodevibezOutcome,
} from './types.ts';

interface TestResult {
  outcome: CodevibezOutcome;
  output: string;
}

function rawRecord(event: CodevibezEvent): Record<string, unknown> {
  return event.raw ?? {};
}

function lastTestResult(events: CodevibezEvent[]): TestResult | null {
  let latest: TestResult | null = null;
  for (const event of events) {
    if (event.kind !== 'tool.post' || event.outcome === undefined) {
      continue;
    }
    const command = rawRecord(event).command;
    if (typeof command !== 'string' || !isTestCommand(command)) continue;
    latest = {
      outcome: event.outcome,
      output: `${event.outcome.stdout ?? ''}\n${
        event.outcome.stderr ?? ''
      }`,
    };
  }
  return latest;
}

function cardLine(
  glyph: Line['glyph'],
  text: string,
  id: string,
  severity: Line['severity'] = 'info',
): Line {
  return {
    glyph,
    id,
    stem: text,
    text,
    severity,
    tier: 'action',
    raw: '',
  };
}

function header(result: TestResult | null): Line {
  const counts =
    result === null ? null : parseTestCounts(result.output);
  if (counts !== null && counts.failed > 0) {
    const status =
      counts.failed === 1
        ? '1 check is still failing'
        : `${counts.failed} checks still failing`;
    return {
      ...cardLine(
        '⚠',
        `finished, but ${status}`,
        'done.header.fail',
        'failure',
      ),
      mood: 'oops',
    };
  }
  if (result !== null && result.outcome.ok !== true && counts === null) {
    return {
      ...cardLine(
        '⚠',
        'finished, but checks are still failing',
        'done.header.fail',
        'failure',
      ),
      mood: 'oops',
    };
  }
  return {
    ...cardLine('✓', 'Done', 'done.header.ok', 'success'),
    mood: 'win',
  };
}

function shorten(text: string): string {
  if (text.length <= 100) return text;
  const candidate = text.slice(0, 99);
  const boundary = candidate.lastIndexOf(' ');
  const shortened = boundary >= 60 ? candidate.slice(0, boundary) : candidate;
  return `${shortened.trimEnd()}…`;
}

function summaryBullets(text: string): string[] {
  const pieces: string[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const cleaned = line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .trim();
    if (cleaned === '') continue;
    for (const sentence of cleaned.split(/(?<=[.!?])\s+/)) {
      const value = sentence.trim();
      if (value !== '') pieces.push(shorten(value));
    }
  }
  return pieces.slice(0, 3);
}

function currentTurn(events: CodevibezEvent[]): {
  events: CodevibezEvent[];
  completion: CodevibezEvent | undefined;
} {
  let completionIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.kind === 'agent.done') {
      completionIndex = index;
      break;
    }
  }

  const end = completionIndex < 0 ? events.length : completionIndex + 1;
  let start = 0;
  for (let index = completionIndex - 1; index >= 0; index -= 1) {
    if (events[index]?.kind === 'agent.done') {
      start = index + 1;
      break;
    }
  }

  return {
    events: events.slice(start, end),
    completion:
      completionIndex < 0 ? undefined : events[completionIndex],
  };
}

function facts(events: CodevibezEvent[], result: TestResult | null): string {
  const created = new Set<string>();
  const updated = new Set<string>();

  for (const event of events) {
    if (event.kind !== 'tool.pre' && event.kind !== 'tool.post') continue;
    const path = rawRecord(event).file_path;
    if (event.tool === 'Write' && typeof path === 'string') {
      created.add(path);
    }
    if (
      (event.tool === 'Edit' || event.tool === 'MultiEdit') &&
      typeof path === 'string'
    ) {
      updated.add(path);
    }
  }

  let checks = 'no checks recorded';
  if (result !== null) {
    const counts = parseTestCounts(result.output);
    if (counts !== null && counts.failed > 0) {
      const total = counts.failed + counts.passed;
      checks = `${counts.failed} of ${total} ${plural(
        total,
        'check',
      )} failing`;
    } else if (counts !== null) {
      checks = `${counted(counts.passed, 'check')} passing`;
    } else {
      checks =
        result.outcome.ok === true
          ? 'checks passing'
          : 'checks failed, count unavailable';
    }
  }

  return `${counted(created.size, 'file')} new, ${counted(
    updated.size,
    'file',
  )} updated, ${checks}`;
}

export function buildDoneCard(events: CodevibezEvent[]): Line[] {
  const turn = currentTurn(events);
  const result = lastTestResult(turn.events);
  const output: Line[] = [header(result)];
  const prompt = [...turn.events]
    .reverse()
    .find(
      (event) =>
        event.kind === 'prompt' && typeof event.text === 'string',
    );
  if (prompt?.text !== undefined) {
    output.push(
      cardLine(
        '→',
        `You asked: "${formatPrompt(prompt.text)}"`,
        'done.prompt',
      ),
    );
  }

  const summary = turn.completion?.text;
  if (typeof summary === 'string' && summary.trim() !== '') {
    const bullets = summaryBullets(summary);
    if (bullets.length > 0) {
      output.push(cardLine('→', 'What was built:', 'done.summary'));
      for (const bullet of bullets) {
        output.push(cardLine('→', bullet, 'done.bullet'));
      }
    }
  }

  output.push(
    cardLine(
      '→',
      `Facts: ${facts(turn.events, result)}`,
      'done.facts',
    ),
  );
  return output;
}
