import { describe, expect, it } from './kit.ts';
import { translate } from '../src/translate.ts';
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

describe('translate dispatcher', () => {
  it('renders a prompt chapter with verbatim words', () => {
    const line = translate(
      event({
        kind: 'prompt',
        text: 'stop people from spamming my API',
      }),
      'plain',
    );
    expect(line).toMatchObject({
      glyph: '●',
      text: 'Working on: "stop people from spamming my API"',
    });
  });

  it('truncates prompt content at 80 characters', () => {
    const line = translate(
      event({ kind: 'prompt', text: 'x'.repeat(200) }),
      'plain',
    );
    expect(line?.text.endsWith('…"')).toBe(true);
    expect(line?.text).toHaveLength(94);
  });

  it('routes Bash calls and their count hints to bash rules', () => {
    const line = translate(
      event({
        tool: 'Bash',
        raw: {
          command: 'rm -rf dist/',
          hint: { count: 14, cap: false },
        },
      }),
      'plain',
    );
    expect(line?.text).toBe("Deleting 'dist/' and the 14 items inside it");
  });

  it('routes file calls to file rules', () => {
    expect(
      translate(
        event({ tool: 'Read', raw: { file_path: 'src/app.ts' } }),
        'plain',
      )?.tier,
    ).toBe('read');
  });

  it('hides unknown tool names at plain level', () => {
    const line = translate(
      event({ tool: 'SomeNewTool', raw: {} }),
      'plain',
    );
    expect(line).toMatchObject({
      glyph: '→',
      text: 'Using one of its built-in tools',
      generic: true,
    });
    expect(line?.text).not.toContain('SomeNewTool');
  });

  it('keeps unknown tool names at developer level', () => {
    expect(
      translate(
        event({ tool: 'SomeNewTool', raw: {} }),
        'developer',
      )?.text,
    ).toBe('Doing something with a helper tool (SomeNewTool)');
  });

  it('returns explicit null for staged kinds', () => {
    expect(
      translate(event({ kind: 'tool.post', outcome: { ok: true } }), 'plain'),
    ).toBeNull();
    expect(
      translate(event({ kind: 'agent.done', text: 'summary' }), 'plain'),
    ).toBeNull();
  });

  it('returns null for a runtime event kind outside the union', () => {
    const unknown = {
      ...event({}),
      kind: 'future.kind',
    } as unknown as CodevibezEvent;
    expect(translate(unknown, 'plain')).toBeNull();
  });

  it('still returns a generic line for malformed tool input', () => {
    const malformed = event({
      tool: 'Bash',
      raw: { command: 42 },
    });
    expect(translate(malformed, 'plain')).toMatchObject({
      text: 'Using one of its built-in tools',
      generic: true,
    });
  });
});

describe('translate totality', () => {
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pool: unknown[] = [
    undefined,
    null,
    '',
    'x',
    0,
    -1,
    [],
    {},
    { command: 42 },
    { file_path: null },
    'rm -rf /',
  ];
  const pick = () => pool[Math.floor(random() * pool.length)];

  it('never throws for 1000 seeded junk events', () => {
    const kinds = ['prompt', 'tool.pre', 'tool.post', 'agent.done'] as const;
    const tools = [
      'Bash',
      'Edit',
      'Write',
      'Read',
      'Grep',
      'Zzz',
      undefined,
    ];

    for (let index = 0; index < 1000; index += 1) {
      const junk = event({
        kind: kinds[index % kinds.length] ?? 'tool.pre',
        tool: tools[index % tools.length],
        raw: pick() as never,
        text: pick() as never,
        outcome: pick() as never,
      });
      const result = translate(
        junk,
        index % 2 === 0 ? 'developer' : 'plain',
      );
      expect(
        result === null ||
          (typeof result === 'object' &&
            typeof result.text === 'string' &&
            typeof result.glyph === 'string'),
      ).toBe(true);
    }
  });
});
