import { describe, expect, it } from './kit.ts';
import { groupReads } from '../src/group.ts';
import type { Level, Line } from '../src/types.ts';

function read(text: string, level: Level = 'plain'): Line {
  return {
    glyph: '→',
    text,
    severity: 'info',
    tier: 'read',
    raw: text,
    level,
  };
}

const action: Line = {
  glyph: '✎',
  text: 'Writing new code (1 new file)',
  severity: 'info',
  tier: 'action',
  raw: 'write',
  level: 'plain',
};

describe('groupReads', () => {
  it('collapses reads within the window with the right count', () => {
    const grouped = groupReads([
      { line: read('Looking at a.ts'), tMs: 0 },
      { line: read('Looking at b.ts'), tMs: 800 },
      { line: read('Looking at c.ts'), tMs: 1600 },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      glyph: '→',
      tier: 'read',
      stem: 'Getting familiar with your code',
      facts: '(3 actions)',
      text: 'Getting familiar with your code (3 actions)',
    });
  });

  it('uses developer wording for developer reads', () => {
    expect(
      groupReads([
        { line: read('Reading a.ts', 'developer'), tMs: 0 },
        { line: read('Reading b.ts', 'developer'), tMs: 500 },
      ])[0]?.text,
    ).toBe('Reading the code (2 actions)');
  });

  it('does not collapse reads spanning beyond the window', () => {
    const first = read('Looking at a.ts');
    const second = read('Looking at b.ts');
    expect(
      groupReads([
        { line: first, tMs: 0 },
        { line: second, tMs: 2500 },
      ]),
    ).toEqual([first, second]);
  });

  it('preserves interleaved actions and breaks read runs', () => {
    const first = read('Looking at a.ts');
    const second = read('Looking at b.ts');
    expect(
      groupReads([
        { line: first, tMs: 0 },
        { line: action, tMs: 200 },
        { line: second, tMs: 400 },
      ]),
    ).toEqual([first, action, second]);
  });
});
