import { describe, expect, it } from 'vitest';
import { parseEvent } from '../src/event.ts';

const valid = {
  v: 1,
  ts: '2026-07-27T00:00:00Z',
  session: 's1',
  agent: 'claude-code',
  kind: 'tool.pre',
  tool: 'Bash',
  raw: { command: 'ls' },
} as const;

describe('parseEvent', () => {
  it('parses a complete v1 event', () => {
    expect(parseEvent(JSON.stringify(valid))).toEqual(valid);
  });

  it('preserves the canonical outcome fields', () => {
    const event = {
      ...valid,
      kind: 'tool.post',
      outcome: {
        ok: false,
        exitCode: 1,
        stdout: 'output',
        stderr: 'failure',
      },
    };

    expect(parseEvent(JSON.stringify(event))?.outcome).toEqual(event.outcome);
  });

  it('preserves text for prompt and agent.done records', () => {
    for (const kind of ['prompt', 'agent.done'] as const) {
      const event = { ...valid, kind, text: 'verbatim text' };
      expect(parseEvent(JSON.stringify(event))?.text).toBe('verbatim text');
    }
  });

  it('returns null for corrupt JSON and non-object input', () => {
    expect(parseEvent('{oops')).toBeNull();
    expect(parseEvent('"just a string"')).toBeNull();
  });

  it('returns null for an unrecognized version or kind', () => {
    expect(parseEvent(JSON.stringify({ ...valid, v: 2 }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...valid, kind: 'weird' }))).toBeNull();
  });

  it.each(['ts', 'session', 'agent'] as const)(
    'returns null when required field %s is missing',
    (field) => {
      const event: Record<string, unknown> = { ...valid };
      delete event[field];
      expect(parseEvent(JSON.stringify(event))).toBeNull();
    },
  );

  it('returns null for an unsupported agent', () => {
    expect(
      parseEvent(JSON.stringify({ ...valid, agent: 'other-agent' })),
    ).toBeNull();
  });

  it.each([
    { ok: 'yes' },
    { ok: true, stdout: 5 },
    { ok: true, stderr: [] },
    { ok: true, exitCode: '1' },
  ])('returns null for malformed outcome %#', (outcome) => {
    expect(
      parseEvent(
        JSON.stringify({ ...valid, kind: 'tool.post', outcome }),
      ),
    ).toBeNull();
  });

  it('returns null for array raw input and non-string optional fields', () => {
    expect(
      parseEvent(JSON.stringify({ ...valid, raw: ['ls'] })),
    ).toBeNull();
    expect(
      parseEvent(JSON.stringify({ ...valid, tool: 42 })),
    ).toBeNull();
    expect(
      parseEvent(JSON.stringify({ ...valid, text: {} })),
    ).toBeNull();
  });
});
