import type { Level, Line, CodevibezEvent } from '../types.ts';
import { counted, plural } from '../words.ts';
import { tokenize } from '../bash.ts';
import {
  isBuildCommand,
  isInstallCommand,
  isTestCommand,
} from './bash-rules.ts';

export interface TestCounts {
  failed: number;
  passed: number;
}

function numberAt(match: RegExpMatchArray, index: number): number {
  return Number(match[index] ?? 0);
}

function pairedCounts(output: string): TestCounts | null {
  const failedFirst = output.match(
    /(\d+)\s+fail(?:ed|ing)\b[\s\S]{0,200}?(\d+)\s+pass(?:ed|ing)\b/i,
  );
  if (failedFirst !== null) {
    return {
      failed: numberAt(failedFirst, 1),
      passed: numberAt(failedFirst, 2),
    };
  }

  const passedFirst = output.match(
    /(\d+)\s+pass(?:ed|ing)\b[\s\S]{0,200}?(\d+)\s+fail(?:ed|ing)\b/i,
  );
  if (passedFirst !== null) {
    return {
      failed: numberAt(passedFirst, 2),
      passed: numberAt(passedFirst, 1),
    };
  }

  return null;
}

function cargoCounts(output: string): TestCounts | null {
  const lines = output
    .split('\n')
    .filter((line) => /\btest result:/i.test(line));
  if (lines.length === 0) return null;

  let failed = 0;
  let passed = 0;
  let matched = false;
  for (const line of lines) {
    const passedMatch = line.match(/(\d+)\s+passed\b/i);
    const failedMatch = line.match(/(\d+)\s+failed\b/i);
    if (passedMatch !== null || failedMatch !== null) matched = true;
    passed += passedMatch === null ? 0 : numberAt(passedMatch, 1);
    failed += failedMatch === null ? 0 : numberAt(failedMatch, 1);
  }
  return matched ? { failed, passed } : null;
}

function goCounts(output: string): TestCounts | null {
  const passed = output.match(/^\s*--- PASS:/gm)?.length ?? 0;
  const failed = output.match(/^\s*--- FAIL:/gm)?.length ?? 0;
  return passed + failed === 0 ? null : { failed, passed };
}

// Node's built-in runner ends with summary lines, `# pass 1` (TAP) or
// `ℹ pass 1` (spec): the word comes before the number.
function nodeCounts(output: string): TestCounts | null {
  const passed = output.match(/^\s*(?:#|ℹ)\s*pass\s+(\d+)\s*$/m);
  const failed = output.match(/^\s*(?:#|ℹ)\s*fail\s+(\d+)\s*$/m);
  if (passed === null || failed === null) return null;
  return { failed: numberAt(failed, 1), passed: numberAt(passed, 1) };
}

// Python's unittest: `Ran 3 tests in 0.01s`, then `OK` or
// `FAILED (failures=1, errors=1, skipped=2)`.
function unittestCounts(output: string): TestCounts | null {
  const ran = output.match(/^Ran (\d+) tests? in /m);
  const status = output.match(/^(OK|FAILED)\b(?:\s*\(([^)]*)\))?/m);
  if (ran === null || status === null) return null;
  const detail = status[2] ?? '';
  const field = (name: string): number =>
    Number(new RegExp(`\\b${name}=(\\d+)`).exec(detail)?.[1] ?? 0);
  const failed = field('failures') + field('errors') + field('unexpected successes');
  const skipped = field('skipped') + field('expected failures');
  return { failed, passed: Math.max(0, numberAt(ran, 1) - failed - skipped) };
}

export function parseTestCounts(output: string): TestCounts | null {
  const lines = output.split('\n');
  const authoritative = lines.filter(
    (line) =>
      /^\s*Tests(?::|\s)/i.test(line) &&
      !/^\s*Test (?:Files|Suites)\b/i.test(line) &&
      !/^\s*Suites\b/i.test(line),
  );
  for (let index = authoritative.length - 1; index >= 0; index -= 1) {
    const line = authoritative[index];
    if (line === undefined) continue;
    const counts = pairedCounts(line);
    if (counts !== null) return counts;
  }

  const cargo = cargoCounts(output);
  if (cargo !== null) return cargo;

  const go = goCounts(output);
  if (go !== null) return go;

  const node = nodeCounts(output);
  if (node !== null) return node;

  const unittest = unittestCounts(output);
  if (unittest !== null) return unittest;

  const filtered = lines
    .filter(
      (line) =>
        !/^\s*Test (?:Files|Suites)\b/i.test(line) &&
        !/^\s*Suites\b/i.test(line),
    )
    .join('\n');
  const paired = pairedCounts(filtered);
  if (paired !== null) return paired;

  if (/\d+\s+fail/i.test(output)) return null;
  const passed = output.match(
    /(?:Tests\s*:?\s*)?(\d+)\s+pass(?:ed|ing)\b/i,
  );
  return passed === null
    ? null
    : { failed: 0, passed: numberAt(passed, 1) };
}

function resultLine(
  glyph: Line['glyph'],
  severity: Line['severity'],
  stem: string,
  raw: string,
  facts?: string,
): Line {
  const id =
    severity === 'failure'
      ? /checks failed/.test(stem)
        ? 'out.test.fail'
        : 'out.fail'
      : /checks/i.test(stem)
        ? 'out.test.pass'
        : stem === 'Set up finished'
          ? 'out.install.ok'
          : 'out.build.ok';
  return {
    glyph,
    id,
    severity,
    tier: 'action',
    stem,
    ...(facts === undefined ? {} : { facts }),
    text: facts === undefined ? stem : `${stem} ${facts}`,
    raw,
  };
}

function runnerName(command: string): string {
  const argv = tokenize(command);
  const executable = argv[0] ?? '';
  if (executable === 'npx') return argv[1] ?? 'test';
  if (
    ['npm', 'pnpm', 'yarn', 'bun'].includes(executable) &&
    (argv[1] === 'test' || argv[1] === 'run')
  ) {
    return executable;
  }
  const fileName = executable.split('/').pop() ?? executable;
  return fileName.replace(/\.[^.]+$/, '') || 'test';
}

function firstOutputLine(event: CodevibezEvent): string {
  const stderr =
    typeof event.outcome?.stderr === 'string' ? event.outcome.stderr : '';
  const stdout =
    typeof event.outcome?.stdout === 'string' ? event.outcome.stdout : '';
  return (
    stderr.split('\n').find((line) => line.trim() !== '') ??
    stdout.split('\n').find((line) => line.trim() !== '') ??
    ''
  )
    .trim()
    .slice(0, 80);
}

function plainFailureStem(output: string): string {
  if (
    /cannot find module|module not found|no such file|enoent\b/i.test(output)
  ) {
    return 'Something needed for that step could not be found';
  }
  if (/permission denied|eacces\b|eperm\b/i.test(output)) {
    return 'That step was not allowed to access something it needed';
  }
  if (/eaddrinuse\b|address already in use|port .*in use/i.test(output)) {
    return 'That step could not start because its connection point is already in use';
  }
  if (/syntaxerror\b|syntax error|unexpected token/i.test(output)) {
    return 'That step could not run because its instructions were malformed';
  }
  if (
    /enetunreach\b|econnrefused\b|network|dns|timed? out|fetch failed/i.test(
      output,
    )
  ) {
    return 'That step could not reach the network';
  }
  return 'Something went wrong while running that step';
}

export function translateOutcome(
  event: CodevibezEvent,
  level: Level,
): Line | null {
  try {
    const outcome = event.outcome;
    if (outcome === undefined) return null;

    const raw =
      event.raw !== undefined &&
      typeof event.raw === 'object' &&
      event.raw !== null &&
      !Array.isArray(event.raw)
        ? event.raw
        : {};
    const command =
      typeof raw.command === 'string' ? raw.command : '';
    const stdout =
      typeof outcome.stdout === 'string' ? outcome.stdout : '';
    const stderr =
      typeof outcome.stderr === 'string' ? outcome.stderr : '';
    const output = `${stdout}\n${stderr}`;
    const rawOutput = output.slice(0, 400);
    const test = command !== '' && isTestCommand(command);

    if (test) {
      const counts = parseTestCounts(output);
      if (counts !== null) {
        if (counts.failed > 0) {
          const total = counts.failed + counts.passed;
          const noun =
            level === 'developer'
              ? plural(total, 'test')
              : plural(total, 'check');
          const stem = `${counts.failed} of ${total} ${noun} failed`;
          return resultLine('✗', 'failure', stem, rawOutput);
        }
        if (outcome.ok === true) {
          return resultLine(
            '✓',
            'success',
            'All checks pass',
            rawOutput,
            `(${counted(counts.passed, 'check')})`,
          );
        }
      }

      const hasFailureSignal = /\bfail(?:ed|ing|ure)?\b|error/i.test(output);
      if (outcome.ok !== true || hasFailureSignal) {
        const stem =
          level === 'plain'
            ? 'The checks failed; codevibez could not read how many'
            : `The ${runnerName(
                command,
              )} checks failed; codevibez could not read how many`;
        return resultLine('✗', 'failure', stem, rawOutput);
      }

      return resultLine('✓', 'success', 'Checks finished', rawOutput);
    }

    if (outcome.ok !== true) {
      if (level === 'developer') {
        const first = firstOutputLine(event);
        return resultLine(
          '✗',
          'failure',
          'Something went wrong while running that step',
          rawOutput,
          first === '' ? '(1 failure)' : `(${first})`,
        );
      }
      return resultLine(
        '✗',
        'failure',
        plainFailureStem(output),
        rawOutput,
        '(1 failure)',
      );
    }

    if (command !== '' && isInstallCommand(command)) {
      const installed = output.match(/added\s+(\d+)\s+packages?/i);
      const installedCount =
        installed === null ? null : numberAt(installed, 1);
      return resultLine(
        '✓',
        'success',
        'Set up finished',
        rawOutput,
        installedCount === null
          ? undefined
          : `(${counted(installedCount, 'package')})`,
      );
    }

    if (command !== '' && isBuildCommand(command)) {
      return resultLine('✓', 'success', 'Build finished', rawOutput);
    }

    return null;
  } catch {
    return null;
  }
}
