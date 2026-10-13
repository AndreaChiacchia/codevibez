import { describe, expect, it } from './kit.ts';
import {
  isBuildCommand,
  isInstallCommand,
  isTestCommand,
  translateBash,
} from '../src/rules/bash-rules.ts';

type Case = [
  command: string,
  level: 'plain' | 'developer',
  glyph: string,
  text: string,
  tier: string,
];

const cases: Case[] = [
  ['npm ci', 'plain', '→', "Setting up the project's building blocks", 'action'],
  [
    'npm ci',
    'developer',
    '→',
    'Installing dependencies from lockfile (npm ci)',
    'action',
  ],
  [
    'npm install express-rate-limit',
    'plain',
    '→',
    'Adding a ready-made tool to the project',
    'action',
  ],
  [
    'pnpm remove zod',
    'developer',
    '→',
    'Removing package zod',
    'action',
  ],
  [
    'npm install express-rate-limit',
    'developer',
    '→',
    'Installing package express-rate-limit',
    'action',
  ],
  ['npm test', 'plain', '→', 'Checking everything still works…', 'action'],
  [
    'npx vitest run',
    'developer',
    '→',
    'Running the test suite (vitest)',
    'action',
  ],
  [
    'git commit -m "fix"',
    'plain',
    '→',
    'Saving a checkpoint of the work',
    'action',
  ],
  [
    'git checkout -b fix/auth',
    'developer',
    '→',
    'Creating branch fix/auth',
    'action',
  ],
  [
    'git checkout -b fix/auth',
    'plain',
    '→',
    'Starting work on a separate track',
    'action',
  ],
  ['git status', 'plain', '→', 'Checking the state of the work', 'read'],
  ['ls -la', 'developer', '→', 'Listing files', 'read'],
  [
    'grep -rn TODO src/',
    'plain',
    '→',
    'Searching through the project',
    'read',
  ],
  [
    'mkdir -p src/lib',
    'plain',
    '→',
    'Creating a folder',
    'action',
  ],
  [
    'curl -s https://api.example.com/health',
    'plain',
    '→',
    'Fetching something from the internet',
    'action',
  ],
  [
    './scripts/gen-fixtures.sh --all --clean',
    'plain',
    '→',
    'Running a script (gen-fixtures.sh)',
    'action',
  ],
  [
    './scripts/gen-fixtures.sh --all --clean',
    'developer',
    '→',
    'Running a script (gen-fixtures.sh)',
    'action',
  ],
];

describe('translateBash golden table', () => {
  for (const [command, level, glyph, text, tier] of cases) {
    it(`${level}: ${command}`, () => {
      expect(translateBash(command, level)).toMatchObject({
        glyph,
        text,
        tier,
        raw: command,
      });
    });
  }

  it('marks unknown commands as generic', () => {
    expect(translateBash('qq-tool --x', 'plain').generic).toBe(true);
    expect(translateBash('./scripts/gen-fixtures.sh', 'plain').generic).toBeUndefined();
    expect(translateBash('npm test', 'plain').generic).toBeUndefined();
  });

  it('returns a generic line for zero segments', () => {
    for (const command of ['', '   ', '&&']) {
      expect(translateBash(command, 'plain')).toMatchObject({
        text: "Running one of the project's own tools",
        generic: true,
      });
    }
  });

  it('lets danger win over compound actions', () => {
    expect(translateBash('npm test && rm -rf tmp', 'plain').text).toBe(
      "Deleting 'tmp' and everything inside it",
    );
  });

  it('lets danger win across physical lines', () => {
    expect(
      translateBash('npm run build\nrm -rf node_modules', 'plain'),
    ).toMatchObject({
      glyph: '⚠',
      severity: 'danger',
      text: "Deleting 'node_modules' and everything inside it",
    });
  });

  it('keeps compound step counts as structured facts', () => {
    const line = translateBash('npm ci && npm test', 'plain');
    expect(line.stem).toBe("Setting up the project's building blocks");
    expect(line.facts).toBe('(+1 more step)');
    expect(line.text).toBe(
      "Setting up the project's building blocks (+1 more step)",
    );
  });

  it('is read tier only when every segment is read only', () => {
    expect(translateBash('ls && cat package.json', 'plain').tier).toBe('read');
    expect(translateBash('ls && npm test', 'plain').tier).toBe('action');
  });
});

describe('danger narration', () => {
  it('renders delete by level without a hint', () => {
    expect(translateBash('rm -rf dist/', 'plain').text).toBe(
      "Deleting 'dist/' and everything inside it",
    );
    expect(translateBash('rm -rf dist/', 'developer').text).toBe(
      'Deleting dist/ (entire folder)',
    );
  });

  it('does not describe a non-recursive file delete as recursive', () => {
    expect(translateBash('rm notes.txt', 'plain').text).toBe(
      "Deleting 'notes.txt'",
    );
    expect(translateBash('rm -f one.log', 'developer').text).toBe(
      'Deleting one.log',
    );
    expect(translateBash('rm -rf dist/', 'plain').text).toBe(
      "Deleting 'dist/' and everything inside it",
    );
  });

  it('renders measured delete counts by level', () => {
    const hint = { count: 14, cap: false };
    expect(translateBash('rm -rf dist/', 'plain', hint).text).toBe(
      "Deleting 'dist/' and the 14 items inside it",
    );
    expect(translateBash('rm -rf dist/', 'developer', hint).text).toBe(
      'Deleting dist/ (14 items)',
    );
  });

  it('singularizes a measured delete count', () => {
    const hint = { count: 1, cap: false };
    expect(translateBash('rm -rf dist/', 'plain', hint).text).toBe(
      "Deleting 'dist/' and the 1 item inside it",
    );
    expect(translateBash('rm -rf dist/', 'developer', hint).text).toBe(
      'Deleting dist/ (1 item)',
    );
  });

  it('renders a capped delete count', () => {
    expect(
      translateBash('rm -rf dist/', 'plain', {
        count: 1000,
        cap: true,
      }).text,
    ).toBe("Deleting 'dist/' and the 1000+ items inside it");
    expect(
      translateBash('rm -rf dist/', 'plain', {
        count: 5,
        cap: true,
      }).text,
    ).toBe("Deleting 'dist/' and the 5+ items inside it");
  });

  it('renders hard reset without revision syntax at plain level', () => {
    expect(translateBash('git reset --hard HEAD~1', 'plain').text).toBe(
      'Throwing away the last saved checkpoint and any unsaved edits',
    );
    expect(translateBash('git reset --hard HEAD~3', 'plain').text).toBe(
      'Throwing away the last 3 saved checkpoints and any unsaved edits',
    );
    expect(translateBash('git reset --hard HEAD~3', 'developer').text).toBe(
      'Throwing away recent changes (HEAD~3)',
    );
    for (const command of [
      'git reset --hard',
      'git reset --hard HEAD',
      'git reset --hard HEAD~0',
    ]) {
      expect(translateBash(command, 'plain').text).toBe(
        'Throwing away every unsaved edit in the project',
      );
    }
    expect(
      translateBash('git reset --hard release-tag', 'plain').text,
    ).toBe(
      'Throwing away unsaved edits and moving the work to release-tag',
    );
  });

  it('keeps force push remote facts out of plain text', () => {
    expect(translateBash('git push --force origin main', 'plain').text).toBe(
      'Replacing the shared online copy of this work; older versions there are lost',
    );
    expect(
      translateBash('git push --force origin main', 'developer').text,
    ).toBe('Overwriting the online history (origin main)');
  });

  it('never softens checkout or restore discards into routine actions', () => {
    for (const command of ['git checkout -- .', 'git restore .']) {
      expect(translateBash(command, 'plain'), command).toMatchObject({
        glyph: '⚠',
        severity: 'danger',
        tier: 'danger',
      });
      expect(translateBash(command, 'plain').text).toContain(
        'Throwing away unsaved edits',
      );
    }
  });

  it('warns on truncation, dd output, and plus force refspecs', () => {
    for (const command of [
      'echo x > important-file',
      'truncate -s 0 important-file',
      'dd if=/tmp/input of=/dev/disk4',
      'git push origin +main',
    ]) {
      expect(translateBash(command, 'plain'), command).toMatchObject({
        glyph: '⚠',
        severity: 'danger',
        tier: 'danger',
      });
    }
  });

  it('renders git clean with its own reason and optional count', () => {
    expect(translateBash('git clean -fd', 'plain').text).toBe(
      'Permanently deleting files the project is not tracking',
    );
    expect(
      translateBash('git clean -fd', 'plain', {
        count: 14,
        cap: false,
      }).text,
    ).toBe('Permanently deleting the 14 items the project is not tracking');
    expect(
      translateBash('git clean -fd', 'developer', {
        count: 14,
        cap: false,
      }).text,
    ).toBe('Permanently deleting untracked files (14 items)');
  });

  it('does not classify find exec as read tier', () => {
    expect(
      translateBash('find . -exec echo {} \\;', 'plain').tier,
    ).toBe('action');
  });
});

describe('command predicates', () => {
  it('recognizes tests', () => {
    expect(isTestCommand('npx vitest run')).toBe(true);
    expect(isTestCommand('cargo test')).toBe(true);
    expect(isTestCommand('npm ci')).toBe(false);
  });

  it('recognizes installs', () => {
    expect(isInstallCommand('pnpm add zod')).toBe(true);
    expect(isInstallCommand('npm test')).toBe(false);
  });

  it('recognizes builds', () => {
    expect(isBuildCommand('npm run build')).toBe(true);
    expect(isBuildCommand('tsc -b')).toBe(true);
    expect(isBuildCommand('go test ./...')).toBe(false);
  });
});
