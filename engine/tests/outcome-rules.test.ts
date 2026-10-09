import { describe, expect, it } from './kit.ts';
import {
  parseTestCounts,
  translateOutcome,
} from '../src/rules/outcome-rules.ts';
import type { CodevibezEvent } from '../src/types.ts';

function post(
  command: string,
  ok: boolean,
  stdout = '',
  stderr = '',
): CodevibezEvent {
  return {
    v: 1,
    ts: '2026-07-28T00:00:00Z',
    session: 's1',
    agent: 'claude-code',
    kind: 'tool.post',
    tool: 'Bash',
    raw: { command },
    outcome: { ok, stdout, stderr },
  };
}

describe('translateOutcome test results', () => {
  it('renders vitest failure counts', () => {
    expect(
      translateOutcome(
        post(
          'npx vitest run',
          false,
          'Tests  3 failed | 39 passed (42)',
        ),
        'plain',
      ),
    ).toMatchObject({
      glyph: '✗',
      severity: 'failure',
      text: '3 of 42 checks failed',
    });
  });

  it('lets parsed failures override outcome ok', () => {
    expect(
      translateOutcome(
        post(
          'npx vitest run',
          true,
          'Tests  3 failed | 39 passed (42)',
        ),
        'plain',
      ),
    ).toMatchObject({
      glyph: '✗',
      severity: 'failure',
      text: '3 of 42 checks failed',
    });
  });

  it('uses developer test vocabulary for counted failures', () => {
    expect(
      translateOutcome(
        post(
          'npx vitest run',
          false,
          'Tests  1 failed | 0 passed (1)',
        ),
        'developer',
      )?.text,
    ).toBe('1 of 1 test failed');
    expect(
      translateOutcome(
        post(
          'npx vitest run',
          false,
          'Tests  3 failed | 39 passed (42)',
        ),
        'developer',
      )?.text,
    ).toBe('3 of 42 tests failed');
  });

  it('renders successful test counts as structured facts', () => {
    expect(
      translateOutcome(
        post('npm test', true, 'Tests  42 passed (42)'),
        'plain',
      ),
    ).toMatchObject({
      glyph: '✓',
      severity: 'success',
      stem: 'All checks pass',
      facts: '(42 checks)',
      text: 'All checks pass (42 checks)',
    });
  });

  it('singularizes a successful test count fact', () => {
    expect(
      translateOutcome(
        post('npm test', true, 'Tests  1 passed (1)'),
        'plain',
      )?.facts,
    ).toBe('(1 check)');
  });

  it('never trusts a passed-only parse when outcome ok is false', () => {
    expect(
      translateOutcome(
        post('mocha', false, '42 passing (10ms)'),
        'plain',
      ),
    ).toMatchObject({
      glyph: '✗',
      severity: 'failure',
      text: 'The checks failed; codevibez could not read how many',
    });
  });

  it('parses pytest and mocha counts', () => {
    expect(
      translateOutcome(
        post('pytest', false, '3 failed, 39 passed in 2.1s'),
        'plain',
      )?.text,
    ).toBe('3 of 42 checks failed');
    expect(
      translateOutcome(
        post('mocha', false, '39 passing, 3 failing'),
        'plain',
      )?.text,
    ).toBe('3 of 42 checks failed');
  });

  it('states when a failing test count cannot be read', () => {
    expect(
      translateOutcome(
        post('npx vitest run', false, '', 'Test process stopped'),
        'plain',
      )?.text,
    ).toBe('The checks failed; codevibez could not read how many');
  });

  it('does not report an unparseable failure signal as success', () => {
    expect(
      translateOutcome(
        post('npm test', true, 'FAIL src/app.test.ts'),
        'plain',
      ),
    ).toMatchObject({
      glyph: '✗',
      severity: 'failure',
      text: 'The checks failed; codevibez could not read how many',
    });
  });

  it('may name the runner in the developer unknown-count line', () => {
    expect(
      translateOutcome(
        post('npx vitest run', false, '', 'Test process stopped'),
        'developer',
      )?.text,
    ).toBe('The vitest checks failed; codevibez could not read how many');
  });
});

describe('parseTestCounts runner fixtures', () => {
  it('prefers the Vitest Tests line over Test Files', () => {
    const output = `
 Test Files  2 failed | 4 passed (6)
      Tests  3 failed | 39 passed (42)
   Start at  12:00:00
   Duration  1.24s
`;
    expect(parseTestCounts(output)).toEqual({ failed: 3, passed: 39 });
  });

  it('prefers the Jest Tests line over Test Suites', () => {
    const output = `
Test Suites: 1 failed, 2 passed, 3 total
Tests:       3 failed, 2 skipped, 39 passed, 44 total
Snapshots:   0 total
Time:        1.234 s
`;
    expect(parseTestCounts(output)).toEqual({ failed: 3, passed: 39 });
  });

  it('parses a pytest summary line', () => {
    const output = `
================ short test summary info ================
FAILED tests/test_api.py::test_rejects_spam
FAILED tests/test_auth.py::test_login
FAILED tests/test_auth.py::test_logout
================ 3 failed, 39 passed in 2.10s =============
`;
    expect(parseTestCounts(output)).toEqual({ failed: 3, passed: 39 });
  });

  it('counts verbose Go test results', () => {
    const output = `
=== RUN   TestLogin
--- PASS: TestLogin (0.00s)
=== RUN   TestLogout
--- PASS: TestLogout (0.00s)
=== RUN   TestRefresh
--- FAIL: TestRefresh (0.00s)
FAIL
`;
    expect(parseTestCounts(output)).toEqual({ failed: 1, passed: 2 });
  });

  it('aggregates every cargo test result line', () => {
    const output = `
test result: FAILED. 4 passed; 1 failed; 0 ignored; 0 measured
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured
`;
    expect(parseTestCounts(output)).toEqual({ failed: 1, passed: 6 });
  });

  it('parses Mocha counts across duration text', () => {
    const output = `
  3 passing (10ms)
  1 failing

  1) login should work:
     AssertionError: expected false to be true
`;
    expect(parseTestCounts(output)).toEqual({ failed: 1, passed: 3 });
  });

  it('does not use passed-only fallback when a failure count exists', () => {
    const output = `
Tests: 1 failed, 2 skipped, 39 passed, 42 total
`;
    expect(parseTestCounts(output)).toEqual({ failed: 1, passed: 39 });
    expect(parseTestCounts('39 passed\n1 failing')).toEqual({
      failed: 1,
      passed: 39,
    });
    expect(
      parseTestCounts(`1 failed\n${'x'.repeat(201)}\n39 passed`),
    ).toBeNull();
  });
});

describe('translateOutcome milestones', () => {
  it('reports an install package count as a separate fact', () => {
    expect(
      translateOutcome(
        post('npm ci', true, 'added 312 packages in 8s'),
        'plain',
      ),
    ).toMatchObject({
      glyph: '✓',
      severity: 'success',
      stem: 'Set up finished',
      facts: '(312 packages)',
      text: 'Set up finished (312 packages)',
    });
    expect(
      translateOutcome(post('npm ci', true, 'added 1 package'), 'plain')
        ?.facts,
    ).toBe('(1 package)');
  });

  it('reports build and count-free test success milestones', () => {
    expect(
      translateOutcome(post('npm run build', true), 'plain')?.text,
    ).toBe('Build finished');
    expect(
      translateOutcome(post('npm test', true), 'plain')?.text,
    ).toBe('Checks finished');
  });

  it('keeps routine success silent', () => {
    expect(translateOutcome(post('ls', true, 'a b c'), 'plain')).toBeNull();
    expect(
      translateOutcome(post('git commit -m x', true), 'plain'),
    ).toBeNull();
  });

  it('does not render a missing outcome as success', () => {
    const event = {
      ...post('npm test', true),
      outcome: undefined,
    };
    expect(translateOutcome(event, 'plain')).toBeNull();
  });
});

describe('translateOutcome generic failures', () => {
  it.each([
    [
      "Error: Cannot find module './config'",
      'Something needed for that step could not be found (1 failure)',
    ],
    [
      'EACCES: permission denied',
      'That step was not allowed to access something it needed (1 failure)',
    ],
    [
      'EADDRINUSE: address already in use',
      'That step could not start because its connection point is already in use (1 failure)',
    ],
    [
      'SyntaxError: Unexpected token',
      'That step could not run because its instructions were malformed (1 failure)',
    ],
    [
      'ENETUNREACH: network is unreachable',
      'That step could not reach the network (1 failure)',
    ],
  ])('classifies plain failures without quoting raw output', (stderr, text) => {
    const line = translateOutcome(
      post('node build.js', false, '', stderr),
      'plain',
    );
    expect(line?.text).toBe(text);
    expect(line?.text).not.toContain(stderr);
  });

  it('uses the exact plain catch-all', () => {
    expect(
      translateOutcome(
        post('node build.js', false, '', 'Unexpected failure detail'),
        'plain',
      )?.text,
    ).toBe('Something went wrong while running that step (1 failure)');
  });

  it('may preserve the first error line for developers', () => {
    expect(
      translateOutcome(
        post(
          'node build.js',
          false,
          '',
          "Error: Cannot find module './config'\nsecond line",
        ),
        'developer',
      ),
    ).toMatchObject({
      stem: 'Something went wrong while running that step',
      facts: "(Error: Cannot find module './config')",
    });
  });

  it('renders failed non-Bash tools', () => {
    const event: CodevibezEvent = {
      v: 1,
      ts: '2026-07-28T00:00:00Z',
      session: 's1',
      agent: 'claude-code',
      kind: 'tool.post',
      tool: 'Edit',
      raw: {},
      outcome: { ok: false, stderr: 'String to replace not found' },
    };
    expect(translateOutcome(event, 'plain')?.text).toBe(
      'Something went wrong while running that step (1 failure)',
    );
  });

  it('never throws on incomplete input', () => {
    const event = {
      v: 1,
      ts: 't',
      session: 's',
      agent: 'claude-code',
      kind: 'tool.post',
    } as CodevibezEvent;
    expect(() => translateOutcome(event, 'plain')).not.toThrow();
  });
});
