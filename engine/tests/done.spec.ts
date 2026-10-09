import { describe, expect, it } from 'vitest';
import { buildDoneCard } from '../src/done.ts';
import type { CodevibezEvent } from '../src/types.ts';

function event(partial: Partial<CodevibezEvent>): CodevibezEvent {
  return {
    v: 1,
    ts: '2026-07-28T00:00:00Z',
    session: 's1',
    agent: 'claude-code',
    kind: 'tool.pre',
    ...partial,
  } as CodevibezEvent;
}

describe('buildDoneCard', () => {
  it('builds the all-passing card from measured facts', () => {
    const card = buildDoneCard([
      event({ kind: 'prompt', text: 'add a login page' }),
      event({
        tool: 'Write',
        raw: { file_path: '/app/login.ts' },
      }),
      event({
        tool: 'Edit',
        raw: { file_path: '/app/server.ts' },
      }),
      event({
        kind: 'tool.post',
        tool: 'Bash',
        raw: { command: 'npm test' },
        outcome: { ok: true, stdout: 'Tests  42 passed (42)' },
      }),
      event({
        kind: 'agent.done',
        text: 'Added the login form. Connected it to authentication. Updated validation. Wrote extra notes.',
      }),
    ]);

    expect(card[0]).toMatchObject({
      glyph: '✓',
      text: 'Done',
      severity: 'success',
      mood: 'win',
    });
    expect(card[1]?.text).toBe('You asked: "add a login page"');
    expect(card.filter((line) => line.id === 'done.bullet')).toHaveLength(3);
    expect(card.at(-1)?.text).toBe(
      'Facts: 1 file new, 1 file updated, 42 checks passing',
    );
  });

  it('uses the exact failing-checks header from the last test outcome', () => {
    const card = buildDoneCard([
      event({ kind: 'prompt', text: 'fix the checks' }),
      event({
        kind: 'tool.post',
        tool: 'Bash',
        raw: { command: 'npm test' },
        outcome: {
          ok: true,
          stdout: 'Tests  3 failed | 39 passed (42)',
        },
      }),
      event({ kind: 'agent.done', text: 'Investigated the failing checks.' }),
    ]);
    expect(card[0]).toMatchObject({
      glyph: '⚠',
      text: 'finished, but 3 checks still failing',
      severity: 'failure',
    });
    expect(card.at(-1)?.text).toContain('3 of 42 checks failing');
  });

  it('singularizes a one-check failing card', () => {
    const card = buildDoneCard([
      event({ kind: 'prompt', text: 'fix one check' }),
      event({
        kind: 'tool.post',
        tool: 'Bash',
        raw: { command: 'npm test' },
        outcome: {
          ok: false,
          stdout: 'Tests  1 failed | 0 passed (1)',
        },
      }),
      event({ kind: 'agent.done', text: 'Investigated the check.' }),
    ]);

    expect(card[0]?.text).toBe(
      'finished, but 1 check is still failing',
    );
    expect(card.at(-1)?.text).toContain('1 of 1 check failing');
  });

  it('normalizes and caps the informational prompt row', () => {
    const card = buildDoneCard([
      event({
        kind: 'prompt',
        text: `  build\n\n${'a'.repeat(100)}  `,
      }),
      event({ kind: 'agent.done', text: 'Built it.' }),
    ]);
    const prompt = card.find((line) => line.id === 'done.prompt');

    expect(prompt).toMatchObject({ glyph: '→', tier: 'action' });
    expect(prompt?.text).not.toContain('\n');
    expect(prompt?.text).toBe(
      `You asked: "build ${'a'.repeat(73)}…"`,
    );
    for (const id of ['done.summary', 'done.bullet', 'done.facts']) {
      expect(card.find((line) => line.id === id)?.glyph).toBe('→');
    }
  });

  it('omits What was built when the summary is missing', () => {
    const card = buildDoneCard([
      event({ kind: 'prompt', text: 'inspect the project' }),
      event({
        tool: 'MultiEdit',
        raw: { file_path: '/app/server.ts' },
      }),
      event({ kind: 'agent.done' }),
    ]);
    expect(card.some((line) => line.text === 'What was built:')).toBe(false);
    expect(card.some((line) => line.id === 'done.bullet')).toBe(false);
    expect(card.at(-1)?.text).toBe(
      'Facts: 0 files new, 1 file updated, no checks recorded',
    );
  });

  it('counts distinct Write and updated paths', () => {
    const card = buildDoneCard([
      event({ tool: 'Write', raw: { file_path: '/app/a.ts' } }),
      event({
        kind: 'tool.post',
        tool: 'Write',
        raw: { file_path: '/app/a.ts' },
        outcome: { ok: true },
      }),
      event({ tool: 'Write', raw: { file_path: '/app/c.ts' } }),
      event({ tool: 'Edit', raw: { file_path: '/app/b.ts' } }),
      event({ tool: 'Edit', raw: { file_path: '/app/b.ts' } }),
    ]);
    expect(card.at(-1)?.text).toContain('2 files new, 1 file updated');
  });

  it('pairs the latest completion with its preceding prompt', () => {
    const card = buildDoneCard([
      event({ kind: 'prompt', text: 'build the first feature' }),
      event({ kind: 'agent.done', text: 'Built the first feature.' }),
      event({ kind: 'prompt', text: 'now build the second feature' }),
      event({ kind: 'agent.done', text: 'Built the second feature.' }),
    ]);

    expect(card.find((line) => line.id === 'done.prompt')?.text).toBe(
      'You asked: "now build the second feature"',
    );
    expect(card.find((line) => line.id === 'done.bullet')?.text).toBe(
      'Built the second feature.',
    );
  });

  it('measures facts only within the latest completed turn', () => {
    const card = buildDoneCard([
      event({ kind: 'prompt', text: 'build the first feature' }),
      event({ tool: 'Write', raw: { file_path: '/app/first.ts' } }),
      event({ tool: 'Edit', raw: { file_path: '/app/shared.ts' } }),
      event({ kind: 'agent.done', text: 'Built the first feature.' }),
      event({ kind: 'prompt', text: 'build the second feature' }),
      event({ tool: 'Write', raw: { file_path: '/app/second.ts' } }),
      event({
        kind: 'tool.post',
        tool: 'Bash',
        raw: { command: 'npm test' },
        outcome: { ok: true, stdout: 'Tests  7 passed (7)' },
      }),
      event({ kind: 'agent.done', text: 'Built the second feature.' }),
    ]);

    expect(card.at(-1)?.text).toBe(
      'Facts: 1 file new, 0 files updated, 7 checks passing',
    );
  });

  it('caps summary bullets at 100 characters without splitting a word', () => {
    const long =
      'Implemented a carefully structured authentication flow with validation messages and recovery guidance for every form state';
    const card = buildDoneCard([
      event({ kind: 'agent.done', text: `${long}.` }),
    ]);
    const bullet = card.find((line) => line.id === 'done.bullet');
    expect(bullet?.text.length).toBeLessThanOrEqual(100);
    expect(bullet?.text.endsWith('…')).toBe(true);
  });
});
