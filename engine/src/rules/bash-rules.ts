import { detectDanger, splitSegments, stripHeredocs, tokenize } from '../bash.ts';
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
const PYTHONS = new Set(['python', 'python3']);
const NAVIGATION = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'done', 'fi', 'esac']);
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
    (command === 'deno' && subcommand === 'test') ||
    (command === 'node' && argv.includes('--test')) ||
    (PYTHONS.has(command) &&
      subcommand === '-m' &&
      ['unittest', 'pytest'].includes(argv[2] ?? '')) ||
    (PACKAGE_MANAGERS.has(command) &&
      (subcommand === 'test' ||
        (subcommand === 'run' && argv[2] === 'test')))
  ) {
    return 'test';
  }

  if (
    (['pip', 'pip3', 'poetry', 'brew', 'gem', 'cargo'].includes(command) && ['install', 'add'].includes(subcommand)) ||
    (command === 'uv' && ['sync', 'add', 'pip'].includes(subcommand)) ||
    (['yarn', 'pnpm', 'bun'].includes(command) && subcommand === 'add')
  ) {
    return 'install';
  }

  if (command === 'make' && (subcommand === 'test' || subcommand === 'check')) return 'test';
  if (PACKAGE_MANAGERS.has(command) && subcommand === 'run' && /^(test|e2e)([:-]|$)/.test(argv[2] ?? '')) return 'test';
  if (command === 'swift' && subcommand === 'test') return 'test';
  if ((command === 'swift' && subcommand === 'build') || command === 'xcodebuild') return 'build';
  if (
    (command === 'make' && (subcommand === '' || ['build', 'all'].includes(subcommand))) ||
    (['yarn', 'pnpm', 'bun'].includes(command) && subcommand === 'build') ||
    (command === 'docker' && subcommand === 'build')
  ) {
    return 'build';
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
  const positional = argv.slice(2).filter((a) => !a.startsWith('-'));
  if (subcommand === '--version' || subcommand === 'version') return line('Checking which version of git is installed');
  if (
    ['blame', 'grep', 'ls-files', 'rev-parse', 'remote', 'shortlog', 'describe', 'reflog'].includes(subcommand) ||
    (subcommand === 'tag' && positional.length === 0) ||
    (subcommand === 'stash' && positional[0] === 'list') ||
    (subcommand === 'branch' && positional.length === 0)
  ) {
    return line('Checking the state of the work');
  }
  if (subcommand === 'fetch') return line('Bringing in the latest shared work', 'action');
  if (subcommand === 'stash' && ['pop', 'apply'].includes(positional[0] ?? '')) return line('Bringing back edits that were set aside', 'action');
  if (subcommand === 'stash' && positional.length === 0) return line('Setting unsaved edits aside for later', 'action');
  if (subcommand === 'rebase') return line('Replaying the work on top of another track', 'action');
  if (subcommand === 'cherry-pick') return line('Copying a saved change from another track', 'action');

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
    // A git step with its own sentence is not the catch-all.
    id: selected === undefined ? 'bash.generic' : `bash.git.${subcommand}`,
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

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Shell words that only lead into the real command (`then echo hi`, `if [ -f x ]`).
const FLOW = new Set(['do', 'then', 'else', 'elif', 'if']);

/** The words that say what a segment runs: no env prefix, wrapper or path. */
export function normalizeArgv(raw: string[]): string[] {
  let argv = [...raw];
  while (argv[0] !== undefined && (ASSIGN.test(argv[0]) || FLOW.has(argv[0]))) argv.shift();
  for (;;) {
    const first = argv[0] ?? '';
    if (first === 'timeout') argv = argv.slice(2);
    else if (['time', 'nice', 'sudo', 'nohup'].includes(first)) argv = argv.slice(1);
    else if (first.endsWith('/env') || (first === 'env' && argv.length > 1 && !argv[1]?.startsWith('-') && argv[1] !== '|')) {
      argv = argv.slice(1);
      while (argv[0] !== undefined && ASSIGN.test(argv[0])) argv.shift();
    } else break;
  }
  if ((argv[0] ?? '').includes('/') && !(argv[0] ?? '').startsWith('./')) argv[0] = (argv[0] ?? '').split('/').pop() ?? '';
  if (argv[0] === 'git' && argv[1] === '-C') argv.splice(1, 2);
  if (PYTHONS.has(argv[0] ?? '') && argv[1] === '-m' && argv[2] === 'pip') argv = ['pip', ...argv.slice(3)];
  return argv;
}

function line(stem: string, tier: Line['tier'] = 'read', id = 'bash.more'): SegLine {
  return { glyph: '→', id, tier, stem };
}

function scriptName(path: string): string {
  return path.split('/').pop() ?? path;
}

const NPM_TASKS: Record<string, string> = {
  lint: 'Checking the code for mistakes',
  typecheck: 'Checking the code for mistakes',
  'type-check': 'Checking the code for mistakes',
  format: "Tidying the code's layout",
  dev: 'Starting the app',
  start: 'Starting the app',
  serve: 'Starting the app',
  preview: 'Starting the app',
};
const HELPER_TOOLS: Record<string, string> = {
  tsc: 'Checking the code for mistakes',
  eslint: 'Checking the code for mistakes',
  prettier: "Tidying the code's layout",
  vite: 'Starting the app',
};

/** Common commands the original rules had no sentence for. */
function moreLine(argv: string[]): SegLine | null {
  const [command = '', sub = '', third = ''] = argv;
  const args = argv.slice(1);
  if (args.length > 0 && args.every((a) => ['--version', '-v', '-V', '-version', 'version'].includes(a))) {
    return line(`Checking which version of ${command} is installed`);
  }
  if (command === 'clear') return line('Clearing the screen');
  if (FLOW.has(command) || ['for', 'while', 'until', 'done', 'fi', 'esac'].includes(command)) return null;
  if (['tree'].includes(command)) return line('Looking around the project');
  if (['less', 'more', 'bat'].includes(command)) return line('Looking at existing files');
  if (['du', 'df'].includes(command)) return line('Checking how much space things take up');
  if (['file', 'stat'].includes(command)) return line("Looking at a file's details");
  if (['which', 'type', 'whereis', 'realpath'].includes(command) || (command === 'command' && sub === '-v')) return line('Checking where something is on the computer');
  if (['env', 'printenv'].includes(command)) return line("Checking the computer's settings");
  if (['ps', 'lsof', 'pgrep', 'top'].includes(command)) return line('Checking which programs are running');
  if (['date', 'uname', 'whoami', 'hostname', 'id', 'history', 'sw_vers'].includes(command)) return line('Checking details about the computer');
  if (command === 'test' || command === '[' || command === '[[') return line('Checking whether something is there');
  if (command === 'diff' || command === 'cmp') return line('Comparing two files');
  if (command === 'sed' && args.some((a) => a === '-i' || a.startsWith('-i'))) return line('Changing text inside a file', 'action');
  if (['sed', 'awk', 'cut', 'sort', 'uniq', 'tr', 'xargs', 'column', 'nl'].includes(command)) return line("Reading through a file's contents");
  if (command === 'jq' || command === 'yq') return line('Pulling details out of a data file');
  if (['kill', 'pkill', 'killall'].includes(command)) return line('Stopping a running program', 'action');
  if (command === 'ping' || command === 'dig' || command === 'nslookup') return line('Checking the internet connection');
  if (command === 'open' || command === 'xdg-open') return line('Opening something on your computer', 'action');
  if (command === 'tar' && args.some((a) => /^-?[a-z]*x/.test(a))) return line('Unpacking an archive', 'action');
  if (command === 'tar' || command === 'zip') return line('Packing files into an archive', 'action');
  if (command === 'unzip' || command === 'gunzip') return line('Unpacking an archive', 'action');
  if (command === 'ln') return line('Linking to a file or folder', 'action');
  if (command === 'openssl') return line('Making or checking a security key', 'action');
  if (['psql', 'sqlite3', 'mysql', 'redis-cli', 'mongosh'].includes(command)) return line('Looking at the database');
  if (command === 'docker' || command === 'podman') {
    if (['ps', 'logs', 'images', 'inspect'].includes(sub)) return line("Checking the app's containers");
    if (sub === 'compose' && ['up', 'start'].includes(third)) return line("Starting the app's services", 'action');
    if (sub === 'compose' && ['down', 'stop'].includes(third)) return line("Stopping the app's services", 'action');
    return line("Managing the app's containers", 'action');
  }
  if (command === 'kubectl') return line(sub === 'get' || sub === 'describe' || sub === 'logs' ? "Checking the app's servers" : "Changing the app's servers", sub === 'get' ? 'read' : 'action');
  if (command === 'terraform') return line(sub === 'plan' ? 'Planning changes to the servers' : 'Changing the servers', sub === 'plan' ? 'read' : 'action');
  if (command === 'gh') return line(['list', 'view', 'status', 'diff', 'checks'].includes(third) ? 'Checking the project on GitHub' : 'Updating the project on GitHub', ['list', 'view', 'status', 'diff', 'checks'].includes(third) ? 'read' : 'action');
  if (PACKAGE_MANAGERS.has(command)) {
    const task = sub === 'run' ? third : sub;
    if (NPM_TASKS[task] !== undefined) return line(NPM_TASKS[task] ?? '', 'action');
    if (sub === 'outdated') return line('Checking for newer versions of its building blocks');
    if (sub === 'ls' || sub === 'list' || sub === 'why') return line('Checking which building blocks are installed');
    if (sub === 'run' && third !== '') return line(`Running the project's '${third}' task`, 'action');
  }
  if (['npx', 'pnpx', 'bunx'].includes(command) || (['pnpm', 'yarn', 'bun'].includes(command) && ['dlx', 'exec', 'x'].includes(sub))) {
    const tool = command.endsWith('x') && command !== 'npx' ? sub : ['dlx', 'exec', 'x'].includes(sub) ? third : sub;
    const name = tool.replace(/(.)@[^/]*$/, '$1');
    return line(HELPER_TOOLS[name] ?? `Running a helper tool (${name})`, 'action');
  }
  if ((command === 'go' || command === 'cargo') && sub === 'run') return line('Starting the program', 'action');
  if ((command === 'go' && sub === 'mod') || (command === 'cargo' && sub === 'update')) return line("Tidying the project's building blocks", 'action');
  if ((command === 'cargo' && sub === 'fmt') || command === 'gofmt' || (command === 'go' && sub === 'fmt')) return line("Tidying the code's layout", 'action');
  if (PYTHONS.has(command) && sub === '-m' && third === 'venv') return line('Setting up a separate Python workspace', 'action');
  if (PYTHONS.has(command) && sub === '-m' && third !== '') return line(`Running a Python tool (${third})`, 'action');
  if (['node', 'deno', 'bun', 'ruby', 'perl', 'php', 'python', 'python3'].includes(command)) {
    if (['-e', '-c', '--eval', '-p'].includes(sub)) return line('Running a quick snippet of code', 'action');
    if (args.includes('-')) return line('Running a quick snippet of code', 'action');
    const file = args.find((a) => !a.startsWith('-') && a !== 'run');
    if (file !== undefined) return line(`Running a script (${scriptName(file)})`, 'action');
  }
  if ((command === 'sh' || command === 'bash' || command === 'zsh') && sub !== '' && !sub.startsWith('-')) return line(`Running a script (${scriptName(sub)})`, 'action');
  if (command.startsWith('./') || /\.(sh|py|js|rb)$/.test(command)) return line(`Running a script (${scriptName(command)})`, 'action');
  return null;
}

function classifySegment(segment: string, level: Level): SegLine {
  const argv = normalizeArgv(tokenize(segment));
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
    if (level === 'plain') {
      if (command === 'echo') {
        return line(argv.slice(1).some((a) => a.startsWith('$')) ? "Checking the computer's settings" : 'Showing a message');
      }
      if (command === 'pwd') return line('Checking which folder it is working in');
      if (command === 'which') return line('Checking where something is on the computer');
      if (command === 'wc') return line('Counting what is in a file');
      if (command === 'tail' && argv.includes('-f')) return line('Watching a log as it grows');
    }
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

  const more = moreLine(argv);
  if (more !== null) return more;
  if (['for', 'while', 'until'].includes(command)) {
    return { ...line('Repeating a step', 'read', 'bash.flow') };
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
        ? `Writing over '${danger.target}'; anything already in it is lost`
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

  // Moving to a folder or setting a variable is not a step anyone asked for:
  // `cd app && npm test` is a test run, not "+1 more step".
  const all = splitSegments(stripHeredocs(command).command);
  const steps = all.filter(
    (segment) => !NAVIGATION.has(tokenize(segment)[0] ?? ''),
  );
  const segments = steps.length > 0 ? steps : all;
  const classified = segments.map((segment) =>
    classifySegment(segment, level),
  );
  const actions = classified.filter((segment) => segment.tier === 'action');
  // Filler (a pause, staging before a commit, an unknown script) never names
  // a chain when a step that says what the chain is for comes later.
  const meaningful = actions.filter(
    (segment) => segment.id !== 'bash.generic' && segment.id !== 'bash.git.add',
  );
  const picked =
    meaningful[0] ??
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
