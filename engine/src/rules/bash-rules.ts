import { detectDanger, splitSegments, tokenize } from '../bash.ts';
import { counted, plural } from '../words.ts';
import type { Level, Line } from '../types.ts';

export interface DangerHint {
  count: number;
  cap: boolean;
}

interface SegLine {
  glyph: Line['glyph'];
  id: string;
  stem: string;
  facts?: string;
  tier: Line['tier'];
  generic?: true;
}

type SegmentKind =
  | 'test'
  | 'install'
  | 'remove'
  | 'build'
  | 'read'
  | 'action'
  | 'generic';

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const READ_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'pwd',
  'which',
  'echo',
  'grep',
  'rg',
  'wc',
  'stat',
]);
const TEST_BINS = new Set([
  'vitest',
  'jest',
  'pytest',
  'mocha',
  'playwright',
]);

function lineText(stem: string, facts?: string): string {
  return facts === undefined ? stem : `${stem} ${facts}`;
}

function asLine(
  command: string,
  segment: SegLine,
  tier = segment.tier,
): Line {
  return {
    glyph: segment.glyph,
    id: segment.id,
    stem: segment.stem,
    ...(segment.facts === undefined ? {} : { facts: segment.facts }),
    text: lineText(segment.stem, segment.facts),
    severity: 'info',
    tier,
    raw: command,
    ...(segment.generic === true ? { generic: true as const } : {}),
  };
}

function packageNames(argv: string[]): string | null {
  const names = argv.slice(2).filter((argument) => !argument.startsWith('-'));
  return names.length === 0 ? null : names.join(', ');
}

function testBin(argv: string[]): string {
  const command = argv[0] ?? '';
  return command === 'npx' ? (argv[1] ?? 'test runner') : command;
}

function kindOfSegment(argv: string[]): SegmentKind {
  const command = argv[0] ?? '';
  const subcommand = argv[1] ?? '';
  const bin = testBin(argv);

  if (
    TEST_BINS.has(bin) ||
    (command === 'cargo' && subcommand === 'test') ||
    (command === 'go' && subcommand === 'test') ||
    (PACKAGE_MANAGERS.has(command) &&
      (subcommand === 'test' ||
        (subcommand === 'run' && argv[2] === 'test')))
  ) {
    return 'test';
  }

  if (
    PACKAGE_MANAGERS.has(command) &&
    (subcommand === 'ci' ||
      subcommand === 'install' ||
      subcommand === 'add' ||
      subcommand === 'i')
  ) {
    return 'install';
  }

  if (
    PACKAGE_MANAGERS.has(command) &&
    (subcommand === 'remove' ||
      subcommand === 'uninstall' ||
      subcommand === 'rm')
  ) {
    return 'remove';
  }

  if (
    command === 'tsc' ||
    (command === 'cargo' && subcommand === 'build') ||
    (command === 'go' && subcommand === 'build') ||
    (PACKAGE_MANAGERS.has(command) &&
      subcommand === 'run' &&
      argv[2] === 'build')
  ) {
    return 'build';
  }

  if (
    READ_COMMANDS.has(command) ||
    (command === 'find' &&
      !argv.includes('-delete') &&
      !argv.includes('-exec') &&
      !argv.includes('-execdir')) ||
    (command === 'git' &&
      ['status', 'log', 'diff', 'show'].includes(subcommand))
  ) {
    return 'read';
  }

  if (
    command === 'git' ||
    ['mkdir', 'cp', 'mv', 'touch', 'chmod', 'curl', 'wget'].includes(command)
  ) {
    return 'action';
  }

  return 'generic';
}

function testLine(level: Level, runner: string): SegLine {
  return {
    glyph: '→',
    id: 'bash.test',
    tier: 'action',
    stem:
      level === 'plain'
        ? 'Checking everything still works…'
        : `Running the test suite (${runner || 'test runner'})`,
  };
}

function gitLine(argv: string[], level: Level): SegLine {
  const subcommand = argv[1] ?? '';

  if (['status', 'log', 'diff', 'show'].includes(subcommand)) {
    return {
      glyph: '→',
      id: 'bash.read',
      tier: 'read',
      stem:
        level === 'plain'
          ? 'Checking the state of the work'
          : `Inspecting changes with git ${subcommand}`,
    };
  }

  if (subcommand === 'commit') {
    return {
      glyph: '→',
      id: 'bash.commit',
      tier: 'action',
      stem:
        level === 'plain'
          ? 'Saving a checkpoint of the work'
          : 'Committing changes',
    };
  }

  if (
    (subcommand === 'checkout' && argv.includes('-b')) ||
    subcommand === 'branch'
  ) {
    const branch =
      subcommand === 'checkout'
        ? (argv[argv.indexOf('-b') + 1] ?? 'a branch')
        : (argv[2] ?? 'a branch');
    return {
      glyph: '→',
      id: 'bash.branch',
      tier: 'action',
      stem:
        level === 'plain'
          ? 'Starting work on a separate track'
          : `Creating branch ${branch}`,
    };
  }

  if (subcommand === 'checkout' || subcommand === 'switch') {
    const target =
      argv.slice(2).find((argument) => !argument.startsWith('-')) ??
      'another branch';
    return {
      glyph: '→',
      id: 'bash.branch',
      tier: 'action',
      stem:
        level === 'plain'
          ? 'Moving to another track of work'
          : `Switching to ${target}`,
    };
  }

  const developer: Record<string, string> = {
    add: 'Staging changes',
    pull: 'Pulling changes',
    push: 'Pushing changes',
    merge: 'Merging changes',
  };
  const plain: Record<string, string> = {
    add: 'Preparing changes for a checkpoint',
    pull: 'Bringing in the latest shared work',
    push: 'Sharing the saved work',
    merge: 'Combining separate tracks of work',
  };
  const selected = level === 'plain' ? plain[subcommand] : developer[subcommand];
  return {
    glyph: '→',
    id: 'bash.generic',
    tier: 'action',
    stem: selected ?? (level === 'plain' ? 'Managing saved work' : 'Running git'),
  };
}

function genericLine(segment: string, level: Level): SegLine {
  if (level === 'plain') {
    return {
      glyph: '→',
      id: 'bash.generic',
      tier: 'action',
      stem: "Running one of the project's own tools",
      generic: true,
    };
  }

  const argv = tokenize(segment);
  const executable = argv[0] ?? 'project-script';
  const fileName = executable.split('/').pop() ?? executable;
  const name = fileName.replace(/\.[^.]+$/, '') || 'project-script';
  const optionCount = Math.max(0, argv.length - 1);
  return {
    glyph: '→',
    id: 'bash.generic',
    tier: 'action',
    stem: `Running a project script (${name})`,
    ...(optionCount === 0
      ? {}
      : {
          facts: `(+${optionCount} option${optionCount === 1 ? '' : 's'})`,
        }),
    generic: true,
  };
}

function classifySegment(segment: string, level: Level): SegLine {
  const argv = tokenize(segment);
  const command = argv[0] ?? '';
  const subcommand = argv[1] ?? '';
  const kind = kindOfSegment(argv);

  if (kind === 'test') return testLine(level, testBin(argv));

  if (kind === 'install') {
    if (subcommand === 'ci') {
      return {
        glyph: '→',
        id: 'bash.install.ci',
        tier: 'action',
        stem:
          level === 'plain'
            ? "Setting up the project's building blocks"
            : `Installing dependencies from lockfile (${command} ci)`,
      };
    }
    const names = packageNames(argv);
    return {
      glyph: '→',
      id: 'bash.install.pkg',
      tier: 'action',
      stem:
        level === 'plain'
          ? names === null
            ? "Setting up the project's building blocks"
            : 'Adding a ready-made tool to the project'
          : names === null
            ? 'Installing dependencies'
            : `Installing package ${names}`,
    };
  }

  if (kind === 'build') {
    return {
      glyph: '→',
      id: 'bash.build',
      tier: 'action',
      stem: level === 'plain' ? 'Assembling the app' : 'Building the project',
    };
  }

  if (kind === 'remove') {
    const names = packageNames(argv);
    return {
      glyph: '→',
      id: 'bash.install.pkg',
      tier: 'action',
      stem:
        level === 'plain'
          ? 'Removing a ready-made tool from the project'
          : names === null
            ? 'Removing a package'
            : `Removing package ${names}`,
    };
  }

  if (kind === 'read') {
    if (command === 'grep' || command === 'rg') {
      const terms = argv.filter((argument) => !argument.startsWith('-'));
      return {
        glyph: '→',
        id: 'bash.search',
        tier: 'read',
        stem:
          level === 'plain'
            ? 'Searching through the project'
            : `Searching for ${terms[1] ?? 'a pattern'}`,
      };
    }
    if (command === 'ls') {
      return {
        glyph: '→',
        id: 'bash.read',
        tier: 'read',
        stem: level === 'plain' ? 'Looking around the project' : 'Listing files',
      };
    }
    if (command === 'git') return gitLine(argv, level);
    return {
      glyph: '→',
      id: 'bash.read',
      tier: 'read',
      stem:
        level === 'plain'
          ? 'Looking at existing files'
          : `Reading with ${command || 'a file tool'}`,
    };
  }

  if (command === 'git') return gitLine(argv, level);

  if (command === 'mkdir') {
    const target =
      argv.slice(1).find((argument) => !argument.startsWith('-')) ?? '';
    return {
      glyph: '→',
      id: 'bash.mkdir',
      tier: 'action',
      stem:
        level === 'plain'
          ? 'Creating a folder'
          : `Creating folder ${target}`.trim(),
    };
  }

  if (['cp', 'mv', 'touch', 'chmod'].includes(command)) {
    const target =
      argv.slice(1).find((argument) => !argument.startsWith('-')) ?? 'files';
    const verb =
      command === 'cp'
        ? 'Copying'
        : command === 'mv'
          ? 'Moving'
          : command === 'touch'
            ? 'Creating'
            : 'Changing permissions on';
    return {
      glyph: '→',
      id: 'bash.fileops',
      tier: 'action',
      stem:
        level === 'plain' ? 'Organizing project files' : `${verb} ${target}`,
    };
  }

  if (command === 'curl' || command === 'wget') {
    const url =
      argv.find((argument) => argument.startsWith('http')) ?? 'a URL';
    return {
      glyph: '→',
      id: 'bash.fetch',
      tier: 'action',
      stem:
        level === 'plain'
          ? 'Fetching something from the internet'
          : `Fetching ${url}`,
    };
  }

  return genericLine(segment, level);
}

function normalizedHint(hint: DangerHint | undefined): DangerHint | null {
  if (
    hint === undefined ||
    !Number.isFinite(hint.count) ||
    hint.count < 0 ||
    typeof hint.cap !== 'boolean'
  ) {
    return null;
  }
  return { count: Math.floor(hint.count), cap: hint.cap };
}

function countText(hint: DangerHint): string {
  if (hint.cap) {
    return `${hint.count}+ ${
      hint.count === 1 ? 'item' : 'items'
    }`;
  }
  return counted(hint.count, 'item');
}

function dangerLine(
  command: string,
  level: Level,
  hint: DangerHint | undefined,
): Line | null {
  const danger = detectDanger(command);
  if (danger === null) return null;
  const measured = normalizedHint(hint);
  let stem: string;
  let facts: string | undefined;

  if (danger.reason === 'delete') {
    if (measured === null && danger.recursive === true) {
      if (level === 'developer') {
        stem = `Deleting ${danger.target}`;
        facts = '(entire folder)';
      } else {
        stem = `Deleting '${danger.target}' and everything inside it`;
      }
    } else if (measured === null) {
      stem =
        level === 'plain'
          ? `Deleting '${danger.target}'`
          : `Deleting ${danger.target}`;
    } else if (danger.recursive !== true) {
      stem =
        level === 'plain'
          ? `Deleting '${danger.target}'`
          : `Deleting ${danger.target}`;
      facts = `(${countText(measured)})`;
    } else if (level === 'developer') {
      stem = `Deleting ${danger.target}`;
      facts = `(${countText(measured)})`;
    } else {
      stem = `Deleting '${danger.target}' and the ${countText(measured)} inside it`;
    }
  } else if (danger.reason === 'delete-untracked') {
    if (measured === null) {
      stem =
        level === 'plain'
          ? 'Permanently deleting files the project is not tracking'
          : 'Permanently deleting untracked files';
    } else if (level === 'plain') {
      stem = `Permanently deleting the ${countText(measured)} the project is not tracking`;
    } else {
      stem = 'Permanently deleting untracked files';
      facts = `(${countText(measured)})`;
    }
  } else if (danger.reason === 'overwrite-history') {
    stem =
      level === 'plain'
        ? 'Replacing the shared online copy of this work; older versions there are lost'
        : `Overwriting the online history (${danger.target})`;
  } else if (danger.reason === 'overwrite') {
    stem =
      level === 'plain'
        ? `Overwriting '${danger.target}' and destroying its previous contents`
        : `Overwriting ${danger.target}`;
  } else if (danger.reason === 'permissions') {
    if (level === 'developer') {
      stem = `Changing permissions on ${danger.target}`;
      if (danger.recursive === true) facts = '(entire folder)';
    } else {
      stem =
        danger.recursive === true
          ? `Changing who can open or change '${danger.target}' and everything inside it`
          : `Changing who can open or change '${danger.target}'`;
    }
  } else if (danger.reason === 'drop-data') {
    stem =
      level === 'plain'
        ? `Permanently erasing stored data (${danger.target})`
        : `Dropping data (${danger.target})`;
  } else if (danger.reason === 'discard-worktree') {
    stem =
      level === 'plain'
        ? `Throwing away unsaved edits in ${danger.target}`
        : `Discarding working-copy changes (${danger.target})`;
  } else if (level === 'developer') {
    stem = `Throwing away recent changes (${danger.target})`;
  } else {
    const revision = /^HEAD~(\d+)$/.exec(danger.target);
    const count = revision === null ? null : Number(revision[1] ?? 0);
    if (
      danger.target === 'working copy' ||
      danger.target === 'HEAD' ||
      count === 0
    ) {
      stem = 'Throwing away every unsaved edit in the project';
    } else if (count !== null) {
      stem =
        count === 1
          ? 'Throwing away the last saved checkpoint and any unsaved edits'
          : `Throwing away the last ${count} saved checkpoints and any unsaved edits`;
    } else {
      stem = `Throwing away unsaved edits and moving the work to ${danger.target}`;
    }
  }

  return {
    glyph: '⚠',
    id:
      danger.reason === 'delete' || danger.reason === 'delete-untracked'
        ? 'bash.danger.delete'
        : danger.reason === 'overwrite-history'
          ? 'bash.danger.history'
          : danger.reason === 'permissions'
            ? 'bash.danger.permissions'
            : danger.reason === 'drop-data'
              ? 'bash.danger.data'
              : 'bash.danger.discard',
    stem,
    ...(facts === undefined ? {} : { facts }),
    text: lineText(stem, facts),
    severity: 'danger',
    tier: 'danger',
    raw: command,
  };
}

export function translateBash(
  command: string,
  level: Level,
  hint?: DangerHint,
): Line {
  const danger = dangerLine(command, level, hint);
  if (danger !== null) return danger;

  const segments = splitSegments(command);
  const classified = segments.map((segment) =>
    classifySegment(segment, level),
  );
  const actions = classified.filter((segment) => segment.tier === 'action');
  const picked =
    actions[0] ??
    classified[0] ??
    genericLine(command.trim(), level);
  const extraCount = Math.max(0, actions.length - 1);
  const facts =
    extraCount === 0
      ? picked.facts
      : `(+${extraCount} more ${plural(extraCount, 'step')})`;
  return asLine(
    command,
    {
      ...picked,
      ...(facts === undefined ? {} : { facts }),
    },
    actions.length === 0 ? picked.tier : 'action',
  );
}

function hasKind(command: string, expected: SegmentKind): boolean {
  return splitSegments(command).some(
    (segment) => kindOfSegment(tokenize(segment)) === expected,
  );
}

export function isTestCommand(command: string): boolean {
  return hasKind(command, 'test');
}

export function isInstallCommand(command: string): boolean {
  return hasKind(command, 'install');
}

export function isBuildCommand(command: string): boolean {
  return hasKind(command, 'build');
}
