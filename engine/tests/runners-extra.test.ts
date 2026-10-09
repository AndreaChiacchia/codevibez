import { describe, expect, it } from './kit.ts';

import { isTestCommand } from '../src/rules/bash-rules.ts';
import { parseTestCounts, translateOutcome } from '../src/rules/outcome-rules.ts';
import type { CodevibezEvent } from '../src/types.ts';

// Test runners added after the engine was vendored (see engine/PROVENANCE.md):
// Node's and Deno's built-in runners and Python's unittest, which need nothing
// installed and so are what a fresh project often uses.
function failed(command: string, output: string): CodevibezEvent {
  return {
    v: 1,
    ts: '',
    session: '',
    agent: 'claude-code',
    kind: 'tool.post',
    tool: 'Bash',
    raw: { command },
    outcome: { ok: false, exitCode: 1, stdout: output, stderr: '' },
  };
}

const NODE_TAP = [
  'not ok 2 - multiply',
  '1..2',
  '# tests 2',
  '# suites 0',
  '# pass 1',
  '# fail 1',
  '# cancelled 0',
  '# skipped 0',
].join('\n');

const NODE_SPEC = ['ℹ tests 12', 'ℹ suites 0', 'ℹ pass 9', 'ℹ fail 3', 'ℹ cancelled 0'].join('\n');

describe('built-in test runners', () => {
  it('knows node --test, deno test and python -m unittest or pytest', () => {
    expect(isTestCommand('node --test')).toBe(true);
    expect(isTestCommand('node --test test/')).toBe(true);
    expect(isTestCommand('deno test')).toBe(true);
    expect(isTestCommand('python3 -m unittest')).toBe(true);
    expect(isTestCommand('python -m pytest -q')).toBe(true);
    expect(isTestCommand('node server.js')).toBe(false);
    expect(isTestCommand('python3 -m http.server')).toBe(false);
  });

  it("reads Node's TAP and spec summaries", () => {
    expect(parseTestCounts(NODE_TAP)).toEqual({ failed: 1, passed: 1 });
    expect(parseTestCounts(NODE_SPEC)).toEqual({ failed: 3, passed: 9 });
  });

  it("reads Python's unittest summary", () => {
    expect(parseTestCounts('Ran 3 tests in 0.001s\n\nFAILED (failures=1)')).toEqual({ failed: 1, passed: 2 });
    expect(parseTestCounts('Ran 5 tests in 0.1s\n\nFAILED (failures=1, errors=1, skipped=1)')).toEqual({
      failed: 2,
      passed: 2,
    });
    expect(parseTestCounts('Ran 4 tests in 0.000s\n\nOK')).toEqual({ failed: 0, passed: 4 });
  });

  it('says exactly how many checks failed', () => {
    expect(translateOutcome(failed('node --test', NODE_TAP), 'plain')?.text).toBe('1 of 2 checks failed');
    expect(
      translateOutcome(failed('python3 -m unittest', 'Ran 3 tests in 0.001s\n\nFAILED (failures=1)'), 'plain')?.text,
    ).toBe('1 of 3 checks failed');
  });
});
