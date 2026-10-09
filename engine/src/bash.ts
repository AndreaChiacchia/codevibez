/**
 * Shell text in, danger verdict out.
 *
 * Two properties matter more than coverage here, and they pull in opposite
 * directions from ordinary parsing:
 *
 * 1. A missed destructive command is the worst possible failure. codevibez's
 *    whole claim is that you can trust the feed, so silence about a deletion
 *    is worse than a false alarm. Where a heuristic could go either way, it
 *    goes toward warning.
 * 2. The most severe hit in a command wins. Returning the first match found
 *    let a harmless `> /dev/null` on the end of a line hide the `rm -rf` at
 *    the start of it.
 */

export function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command.charAt(index);
    const next = command.charAt(index + 1);

    if (character === '\\' && (next === '\n' || next === '\r')) {
      index += next === '\r' && command.charAt(index + 2) === '\n' ? 2 : 1;
      continue;
    }
    if (character === '\\' && [';', '|', '&'].includes(next)) {
      current += `${character}${next}`;
      index += 1;
      continue;
    }

    if (quote !== null) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === '&' && next === '&') {
      segments.push(current);
      current = '';
      index += 1;
      continue;
    }

    // `>|` is a single forced-clobber operator, so the pipe must not split it.
    if (character === '|' && command.charAt(index - 1) === '>') {
      current += character;
      continue;
    }

    if (
      character === ';' ||
      character === '|' ||
      character === '&' ||
      character === '\n' ||
      character === '\r'
    ) {
      segments.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment.charAt(index);
    const next = segment.charAt(index + 1);

    if (character === '\\' && (next === '\n' || next === '\r')) {
      index += next === '\r' && segment.charAt(index + 2) === '\n' ? 2 : 1;
      continue;
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current !== '') tokens.push(current);
  return tokens;
}

export interface DangerHit {
  reason:
    | 'delete'
    | 'delete-untracked'
    | 'overwrite-history'
    | 'discard-changes'
    | 'discard-worktree'
    | 'overwrite'
    | 'permissions'
    | 'drop-data';
  target: string;
  recursive?: boolean;
}

/**
 * How much each kind of destruction outranks the others. Losing tracked work
 * outranks clobbering one file, and anything outranks a redirect, which is the
 * weakest signal and the one most likely to appear incidentally.
 */
const SEVERITY: Record<DangerHit['reason'], number> = {
  delete: 6,
  'delete-untracked': 6,
  'discard-changes': 5,
  'discard-worktree': 5,
  'overwrite-history': 5,
  'drop-data': 6,
  permissions: 2,
  overwrite: 1,
};

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DELETE_EXECUTABLES = new Set(['rm', 'rmdir', 'rimraf', 'del']);
const WRAPPERS = new Set(['sudo', 'env', 'command', 'nice', 'time', 'doas']);
/** Control-flow words that sit where a command name would otherwise be. */
const KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi',
  'while', 'until', 'do', 'done',
  'case', 'esac', 'in',
  '{', '}', '(', ')', '!', 'exec',
]);
/** Writing here destroys nothing, so it must never register as an overwrite. */
const PERMISSION_EXECUTABLES = new Set(['chmod', 'chown', 'chgrp']);
const DATABASE_CLIENTS = new Set([
  'psql',
  'mysql',
  'mariadb',
  'sqlite3',
  'duckdb',
  'cockroach',
  'clickhouse-client',
  'mongosh',
  'mongo',
]);
const DROP_SQL =
  /\b(?:drop\s+(table|database|schema|collection|view)|truncate(?:\s+table)?)\s+(?:if\s+exists\s+)?([A-Za-z0-9_."`$-]+)/i;
const DROP_MONGO = /\b(?:db\.dropDatabase\(\)|\.drop\(\))/;

const NULL_SINKS = /^\/dev\/(null|zero|stdout|stderr|tty|fd\/\d+)$/;

function executableName(value: string): string {
  return value.split('/').pop() ?? value;
}

/** Matches a redirection operator, standalone (`>`, `2>`) or attached (`2>/dev/null`). */
const REDIRECTION = /^\d*>{1,2}\|?/;

/**
 * Everything before the first redirection.
 *
 * Without this, `rm -rf node_modules > /dev/null` reports its target as
 * "node_modules, >, /dev/null": the operator and the sink read as extra files
 * being deleted, which is both wrong and alarming.
 */
function stripRedirections(argv: string[]): string[] {
  const cut = argv.findIndex((argument) => REDIRECTION.test(argument));
  return cut === -1 ? argv : argv.slice(0, cut);
}

function positionalArgs(argv: string[], start: number): string[] {
  return stripRedirections(argv.slice(start)).filter(
    (argument) =>
      !argument.startsWith('-') &&
      argument !== '{}' &&
      argument !== '+' &&
      argument !== ';' &&
      argument !== '\\;',
  );
}

/** Drop everything from an unquoted `#` onward, so a comment is never a target. */
export function stripComment(segment: string): string {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment.charAt(index);
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(segment.charAt(index - 1)))) {
      return segment.slice(0, index);
    }
  }
  return segment;
}

/**
 * Lift heredoc bodies out of the command.
 *
 * Newlines separate commands, so without this a file being *written* with
 * documentation about `rm -rf build` is read as a command that performs it. The
 * bodies are returned rather than discarded because `bash <<EOF` really does
 * execute what is inside.
 */
export function stripHeredocs(command: string): { command: string; bodies: string[] } {
  if (!command.includes('<<')) return { command, bodies: [] };
  const lines = command.split('\n');
  const kept: string[] = [];
  const bodies: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    kept.push(line);
    index += 1;
    const header = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (header) {
      const delimiter = header[2] ?? '';
      const body: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim() !== delimiter) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      bodies.push(body.join('\n'));
    }
  }
  return { command: kept.join('\n'), bodies };
}

function stripWrapper(argv: string[]): string[] {
  const normalized = [...argv];

  const dropNoise = (): void => {
    while (
      normalized[0] !== undefined &&
      (ASSIGNMENT.test(normalized[0]) || KEYWORDS.has(normalized[0]))
    ) {
      normalized.shift();
    }
  };

  dropNoise();
  while (WRAPPERS.has(executableName(normalized[0] ?? ''))) {
    const wrapper = executableName(normalized.shift() ?? '');
    while (normalized[0]?.startsWith('-')) {
      const option = normalized.shift() ?? '';
      const takesValue =
        (wrapper === 'sudo' && ['-u', '-g', '-h', '-p', '-C', '-T', '-R', '-D'].includes(option)) ||
        (wrapper === 'env' && ['-u', '--unset'].includes(option)) ||
        (wrapper === 'nice' && option === '-n') ||
        (wrapper === 'time' && ['-f', '-o'].includes(option));
      if (takesValue) normalized.shift();
    }
    dropNoise();
  }

  if (normalized[0] === 'npx') return normalized.slice(1);
  if (
    ['yarn', 'pnpm', 'bun'].includes(normalized[0] ?? '') &&
    ['dlx', 'exec', 'x'].includes(normalized[1] ?? '')
  ) {
    return normalized.slice(2);
  }
  return normalized;
}

function deleteHit(argv: string[], executableIndex: number, fallbackTarget = 'files'): DangerHit {
  const executable = executableName(argv[executableIndex] ?? '');
  const targets = positionalArgs(argv, executableIndex + 1);
  const recursive =
    executable === 'rimraf' ||
    stripRedirections(argv.slice(executableIndex + 1))
      .some((argument) => argument === '--recursive' || /^-[^-]*[rR]/.test(argument)) ||
    targets.some((value) => value.endsWith('/'));
  return {
    reason: 'delete',
    target: targets.join(', ') || fallbackTarget,
    recursive,
  };
}

function redirectionTarget(segment: string): string | null {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment.charAt(index);
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (
      character === '>' &&
      segment.charAt(index - 1) !== '>' &&
      segment.charAt(index + 1) !== '>'
    ) {
      const rest = segment.slice(index + 1).replace(/^\|/, '');
      const target = tokenize(rest)[0] ?? '';
      if (target === '' || target.startsWith('&')) continue;
      if (NULL_SINKS.test(target)) continue;
      return target;
    }
  }
  return null;
}

function gitCommand(argv: string[]): { index: number; subcommand: string } | null {
  if (executableName(argv[0] ?? '') !== 'git') return null;
  let index = 1;
  while (index < argv.length) {
    const argument = argv[index] ?? '';
    if (argument === '-C' || argument === '-c') {
      index += 2;
      continue;
    }
    if (['--git-dir', '--work-tree', '--namespace'].includes(argument)) {
      index += 2;
      continue;
    }
    if (argument.startsWith('-')) {
      index += 1;
      continue;
    }
    return { index, subcommand: argument };
  }
  return null;
}

/**
 * Command substitutions and subshells, extracted with quote tracking so that
 * prose merely *mentioning* a command is not treated as one. Without this,
 * `git commit -m "fix (rm -rf dist) call"` warns about a deletion.
 */
function nestedCommands(command: string): string[] {
  const nested: string[] = [];
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command.charAt(index);
    if (quote !== null) {
      if (character === quote) quote = null;
      // Inside double quotes a substitution still runs; inside single quotes
      // nothing does, so only the former is worth extracting.
      else if (quote === '"' && character === '$' && command.charAt(index + 1) === '(') {
        const end = command.indexOf(')', index);
        if (end > index) {
          nested.push(command.slice(index + 2, end));
          index = end;
        }
      } else if (quote === '"' && character === '`') {
        const end = command.indexOf('`', index + 1);
        if (end > index) {
          nested.push(command.slice(index + 1, end));
          index = end;
        }
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '$' && command.charAt(index + 1) === '(') {
      const end = command.indexOf(')', index);
      if (end > index) {
        nested.push(command.slice(index + 2, end));
        index = end;
      }
      continue;
    }
    if (character === '`') {
      const end = command.indexOf('`', index + 1);
      if (end > index) {
        nested.push(command.slice(index + 1, end));
        index = end;
      }
      continue;
    }
    if (character === '(' && (index === 0 || /[\s;|&]/.test(command.charAt(index - 1)))) {
      const end = command.indexOf(')', index);
      if (end > index) {
        nested.push(command.slice(index + 1, end));
        index = end;
      }
    }
  }
  return nested.filter((payload) => payload.trim() !== '');
}

/** True for `-c` and for any bundled cluster containing it, such as `-lc` or `-cx`. */
function shellCommandFlag(argument: string): boolean {
  return (
    argument === '--command' ||
    (/^-[a-zA-Z]+$/.test(argument) && argument.includes('c'))
  );
}

/**
 * A path-shaped argument to `git checkout` means "throw away my edits to this",
 * which is nothing like switching branches. Refs and paths are genuinely
 * ambiguous, so this leans toward warning: a needless caution costs a glance,
 * while silence here costs someone their work.
 */
function looksLikePath(value: string): boolean {
  return value === '.' || value.includes('*') || /\.[a-zA-Z]{1,5}$/.test(value) || value.endsWith('/');
}

function collectSegmentHits(segment: string, depth: number): DangerHit[] {
  const hits: DangerHit[] = [];
  if (depth > 8) return hits;

  const cleaned = stripComment(segment);

  for (const nested of nestedCommands(cleaned)) {
    hits.push(...collectHits(nested, depth + 1));
  }

  const argv = stripWrapper(tokenize(cleaned));
  const executable = executableName(argv[0] ?? '');

  // A shell invoked with -c runs its argument, so the argument is the command.
  if (['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(executable)) {
    const flagIndex = argv.findIndex((argument, index) => index > 0 && shellCommandFlag(argument));
    const payload = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
    if (payload !== undefined) hits.push(...collectHits(payload, depth + 1));
  }

  if (DELETE_EXECUTABLES.has(executable)) hits.push(deleteHit(argv, 0));

  const xargsIndex = argv.findIndex((argument) => executableName(argument) === 'xargs');
  if (xargsIndex >= 0) {
    const deleteIndex = argv.findIndex(
      (argument, index) => index > xargsIndex && DELETE_EXECUTABLES.has(executableName(argument)),
    );
    if (deleteIndex >= 0) hits.push(deleteHit(argv, deleteIndex, 'the files it just listed'));
  }

  if (executable === 'find') {
    const root = argv[1] ?? '.';
    if (argv.includes('-delete')) {
      hits.push({ reason: 'delete', target: `matching files inside '${root}'`, recursive: false });
    }
    const execIndex = argv.findIndex((argument) => argument === '-exec' || argument === '-execdir');
    if (execIndex >= 0) {
      const deleteIndex = argv.findIndex(
        (argument, index) => index > execIndex && DELETE_EXECUTABLES.has(executableName(argument)),
      );
      if (deleteIndex >= 0) {
        hits.push({
          reason: 'delete',
          target: `matching files inside '${root}'`,
          recursive: false,
        });
      }
    }
  }

  if (executable === 'truncate') {
    const zeroSize =
      argv.includes('-s0') ||
      argv.some(
        (argument, index) =>
          (argument === '-s' || argument === '--size') && argv[index + 1] === '0',
      );
    if (zeroSize) hits.push({ reason: 'overwrite', target: argv.at(-1) ?? 'a file' });
  }

  if (executable === 'dd') {
    const output = argv.find((argument) => argument.startsWith('of='));
    if (output !== undefined) {
      hits.push({ reason: 'overwrite', target: output.slice(3) || 'a file or device' });
    }
  }

  if (PERMISSION_EXECUTABLES.has(executable)) {
    const options = argv.slice(1).filter((argument) => argument.startsWith('-'));
    const positionals = positionalArgs(argv, 1);
    // chmod and chown take the new mode or owner first; the rest are targets.
    const targets = positionals.length > 1 ? positionals.slice(1) : positionals;
    hits.push({
      reason: 'permissions',
      target: targets.join(', ') || 'files',
      recursive: options.some((option) => option === '--recursive' || /^-[^-]*R/.test(option)),
    });
  }

  if (executable === 'dropdb') {
    hits.push({ reason: 'drop-data', target: positionalArgs(argv, 1).at(-1) ?? 'a database' });
  }

  if (executable === 'redis-cli' && argv.some((argument) => /^flush(all|db)$/i.test(argument))) {
    hits.push({ reason: 'drop-data', target: 'everything stored in Redis' });
  }

  if (
    executable === 'prisma' &&
    ((argv[1] === 'migrate' && argv[2] === 'reset') ||
      (argv[1] === 'db' && argv[2] === 'push' && argv.includes('--force-reset')))
  ) {
    hits.push({ reason: 'drop-data', target: "the project's database" });
  }

  if (DATABASE_CLIENTS.has(executable)) {
    for (const argument of argv.slice(1)) {
      const sql = DROP_SQL.exec(argument);
      if (sql !== null) {
        const kind = (sql[1] ?? 'table').toLowerCase();
        hits.push({ reason: 'drop-data', target: `${kind} ${sql[2] ?? ''}`.trim() });
        break;
      }
      if (DROP_MONGO.test(argument)) {
        hits.push({ reason: 'drop-data', target: 'a database collection' });
        break;
      }
    }
  }

  const redirection = redirectionTarget(cleaned);
  if (redirection !== null) hits.push({ reason: 'overwrite', target: redirection });

  const git = gitCommand(argv);
  if (git !== null) {
    const gitArgs = argv.slice(git.index + 1);
    const positionals = positionalArgs(argv, git.index + 1);

    if (
      git.subcommand === 'push' &&
      (gitArgs.some((argument) =>
        ['--force', '--force-with-lease'].includes(argument) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(argument)) ||
        gitArgs.some((argument) => argument.startsWith('+')))
    ) {
      hits.push({ reason: 'overwrite-history', target: positionals.join(' ') || 'remote' });
    }

    if (git.subcommand === 'reset' && gitArgs.includes('--hard')) {
      hits.push({
        reason: 'discard-changes',
        target: positionals[0] ?? 'working copy',
      });
    }

    if (
      git.subcommand === 'clean' &&
      gitArgs.some((argument) => argument === '--force' || /^-[a-z]*f[a-z]*$/i.test(argument))
    ) {
      hits.push({ reason: 'delete-untracked', target: 'untracked files' });
    }

    if (
      git.subcommand === 'checkout' &&
      !gitArgs.some((argument) => ['-b', '-B', '--track', '--orphan'].includes(argument))
    ) {
      const separator = gitArgs.indexOf('--');
      const paths = separator >= 0 ? gitArgs.slice(separator + 1) : positionals.filter(looksLikePath);
      if (paths.length > 0) {
        hits.push({ reason: 'discard-worktree', target: paths.join(', ') });
      }
    }

    // `git restore --staged` only unstages; the working copy is untouched, so
    // warning about it would be a false alarm about losing work.
    if (git.subcommand === 'restore') {
      const stagedOnly =
        gitArgs.some((argument) => argument === '--staged' || argument === '-S') &&
        !gitArgs.some((argument) => argument === '--worktree' || argument === '-W');
      if (!stagedOnly) {
        hits.push({ reason: 'discard-worktree', target: positionals.join(', ') || 'working copy' });
      }
    }

    if (
      git.subcommand === 'branch' &&
      gitArgs.some((argument) => ['-D', '-d', '--delete'].includes(argument))
    ) {
      hits.push({ reason: 'delete', target: positionals.join(', ') || 'a branch', recursive: false });
    }

    if (git.subcommand === 'stash' && ['drop', 'clear'].includes(positionals[0] ?? '')) {
      hits.push({ reason: 'delete', target: 'stashed changes', recursive: false });
    }

    if (
      git.subcommand === 'worktree' &&
      positionals[0] === 'remove' &&
      gitArgs.some((argument) => argument === '--force' || argument === '-f')
    ) {
      hits.push({ reason: 'delete', target: positionals[1] ?? 'a worktree', recursive: true });
    }
  }

  return hits;
}

function collectHits(command: string, depth: number): DangerHit[] {
  const { command: withoutBodies, bodies } = stripHeredocs(command);
  const hits: DangerHit[] = [];
  for (const segment of splitSegments(withoutBodies)) {
    hits.push(...collectSegmentHits(segment, depth));
  }
  // A heredoc fed to a shell is executed; fed to anything else it is data.
  const firstWord = executableName(tokenize(splitSegments(withoutBodies)[0] ?? '')[0] ?? '');
  if (bodies.length > 0 && ['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(firstWord)) {
    for (const body of bodies) hits.push(...collectHits(body, depth + 1));
  }
  return hits;
}

/**
 * The most severe hit in the whole command, so an incidental redirect can never
 * hide a deletion that happens beside it.
 */
export function detectDanger(command: string): DangerHit | null {
  const hits = collectHits(command, 0);
  if (hits.length === 0) return null;
  return hits.reduce((best, hit) => (SEVERITY[hit.reason] > SEVERITY[best.reason] ? hit : best));
}
