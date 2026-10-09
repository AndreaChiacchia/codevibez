import type { Line } from './types.ts';
import { counted } from './words.ts';

export interface TimedLine {
  line: Line;
  tMs: number;
}

function groupedLine(run: TimedLine[]): Line {
  const first = run[0]?.line;
  const level = first?.level ?? 'plain';
  const stem =
    level === 'developer'
      ? 'Reading the code'
      : 'Getting familiar with your code';
  const facts = `(${counted(run.length, 'action')})`;
  return {
    glyph: '→',
    id: 'group.read',
    level,
    stem,
    facts,
    text: `${stem} ${facts}`,
    severity: 'info',
    tier: 'read',
    raw: run.map((item) => item.line.raw).join('\n'),
  };
}

export function groupReads(
  items: TimedLine[],
  windowMs = 2000,
): Line[] {
  const output: Line[] = [];
  let run: TimedLine[] = [];

  const flush = () => {
    if (run.length === 1) {
      const only = run[0];
      if (only !== undefined) output.push(only.line);
    } else if (run.length > 1) {
      output.push(groupedLine(run));
    }
    run = [];
  };

  for (const item of items) {
    if (item.line.tier !== 'read') {
      flush();
      output.push(item.line);
      continue;
    }

    const startedAt = run[0]?.tMs;
    if (
      startedAt !== undefined &&
      item.tMs - startedAt > windowMs
    ) {
      flush();
    }
    run.push(item);
  }

  flush();
  return output;
}
