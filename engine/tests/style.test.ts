import { describe, expect, it } from './kit.ts';
import {
  BREATH_PERIOD_MS,
  GLYPH_ASCII,
  PULSE,
  PULSE_ASCII,
  VOICE,
  breath,
  decorate,
} from '../src/style.ts';
import { translateBash } from '../src/rules/bash-rules.ts';
import { translateFileTool } from '../src/rules/file-rules.ts';
import { translateOutcome } from '../src/rules/outcome-rules.ts';
import type { Line, CodevibezEvent } from '../src/types.ts';

const busy: Line = {
  glyph: '→',
  stem: 'Checking everything still works…',
  text: 'Checking everything still works…',
  severity: 'info',
  tier: 'action',
  raw: 'npm test',
  id: 'bash.test',
};
const danger: Line = {
  glyph: '⚠',
  stem: "Deleting 'dist/' and everything inside it",
  text: "Deleting 'dist/' and everything inside it",
  severity: 'danger',
  tier: 'danger',
  raw: 'rm -rf dist/',
  id: 'bash.danger.delete',
};
const failure: Line = {
  glyph: '✗',
  stem: '3 of 42 checks failed',
  text: '3 of 42 checks failed',
  severity: 'failure',
  tier: 'action',
  raw: '',
  id: 'out.test.fail',
};

describe('decorate', () => {
  it('returns the original line when flair is off', () => {
    expect(decorate(busy, 'seed-1', 'off')).toEqual(busy);
  });

  it('adds a mood and breath phase with full flair', () => {
    const decorated = decorate(busy, 'seed-1', 'full', 0);
    expect(decorated.mood).toBe('busy');
    expect(typeof decorated.pulse).toBe('number');
    expect(decorated.text.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    expect(decorate(busy, 'abc', 'full')).toEqual(
      decorate(busy, 'abc', 'full'),
    );
  });

  it('selects more than one voice across seeds', () => {
    const voices = new Set(
      Array.from({ length: 40 }, (_, index) =>
        decorate(busy, `seed-${index}`, 'full').text,
      ),
    );
    expect(voices.size).toBeGreaterThan(1);
  });

  it('keeps minimal flair canonical and without a pulse', () => {
    const decorated = decorate(busy, 'seed-1', 'minimal', 500);
    expect(decorated.mood).toBe('busy');
    expect(decorated.pulse).toBeUndefined();
    expect(decorated.text).toBe(busy.text);
  });

  it('never changes danger or failure wording', () => {
    for (const line of [danger, failure]) {
      const decorated = decorate(line, 'seed-9', 'full', 500);
      expect(decorated.text).toBe(line.text);
      expect(decorated.stem).toBe(line.stem);
      expect(decorated.pulse).toBeUndefined();
    }
    expect(decorate(danger, 'seed-9', 'full').mood).toBe('alarm');
    expect(decorate(failure, 'seed-9', 'full').mood).toBe('oops');
  });

  it('leaves unknown template ids unchanged', () => {
    const line = { ...busy, id: 'unknown.template' };
    expect(decorate(line, 'seed', 'full').text).toBe(line.text);
  });

  it('never throws when a line has no id', () => {
    const { id: _id, ...line } = busy;
    expect(() => decorate(line, 'seed', 'full')).not.toThrow();
  });
});

describe('voice fact preservation', () => {
  const testPost: CodevibezEvent = {
    v: 1,
    ts: '2026-07-28T00:00:00Z',
    session: 's1',
    agent: 'claude-code',
    kind: 'tool.post',
    tool: 'Bash',
    raw: { command: 'npm ci' },
    outcome: { ok: true, stdout: 'added 312 packages' },
  };
  const lines = [
    translateBash('npm ci && npm test', 'plain'),
    translateFileTool(
      'Write',
      { file_path: 'new.ts', codevibez_exists: false },
      'plain',
    ),
    translateFileTool('Edit', { file_path: 'app.ts' }, 'plain'),
    translateOutcome(testPost, 'plain'),
  ].filter((line): line is Line => line !== null);

  it('reappends every facts suffix byte for byte for every seed', () => {
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line.facts).toMatch(/^\(.+\)$/);
      for (let seed = 0; seed < 80; seed += 1) {
        const decorated = decorate(line, `seed-${seed}`, 'full', seed * 137);
        expect(decorated.facts).toBe(line.facts);
        expect(decorated.text.endsWith(` ${line.facts}`)).toBe(true);
      }
    }
  });
});

describe('breath', () => {
  it('is a pure function of time', () => {
    expect(breath(1234)).toEqual(breath(1234));
  });

  it('walks the pulse alphabet across one period', () => {
    const step = BREATH_PERIOD_MS / PULSE.length;
    const seen = Array.from(
      { length: PULSE.length },
      (_, index) => breath(index * step + 1).glyph,
    );
    expect(seen).toEqual([...PULSE]);
  });

  it('repeats every period', () => {
    expect(breath(777)).toEqual(breath(777 + BREATH_PERIOD_MS));
  });

  it('stays within range and swells before receding', () => {
    expect(breath(0).intensity).toBeLessThan(
      breath(BREATH_PERIOD_MS / 2).intensity,
    );
    expect(breath(BREATH_PERIOD_MS - 1).intensity).toBeLessThan(
      breath(BREATH_PERIOD_MS / 2).intensity,
    );
    for (let time = 0; time < BREATH_PERIOD_MS; time += 37) {
      expect(breath(time).intensity).toBeGreaterThanOrEqual(0);
      expect(breath(time).intensity).toBeLessThanOrEqual(1);
    }
  });

  it('uses cosine easing', () => {
    const change = (from: number, to: number) =>
      Math.abs(breath(to).intensity - breath(from).intensity);
    const quarter = BREATH_PERIOD_MS / 4;
    expect(change(quarter - 30, quarter + 30)).toBeGreaterThan(
      change(2 * quarter - 30, 2 * quarter + 30),
    );
  });

  it('handles unusual finite and non-finite inputs', () => {
    for (const time of [
      0,
      -1,
      1e15,
      Number.MAX_SAFE_INTEGER,
      Number.NaN,
    ]) {
      expect(() => breath(time)).not.toThrow();
      expect(PULSE).toContain(breath(time).glyph);
    }
  });

  it('exports complete Unicode and ASCII glyph tables', () => {
    expect(PULSE).toHaveLength(8);
    expect(PULSE_ASCII).toHaveLength(8);
    expect(GLYPH_ASCII).toEqual({
      '→': '->',
      '✎': '*',
      '⚠': '!!',
      '✗': 'x',
      '✓': 'ok',
      '●': '#',
    });
  });

  it('keeps voice and glyph tables inside the approved vocabulary', () => {
    const semantic = new Set([...'→✎⚠✗✓●…·✢✳✻✽']);
    const check = (value: string) => {
      for (const character of value) {
        expect(
          character.codePointAt(0)! < 128 || semantic.has(character),
        ).toBe(true);
      }
    };

    for (const voice of Object.values(VOICE)) {
      check(voice.canonical);
      for (const variant of voice.variants) check(variant);
    }
    for (const value of Object.values(GLYPH_ASCII)) check(value);
    for (const value of PULSE) check(value);
    for (const value of PULSE_ASCII) check(value);
  });
});
