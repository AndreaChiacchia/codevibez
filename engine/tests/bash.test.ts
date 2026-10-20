import { describe, expect, it } from './kit.ts';
import {
  detectDanger,
  splitSegments,
  tokenize,
} from '../src/bash.ts';

describe('splitSegments', () => {
  it('splits operators outside quotes', () => {
    expect(splitSegments('npm ci && npm test')).toEqual([
      'npm ci',
      'npm test',
    ]);
    expect(splitSegments('a; b | c')).toEqual(['a', 'b', 'c']);
    expect(splitSegments('a&b\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not split operators inside quotes', () => {
    expect(splitSegments('echo "a && b; c | d"')).toEqual([
      'echo "a && b; c | d"',
    ]);
  });

  it('removes backslash line continuations', () => {
    expect(splitSegments('rm -rf build/\\\ncache')).toEqual([
      'rm -rf build/cache',
    ]);
  });

  it('drops empty segments', () => {
    expect(splitSegments('  && ; |  ')).toEqual([]);
  });
});

describe('tokenize', () => {
  it('keeps quoted strings as one token', () => {
    expect(tokenize('git commit -m "fix the thing"')).toEqual([
      'git',
      'commit',
      '-m',
      'fix the thing',
    ]);
  });

  it('handles empty input', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('detectDanger', () => {
  it('flags recursive or forced rm with its targets', () => {
    expect(detectDanger('rm -rf dist/')).toEqual({
      reason: 'delete',
      target: 'dist/',
      recursive: true,
    });
    expect(detectDanger('rm one.txt two.txt')).toEqual({
      reason: 'delete',
      target: 'one.txt, two.txt',
      recursive: false,
    });
  });

  it('flags rm in a later segment', () => {
    expect(detectDanger('npm test && rm -rf tmp')).toEqual({
      reason: 'delete',
      target: 'tmp',
      recursive: true,
    });
  });

  it('flags force push and preserves remote and branch facts', () => {
    expect(detectDanger('git push --force origin main')).toEqual({
      reason: 'overwrite-history',
      target: 'origin main',
    });
    expect(detectDanger('git push --force-with-lease')).toEqual({
      reason: 'overwrite-history',
      target: 'remote',
    });
  });

  it('flags hard reset and preserves the revision', () => {
    expect(detectDanger('git reset --hard HEAD~3')).toEqual({
      reason: 'discard-changes',
      target: 'HEAD~3',
    });
  });

  it('gives git clean its own danger reason', () => {
    expect(detectDanger('git clean -fd')).toEqual({
      reason: 'delete-untracked',
      target: 'untracked files',
    });
  });

  it('flags find delete, naming the filter rather than the search root', () => {
    // Reporting the target as '.' read as "deleting the current directory",
    // which is both alarming and wrong: only matching files are removed.
    expect(detectDanger('find . -name "*.tmp" -delete')).toEqual({
      reason: 'delete',
      target: "matching files inside '.'",
      recursive: false,
    });
  });

  it('flags danger on later physical lines', () => {
    expect(detectDanger('cd /tmp\nrm -rf build')).toMatchObject({
      reason: 'delete',
      target: 'build',
      recursive: true,
    });
    expect(
      detectDanger('npm run build\r\nrm -rf node_modules'),
    ).toMatchObject({
      reason: 'delete',
      target: 'node_modules',
    });
    expect(detectDanger('rm -rf build/\\\ncache')).toMatchObject({
      reason: 'delete',
      target: 'build/cache',
    });
  });

  it('does not treat heredoc text as a command unless a shell runs it', () => {
    // Writing a file that documents a command is not running it. This used to
    // warn, which trained the reader to ignore warnings.
    expect(detectDanger("cat <<'EOF'\nrm -rf example-only\nEOF")).toBeNull();
    expect(detectDanger("tee docs/cleanup.md <<'EOF'\nrm -rf build\nEOF")).toBeNull();
    // Fed to a shell, the same text really does execute.
    expect(detectDanger("bash <<'EOF'\nrm -rf example-only\nEOF")).toMatchObject({
      reason: 'delete',
      target: 'example-only',
    });
  });

  it('unwraps assignments, wrappers, shells, and package runners', () => {
    for (const command of [
      'FOO=1 rm -rf dist',
      'sudo rm -rf dist',
      'env FOO=1 rm -rf dist',
      'command rm -rf dist',
      'nice rm -rf dist',
      'time rm -rf dist',
      "sh -c 'rm -rf dist'",
      'bash -c "rm -rf dist"',
      "zsh -c 'rm -rf dist'",
      'npx rimraf dist',
      'yarn dlx rimraf dist',
    ]) {
      expect(detectDanger(command), command).toMatchObject({
        reason: 'delete',
        target: 'dist',
      });
    }
  });

  it('recurses into substitutions and subshells', () => {
    for (const command of [
      'echo $(rm -rf dist)',
      '( rm -rf dist )',
      'echo `rm -rf dist`',
    ]) {
      expect(detectDanger(command), command).toMatchObject({
        reason: 'delete',
        target: 'dist',
      });
    }
  });

  it('scans xargs and find exec payloads', () => {
    expect(detectDanger('find . -type f | xargs rm -f')).toMatchObject({
      reason: 'delete',
    });
    expect(
      detectDanger("find . -name '*.log' -exec rm -f {} \\;"),
    ).toMatchObject({
      reason: 'delete',
      target: "matching files inside '.'",
    });
  });

  it('handles git global options and plus force refspecs', () => {
    expect(
      detectDanger('git -C repo push --force origin main'),
    ).toMatchObject({
      reason: 'overwrite-history',
      target: 'origin main',
    });
    expect(detectDanger('git push origin +main')).toMatchObject({
      reason: 'overwrite-history',
      target: 'origin +main',
    });
  });

  it('detects worktree discards and destructive writes', () => {
    expect(detectDanger('git checkout -- .')).toMatchObject({
      reason: 'discard-worktree',
      target: '.',
    });
    expect(detectDanger('git restore .')).toMatchObject({
      reason: 'discard-worktree',
      target: '.',
    });
    // Writing a file is not a loss by itself; emptying a named one is.
    expect(detectDanger('echo x > important-file')).toBeNull();
    expect(detectDanger(': > important-file')).toEqual({
      reason: 'empty',
      target: 'important-file',
    });
    expect(detectDanger('truncate -s 0 important-file')).toEqual({
      reason: 'empty',
      target: 'important-file',
    });
    expect(detectDanger('dd if=/tmp/input of=/dev/disk4')).toEqual({
      reason: 'overwrite',
      target: '/dev/disk4',
    });
    expect(detectDanger('echo x >> important-file')).toBeNull();
  });

  it('does not treat quoted command text as an action', () => {
    expect(detectDanger('echo "rm -rf /"')).toBeNull();
  });

  it('handles empty commands without throwing', () => {
    expect(detectDanger('')).toBeNull();
    expect(detectDanger('&&')).toBeNull();
  });
});

describe('detectDanger, cases found by adversarial review', () => {
  it('never lets an incidental redirect hide a deletion', () => {
    // The bug this pins: a `> /dev/null` at the end of the line won, so the
    // recursive delete beside it was never mentioned at all.
    expect(detectDanger('rm -rf node_modules > /dev/null 2>&1')).toMatchObject({
      reason: 'delete',
      target: 'node_modules',
    });
    expect(detectDanger('git reset --hard > /dev/null')).toMatchObject({
      reason: 'discard-changes',
    });
    expect(detectDanger('npm run build && rm -rf dist 2>/dev/null')).toMatchObject({
      reason: 'delete',
      target: 'dist',
    });
  });

  it('does not cry wolf about writing to /dev/null', () => {
    expect(detectDanger('ls foo 2>/dev/null')).toBeNull();
    expect(detectDanger('npm test > /dev/null 2>&1')).toBeNull();
    expect(detectDanger('echo hi >> log.txt 2>/dev/null')).toBeNull();
  });

  it('sees through control flow written on one line', () => {
    expect(detectDanger('if [ -d dist ]; then rm -rf dist; fi')).toMatchObject({
      reason: 'delete',
      target: 'dist',
    });
    expect(detectDanger('test -d dist && { rm -rf dist; }')).toMatchObject({ reason: 'delete' });
    expect(detectDanger('while read f; do rm -rf "$f"; done < list.txt')).toMatchObject({
      reason: 'delete',
    });
  });

  it('unwraps a shell invoked with bundled flags', () => {
    expect(detectDanger('bash -lc "rm -rf x"')).toMatchObject({ reason: 'delete', target: 'x' });
    expect(detectDanger('bash -cx "rm -rf x"')).toMatchObject({ reason: 'delete', target: 'x' });
    expect(detectDanger('sh -ec "rm -rf x"')).toMatchObject({ reason: 'delete', target: 'x' });
  });

  it('does not read a quoted mention of a command as a command', () => {
    expect(detectDanger('git commit -m "fix (rm -rf dist) call"')).toBeNull();
    expect(detectDanger("echo 'the cost is $(rm -rf x)'")).toBeNull();
  });

  it('treats a trailing comment as a comment, not as a list of targets', () => {
    expect(detectDanger('rm -rf build # remove stale artifacts')).toEqual({
      reason: 'delete',
      target: 'build',
      recursive: true,
    });
  });

  it('warns about discarding edits through the path form of checkout', () => {
    expect(detectDanger('git checkout .')).toMatchObject({ reason: 'discard-worktree' });
    expect(detectDanger('git checkout src/index.ts')).toMatchObject({ reason: 'discard-worktree' });
    expect(detectDanger('git checkout -- src/a.ts')).toMatchObject({ reason: 'discard-worktree' });
  });

  it('leaves ordinary branch switching alone', () => {
    expect(detectDanger('git checkout main')).toBeNull();
    expect(detectDanger('git checkout -b feature/login')).toBeNull();
  });

  it('does not warn about unstaging, which destroys nothing', () => {
    expect(detectDanger('git restore --staged file.txt')).toBeNull();
    expect(detectDanger('git restore file.txt')).toMatchObject({ reason: 'discard-worktree' });
    expect(detectDanger('git restore --staged --worktree f.txt')).toMatchObject({
      reason: 'discard-worktree',
    });
  });

  it('covers the destructive git commands that had no rule', () => {
    expect(detectDanger('git branch -D feature')).toMatchObject({ reason: 'delete', target: 'feature' });
    expect(detectDanger('git stash drop')).toMatchObject({ reason: 'delete' });
    expect(detectDanger('git stash clear')).toMatchObject({ reason: 'delete' });
    expect(detectDanger('git worktree remove --force wt')).toMatchObject({ reason: 'delete' });
    expect(detectDanger('git push -fu origin feature')).toMatchObject({
      reason: 'overwrite-history',
    });
  });

  it('recognises the forced clobber operator', () => {
    expect(detectDanger(': >| out.txt')).toMatchObject({
      reason: 'empty',
      target: 'out.txt',
    });
    expect(detectDanger('echo hi >| out.txt')).toBeNull();
  });
});
