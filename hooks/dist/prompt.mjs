// ../codevibez-cli/packages/core/dist/prompt.js
function formatPrompt(text, limit = 80) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}\u2026` : collapsed;
}

// ../codevibez-cli/packages/core/dist/bash.js
function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command.charAt(index);
    const next = command.charAt(index + 1);
    if (character === "\\" && (next === "\n" || next === "\r")) {
      index += next === "\r" && command.charAt(index + 2) === "\n" ? 2 : 1;
      continue;
    }
    if (character === "\\" && [";", "|", "&"].includes(next)) {
      current += `${character}${next}`;
      index += 1;
      continue;
    }
    if (quote !== null) {
      current += character;
      if (character === quote)
        quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "&" && next === "&") {
      segments.push(current);
      current = "";
      index += 1;
      continue;
    }
    if (character === "|" && command.charAt(index - 1) === ">") {
      current += character;
      continue;
    }
    if (character === ";" || character === "|" || character === "&" || character === "\n" || character === "\r") {
      segments.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}
function tokenize(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment.charAt(index);
    const next = segment.charAt(index + 1);
    if (character === "\\" && (next === "\n" || next === "\r")) {
      index += next === "\r" && segment.charAt(index + 2) === "\n" ? 2 : 1;
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
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current !== "")
    tokens.push(current);
  return tokens;
}
var SEVERITY = {
  delete: 6,
  "delete-untracked": 6,
  "discard-changes": 5,
  "discard-worktree": 5,
  "overwrite-history": 5,
  overwrite: 1
};
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
var DELETE_EXECUTABLES = /* @__PURE__ */ new Set(["rm", "rmdir", "rimraf", "del"]);
var WRAPPERS = /* @__PURE__ */ new Set(["sudo", "env", "command", "nice", "time", "doas"]);
var KEYWORDS = /* @__PURE__ */ new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "{",
  "}",
  "(",
  ")",
  "!",
  "exec"
]);
var NULL_SINKS = /^\/dev\/(null|zero|stdout|stderr|tty|fd\/\d+)$/;
function executableName(value) {
  return value.split("/").pop() ?? value;
}
var REDIRECTION = /^\d*>{1,2}\|?/;
function stripRedirections(argv) {
  const cut = argv.findIndex((argument) => REDIRECTION.test(argument));
  return cut === -1 ? argv : argv.slice(0, cut);
}
function positionalArgs(argv, start) {
  return stripRedirections(argv.slice(start)).filter((argument) => !argument.startsWith("-") && argument !== "{}" && argument !== "+" && argument !== ";" && argument !== "\\;");
}
function stripComment(segment) {
  let quote = null;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment.charAt(index);
    if (quote !== null) {
      if (character === quote)
        quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(segment.charAt(index - 1)))) {
      return segment.slice(0, index);
    }
  }
  return segment;
}
function stripHeredocs(command) {
  if (!command.includes("<<"))
    return { command, bodies: [] };
  const lines = command.split("\n");
  const kept = [];
  const bodies = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    kept.push(line);
    index += 1;
    const header = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (header) {
      const delimiter = header[2] ?? "";
      const body = [];
      while (index < lines.length && (lines[index] ?? "").trim() !== delimiter) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      bodies.push(body.join("\n"));
    }
  }
  return { command: kept.join("\n"), bodies };
}
function stripWrapper(argv) {
  const normalized = [...argv];
  const dropNoise = () => {
    while (normalized[0] !== void 0 && (ASSIGNMENT.test(normalized[0]) || KEYWORDS.has(normalized[0]))) {
      normalized.shift();
    }
  };
  dropNoise();
  while (WRAPPERS.has(executableName(normalized[0] ?? ""))) {
    const wrapper = executableName(normalized.shift() ?? "");
    while (normalized[0]?.startsWith("-")) {
      const option = normalized.shift() ?? "";
      const takesValue = wrapper === "sudo" && ["-u", "-g", "-h", "-p", "-C", "-T", "-R", "-D"].includes(option) || wrapper === "env" && ["-u", "--unset"].includes(option) || wrapper === "nice" && option === "-n" || wrapper === "time" && ["-f", "-o"].includes(option);
      if (takesValue)
        normalized.shift();
    }
    dropNoise();
  }
  if (normalized[0] === "npx")
    return normalized.slice(1);
  if (["yarn", "pnpm", "bun"].includes(normalized[0] ?? "") && ["dlx", "exec", "x"].includes(normalized[1] ?? "")) {
    return normalized.slice(2);
  }
  return normalized;
}
function deleteHit(argv, executableIndex, fallbackTarget = "files") {
  const executable = executableName(argv[executableIndex] ?? "");
  const targets = positionalArgs(argv, executableIndex + 1);
  const recursive = executable === "rimraf" || stripRedirections(argv.slice(executableIndex + 1)).some((argument) => argument === "--recursive" || /^-[^-]*[rR]/.test(argument)) || targets.some((value) => value.endsWith("/"));
  return {
    reason: "delete",
    target: targets.join(", ") || fallbackTarget,
    recursive
  };
}
function redirectionTarget(segment) {
  let quote = null;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment.charAt(index);
    if (quote !== null) {
      if (character === quote)
        quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">" && segment.charAt(index - 1) !== ">" && segment.charAt(index + 1) !== ">") {
      const rest = segment.slice(index + 1).replace(/^\|/, "");
      const target = tokenize(rest)[0] ?? "";
      if (target === "" || target.startsWith("&"))
        continue;
      if (NULL_SINKS.test(target))
        continue;
      return target;
    }
  }
  return null;
}
function gitCommand(argv) {
  if (executableName(argv[0] ?? "") !== "git")
    return null;
  let index = 1;
  while (index < argv.length) {
    const argument = argv[index] ?? "";
    if (argument === "-C" || argument === "-c") {
      index += 2;
      continue;
    }
    if (["--git-dir", "--work-tree", "--namespace"].includes(argument)) {
      index += 2;
      continue;
    }
    if (argument.startsWith("-")) {
      index += 1;
      continue;
    }
    return { index, subcommand: argument };
  }
  return null;
}
function nestedCommands(command) {
  const nested = [];
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command.charAt(index);
    if (quote !== null) {
      if (character === quote)
        quote = null;
      else if (quote === '"' && character === "$" && command.charAt(index + 1) === "(") {
        const end = command.indexOf(")", index);
        if (end > index) {
          nested.push(command.slice(index + 2, end));
          index = end;
        }
      } else if (quote === '"' && character === "`") {
        const end = command.indexOf("`", index + 1);
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
    if (character === "$" && command.charAt(index + 1) === "(") {
      const end = command.indexOf(")", index);
      if (end > index) {
        nested.push(command.slice(index + 2, end));
        index = end;
      }
      continue;
    }
    if (character === "`") {
      const end = command.indexOf("`", index + 1);
      if (end > index) {
        nested.push(command.slice(index + 1, end));
        index = end;
      }
      continue;
    }
    if (character === "(" && (index === 0 || /[\s;|&]/.test(command.charAt(index - 1)))) {
      const end = command.indexOf(")", index);
      if (end > index) {
        nested.push(command.slice(index + 1, end));
        index = end;
      }
    }
  }
  return nested.filter((payload) => payload.trim() !== "");
}
function shellCommandFlag(argument) {
  return argument === "--command" || /^-[a-zA-Z]+$/.test(argument) && argument.includes("c");
}
function looksLikePath(value) {
  return value === "." || value.includes("*") || /\.[a-zA-Z]{1,5}$/.test(value) || value.endsWith("/");
}
function collectSegmentHits(segment, depth) {
  const hits = [];
  if (depth > 8)
    return hits;
  const cleaned = stripComment(segment);
  for (const nested of nestedCommands(cleaned)) {
    hits.push(...collectHits(nested, depth + 1));
  }
  const argv = stripWrapper(tokenize(cleaned));
  const executable = executableName(argv[0] ?? "");
  if (["sh", "bash", "zsh", "dash", "ksh"].includes(executable)) {
    const flagIndex = argv.findIndex((argument, index) => index > 0 && shellCommandFlag(argument));
    const payload = flagIndex >= 0 ? argv[flagIndex + 1] : void 0;
    if (payload !== void 0)
      hits.push(...collectHits(payload, depth + 1));
  }
  if (DELETE_EXECUTABLES.has(executable))
    hits.push(deleteHit(argv, 0));
  const xargsIndex = argv.findIndex((argument) => executableName(argument) === "xargs");
  if (xargsIndex >= 0) {
    const deleteIndex = argv.findIndex((argument, index) => index > xargsIndex && DELETE_EXECUTABLES.has(executableName(argument)));
    if (deleteIndex >= 0)
      hits.push(deleteHit(argv, deleteIndex, "the files it just listed"));
  }
  if (executable === "find") {
    const root = argv[1] ?? ".";
    if (argv.includes("-delete")) {
      hits.push({ reason: "delete", target: `matching files inside '${root}'`, recursive: false });
    }
    const execIndex = argv.findIndex((argument) => argument === "-exec" || argument === "-execdir");
    if (execIndex >= 0) {
      const deleteIndex = argv.findIndex((argument, index) => index > execIndex && DELETE_EXECUTABLES.has(executableName(argument)));
      if (deleteIndex >= 0) {
        hits.push({
          reason: "delete",
          target: `matching files inside '${root}'`,
          recursive: false
        });
      }
    }
  }
  if (executable === "truncate") {
    const zeroSize = argv.includes("-s0") || argv.some((argument, index) => (argument === "-s" || argument === "--size") && argv[index + 1] === "0");
    if (zeroSize)
      hits.push({ reason: "overwrite", target: argv.at(-1) ?? "a file" });
  }
  if (executable === "dd") {
    const output = argv.find((argument) => argument.startsWith("of="));
    if (output !== void 0) {
      hits.push({ reason: "overwrite", target: output.slice(3) || "a file or device" });
    }
  }
  const redirection = redirectionTarget(cleaned);
  if (redirection !== null)
    hits.push({ reason: "overwrite", target: redirection });
  const git = gitCommand(argv);
  if (git !== null) {
    const gitArgs = argv.slice(git.index + 1);
    const positionals = positionalArgs(argv, git.index + 1);
    if (git.subcommand === "push" && (gitArgs.some((argument) => ["--force", "--force-with-lease"].includes(argument) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(argument)) || gitArgs.some((argument) => argument.startsWith("+")))) {
      hits.push({ reason: "overwrite-history", target: positionals.join(" ") || "remote" });
    }
    if (git.subcommand === "reset" && gitArgs.includes("--hard")) {
      hits.push({
        reason: "discard-changes",
        target: positionals[0] ?? "working copy"
      });
    }
    if (git.subcommand === "clean" && gitArgs.some((argument) => argument === "--force" || /^-[a-z]*f[a-z]*$/i.test(argument))) {
      hits.push({ reason: "delete-untracked", target: "untracked files" });
    }
    if (git.subcommand === "checkout" && !gitArgs.some((argument) => ["-b", "-B", "--track", "--orphan"].includes(argument))) {
      const separator = gitArgs.indexOf("--");
      const paths = separator >= 0 ? gitArgs.slice(separator + 1) : positionals.filter(looksLikePath);
      if (paths.length > 0) {
        hits.push({ reason: "discard-worktree", target: paths.join(", ") });
      }
    }
    if (git.subcommand === "restore") {
      const stagedOnly = gitArgs.some((argument) => argument === "--staged" || argument === "-S") && !gitArgs.some((argument) => argument === "--worktree" || argument === "-W");
      if (!stagedOnly) {
        hits.push({ reason: "discard-worktree", target: positionals.join(", ") || "working copy" });
      }
    }
    if (git.subcommand === "branch" && gitArgs.some((argument) => ["-D", "-d", "--delete"].includes(argument))) {
      hits.push({ reason: "delete", target: positionals.join(", ") || "a branch", recursive: false });
    }
    if (git.subcommand === "stash" && ["drop", "clear"].includes(positionals[0] ?? "")) {
      hits.push({ reason: "delete", target: "stashed changes", recursive: false });
    }
    if (git.subcommand === "worktree" && positionals[0] === "remove" && gitArgs.some((argument) => argument === "--force" || argument === "-f")) {
      hits.push({ reason: "delete", target: positionals[1] ?? "a worktree", recursive: true });
    }
  }
  return hits;
}
function collectHits(command, depth) {
  const { command: withoutBodies, bodies } = stripHeredocs(command);
  const hits = [];
  for (const segment of splitSegments(withoutBodies)) {
    hits.push(...collectSegmentHits(segment, depth));
  }
  const firstWord = executableName(tokenize(splitSegments(withoutBodies)[0] ?? "")[0] ?? "");
  if (bodies.length > 0 && ["sh", "bash", "zsh", "dash", "ksh"].includes(firstWord)) {
    for (const body of bodies)
      hits.push(...collectHits(body, depth + 1));
  }
  return hits;
}
function detectDanger(command) {
  const hits = collectHits(command, 0);
  if (hits.length === 0)
    return null;
  return hits.reduce((best, hit) => SEVERITY[hit.reason] > SEVERITY[best.reason] ? hit : best);
}

// ../codevibez-cli/packages/core/dist/words.js
function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}
function counted(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${plural(count, singular, pluralForm)}`;
}

// ../codevibez-cli/packages/core/dist/rules/bash-rules.js
var PACKAGE_MANAGERS = /* @__PURE__ */ new Set(["npm", "pnpm", "yarn", "bun"]);
var READ_COMMANDS = /* @__PURE__ */ new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "pwd",
  "which",
  "echo",
  "grep",
  "rg",
  "wc",
  "stat"
]);
var TEST_BINS = /* @__PURE__ */ new Set([
  "vitest",
  "jest",
  "pytest",
  "mocha",
  "playwright"
]);
function lineText(stem, facts) {
  return facts === void 0 ? stem : `${stem} ${facts}`;
}
function asLine(command, segment, tier = segment.tier) {
  return {
    glyph: segment.glyph,
    id: segment.id,
    stem: segment.stem,
    ...segment.facts === void 0 ? {} : { facts: segment.facts },
    text: lineText(segment.stem, segment.facts),
    severity: "info",
    tier,
    raw: command,
    ...segment.generic === true ? { generic: true } : {}
  };
}
function packageNames(argv) {
  const names = argv.slice(2).filter((argument) => !argument.startsWith("-"));
  return names.length === 0 ? null : names.join(", ");
}
function testBin(argv) {
  const command = argv[0] ?? "";
  return command === "npx" ? argv[1] ?? "test runner" : command;
}
function kindOfSegment(argv) {
  const command = argv[0] ?? "";
  const subcommand = argv[1] ?? "";
  const bin = testBin(argv);
  if (TEST_BINS.has(bin) || command === "cargo" && subcommand === "test" || command === "go" && subcommand === "test" || PACKAGE_MANAGERS.has(command) && (subcommand === "test" || subcommand === "run" && argv[2] === "test")) {
    return "test";
  }
  if (PACKAGE_MANAGERS.has(command) && (subcommand === "ci" || subcommand === "install" || subcommand === "add" || subcommand === "i")) {
    return "install";
  }
  if (PACKAGE_MANAGERS.has(command) && (subcommand === "remove" || subcommand === "uninstall" || subcommand === "rm")) {
    return "remove";
  }
  if (command === "tsc" || command === "cargo" && subcommand === "build" || command === "go" && subcommand === "build" || PACKAGE_MANAGERS.has(command) && subcommand === "run" && argv[2] === "build") {
    return "build";
  }
  if (READ_COMMANDS.has(command) || command === "find" && !argv.includes("-delete") && !argv.includes("-exec") && !argv.includes("-execdir") || command === "git" && ["status", "log", "diff", "show"].includes(subcommand)) {
    return "read";
  }
  if (command === "git" || ["mkdir", "cp", "mv", "touch", "chmod", "curl", "wget"].includes(command)) {
    return "action";
  }
  return "generic";
}
function testLine(level, runner) {
  return {
    glyph: "\u2192",
    id: "bash.test",
    tier: "action",
    stem: level === "plain" ? "Checking everything still works\u2026" : `Running the test suite (${runner || "test runner"})`
  };
}
function gitLine(argv, level) {
  const subcommand = argv[1] ?? "";
  if (["status", "log", "diff", "show"].includes(subcommand)) {
    return {
      glyph: "\u2192",
      id: "bash.read",
      tier: "read",
      stem: level === "plain" ? "Checking the state of the work" : `Inspecting changes with git ${subcommand}`
    };
  }
  if (subcommand === "commit") {
    return {
      glyph: "\u2192",
      id: "bash.commit",
      tier: "action",
      stem: level === "plain" ? "Saving a checkpoint of the work" : "Committing changes"
    };
  }
  if (subcommand === "checkout" && argv.includes("-b") || subcommand === "branch") {
    const branch = subcommand === "checkout" ? argv[argv.indexOf("-b") + 1] ?? "a branch" : argv[2] ?? "a branch";
    return {
      glyph: "\u2192",
      id: "bash.branch",
      tier: "action",
      stem: level === "plain" ? "Starting work on a separate track" : `Creating branch ${branch}`
    };
  }
  if (subcommand === "checkout" || subcommand === "switch") {
    const target = argv.slice(2).find((argument) => !argument.startsWith("-")) ?? "another branch";
    return {
      glyph: "\u2192",
      id: "bash.branch",
      tier: "action",
      stem: level === "plain" ? "Moving to another track of work" : `Switching to ${target}`
    };
  }
  const developer = {
    add: "Staging changes",
    pull: "Pulling changes",
    push: "Pushing changes",
    merge: "Merging changes"
  };
  const plain = {
    add: "Preparing changes for a checkpoint",
    pull: "Bringing in the latest shared work",
    push: "Sharing the saved work",
    merge: "Combining separate tracks of work"
  };
  const selected = level === "plain" ? plain[subcommand] : developer[subcommand];
  return {
    glyph: "\u2192",
    id: "bash.generic",
    tier: "action",
    stem: selected ?? (level === "plain" ? "Managing saved work" : "Running git")
  };
}
function genericLine(segment, level) {
  if (level === "plain") {
    return {
      glyph: "\u2192",
      id: "bash.generic",
      tier: "action",
      stem: "Running one of the project's own tools",
      generic: true
    };
  }
  const argv = tokenize(segment);
  const executable = argv[0] ?? "project-script";
  const fileName = executable.split("/").pop() ?? executable;
  const name = fileName.replace(/\.[^.]+$/, "") || "project-script";
  const optionCount = Math.max(0, argv.length - 1);
  return {
    glyph: "\u2192",
    id: "bash.generic",
    tier: "action",
    stem: `Running a project script (${name})`,
    ...optionCount === 0 ? {} : {
      facts: `(+${optionCount} option${optionCount === 1 ? "" : "s"})`
    },
    generic: true
  };
}
function classifySegment(segment, level) {
  const argv = tokenize(segment);
  const command = argv[0] ?? "";
  const subcommand = argv[1] ?? "";
  const kind = kindOfSegment(argv);
  if (kind === "test")
    return testLine(level, testBin(argv));
  if (kind === "install") {
    if (subcommand === "ci") {
      return {
        glyph: "\u2192",
        id: "bash.install.ci",
        tier: "action",
        stem: level === "plain" ? "Setting up the project's building blocks" : `Installing dependencies from lockfile (${command} ci)`
      };
    }
    const names = packageNames(argv);
    return {
      glyph: "\u2192",
      id: "bash.install.pkg",
      tier: "action",
      stem: level === "plain" ? names === null ? "Setting up the project's building blocks" : "Adding a ready-made tool to the project" : names === null ? "Installing dependencies" : `Installing package ${names}`
    };
  }
  if (kind === "build") {
    return {
      glyph: "\u2192",
      id: "bash.build",
      tier: "action",
      stem: level === "plain" ? "Assembling the app" : "Building the project"
    };
  }
  if (kind === "remove") {
    const names = packageNames(argv);
    return {
      glyph: "\u2192",
      id: "bash.install.pkg",
      tier: "action",
      stem: level === "plain" ? "Removing a ready-made tool from the project" : names === null ? "Removing a package" : `Removing package ${names}`
    };
  }
  if (kind === "read") {
    if (command === "grep" || command === "rg") {
      const terms = argv.filter((argument) => !argument.startsWith("-"));
      return {
        glyph: "\u2192",
        id: "bash.search",
        tier: "read",
        stem: level === "plain" ? "Searching through the project" : `Searching for ${terms[1] ?? "a pattern"}`
      };
    }
    if (command === "ls") {
      return {
        glyph: "\u2192",
        id: "bash.read",
        tier: "read",
        stem: level === "plain" ? "Looking around the project" : "Listing files"
      };
    }
    if (command === "git")
      return gitLine(argv, level);
    return {
      glyph: "\u2192",
      id: "bash.read",
      tier: "read",
      stem: level === "plain" ? "Looking at existing files" : `Reading with ${command || "a file tool"}`
    };
  }
  if (command === "git")
    return gitLine(argv, level);
  if (command === "mkdir") {
    const target = argv.slice(1).find((argument) => !argument.startsWith("-")) ?? "";
    return {
      glyph: "\u2192",
      id: "bash.mkdir",
      tier: "action",
      stem: level === "plain" ? "Creating a folder" : `Creating folder ${target}`.trim()
    };
  }
  if (["cp", "mv", "touch", "chmod"].includes(command)) {
    const target = argv.slice(1).find((argument) => !argument.startsWith("-")) ?? "files";
    const verb = command === "cp" ? "Copying" : command === "mv" ? "Moving" : command === "touch" ? "Creating" : "Changing permissions on";
    return {
      glyph: "\u2192",
      id: "bash.fileops",
      tier: "action",
      stem: level === "plain" ? "Organizing project files" : `${verb} ${target}`
    };
  }
  if (command === "curl" || command === "wget") {
    const url = argv.find((argument) => argument.startsWith("http")) ?? "a URL";
    return {
      glyph: "\u2192",
      id: "bash.fetch",
      tier: "action",
      stem: level === "plain" ? "Fetching something from the internet" : `Fetching ${url}`
    };
  }
  return genericLine(segment, level);
}
function normalizedHint(hint) {
  if (hint === void 0 || !Number.isFinite(hint.count) || hint.count < 0 || typeof hint.cap !== "boolean") {
    return null;
  }
  return { count: Math.floor(hint.count), cap: hint.cap };
}
function countText(hint) {
  if (hint.cap) {
    return `${hint.count}+ ${hint.count === 1 ? "item" : "items"}`;
  }
  return counted(hint.count, "item");
}
function dangerLine(command, level, hint) {
  const danger = detectDanger(command);
  if (danger === null)
    return null;
  const measured = normalizedHint(hint);
  let stem;
  let facts;
  if (danger.reason === "delete") {
    if (measured === null && danger.recursive === true) {
      if (level === "developer") {
        stem = `Deleting ${danger.target}`;
        facts = "(entire folder)";
      } else {
        stem = `Deleting '${danger.target}' and everything inside it`;
      }
    } else if (measured === null) {
      stem = level === "plain" ? `Deleting '${danger.target}'` : `Deleting ${danger.target}`;
    } else if (danger.recursive !== true) {
      stem = level === "plain" ? `Deleting '${danger.target}'` : `Deleting ${danger.target}`;
      facts = `(${countText(measured)})`;
    } else if (level === "developer") {
      stem = `Deleting ${danger.target}`;
      facts = `(${countText(measured)})`;
    } else {
      stem = `Deleting '${danger.target}' and the ${countText(measured)} inside it`;
    }
  } else if (danger.reason === "delete-untracked") {
    if (measured === null) {
      stem = level === "plain" ? "Permanently deleting files the project is not tracking" : "Permanently deleting untracked files";
    } else if (level === "plain") {
      stem = `Permanently deleting the ${countText(measured)} the project is not tracking`;
    } else {
      stem = "Permanently deleting untracked files";
      facts = `(${countText(measured)})`;
    }
  } else if (danger.reason === "overwrite-history") {
    stem = level === "plain" ? "Replacing the shared online copy of this work; older versions there are lost" : `Overwriting the online history (${danger.target})`;
  } else if (danger.reason === "overwrite") {
    stem = level === "plain" ? `Overwriting '${danger.target}' and destroying its previous contents` : `Overwriting ${danger.target}`;
  } else if (danger.reason === "discard-worktree") {
    stem = level === "plain" ? `Throwing away unsaved edits in ${danger.target}` : `Discarding working-copy changes (${danger.target})`;
  } else if (level === "developer") {
    stem = `Throwing away recent changes (${danger.target})`;
  } else {
    const revision = /^HEAD~(\d+)$/.exec(danger.target);
    const count = revision === null ? null : Number(revision[1] ?? 0);
    if (danger.target === "working copy" || danger.target === "HEAD" || count === 0) {
      stem = "Throwing away every unsaved edit in the project";
    } else if (count !== null) {
      stem = count === 1 ? "Throwing away the last saved checkpoint and any unsaved edits" : `Throwing away the last ${count} saved checkpoints and any unsaved edits`;
    } else {
      stem = `Throwing away unsaved edits and moving the work to ${danger.target}`;
    }
  }
  return {
    glyph: "\u26A0",
    id: danger.reason === "delete" || danger.reason === "delete-untracked" ? "bash.danger.delete" : danger.reason === "overwrite-history" ? "bash.danger.history" : "bash.danger.discard",
    stem,
    ...facts === void 0 ? {} : { facts },
    text: lineText(stem, facts),
    severity: "danger",
    tier: "danger",
    raw: command
  };
}
function translateBash(command, level, hint) {
  const danger = dangerLine(command, level, hint);
  if (danger !== null)
    return danger;
  const segments = splitSegments(command);
  const classified = segments.map((segment) => classifySegment(segment, level));
  const actions = classified.filter((segment) => segment.tier === "action");
  const picked = actions[0] ?? classified[0] ?? genericLine(command.trim(), level);
  const extraCount = Math.max(0, actions.length - 1);
  const facts = extraCount === 0 ? picked.facts : `(+${extraCount} more ${plural(extraCount, "step")})`;
  return asLine(command, {
    ...picked,
    ...facts === void 0 ? {} : { facts }
  }, actions.length === 0 ? picked.tier : "action");
}
function hasKind(command, expected) {
  return splitSegments(command).some((segment) => kindOfSegment(tokenize(segment)) === expected);
}
function isTestCommand(command) {
  return hasKind(command, "test");
}
function isInstallCommand(command) {
  return hasKind(command, "install");
}
function isBuildCommand(command) {
  return hasKind(command, "build");
}

// ../codevibez-cli/packages/core/dist/rules/file-rules.js
function baseName(path) {
  if (typeof path !== "string" || path.length === 0)
    return "a file";
  return path.split(/[\\/]/).pop() || "a file";
}
function rawText(raw) {
  try {
    return JSON.stringify(raw).slice(0, 200);
  } catch {
    return "[unavailable tool input]";
  }
}
function makeLine(raw, glyph, tier, stem, facts, id = "file.edit") {
  return {
    glyph,
    id,
    stem,
    ...facts === void 0 ? {} : { facts },
    text: facts === void 0 ? stem : `${stem} ${facts}`,
    tier,
    severity: "info",
    raw: rawText(raw)
  };
}
function translateFileTool(tool, raw, level) {
  switch (tool) {
    case "Read":
      return makeLine(raw, "\u2192", "read", level === "plain" ? "Looking at existing code" : `Reading ${baseName(raw.file_path)}`, void 0, "file.read");
    case "Grep":
      return makeLine(raw, "\u2192", "read", level === "plain" ? "Searching through the code" : `Searching for ${typeof raw.pattern === "string" ? `'${raw.pattern}'` : "a pattern"}`, void 0, "file.search");
    case "Glob":
      return makeLine(raw, "\u2192", "read", level === "plain" ? "Searching through the code" : `Finding files matching ${typeof raw.pattern === "string" ? raw.pattern : "a pattern"}`, void 0, "file.search");
    case "Write": {
      const exists = raw.codevibez_exists === true;
      if (level === "plain") {
        return exists ? makeLine(raw, "\u270E", "action", "Rewriting one of the app's files", void 0, "file.write.over") : makeLine(raw, "\u270E", "action", "Writing new code", "(1 new file)", "file.write.new");
      }
      return exists ? makeLine(raw, "\u270E", "action", `Rewriting ${baseName(raw.file_path)}`, void 0, "file.write.over") : makeLine(raw, "\u270E", "action", `Writing ${baseName(raw.file_path)}`, "(new file)", "file.write.new");
    }
    case "Edit":
    case "MultiEdit":
      return level === "plain" ? makeLine(raw, "\u270E", "action", "Updating the app's code", "(1 file)") : makeLine(raw, "\u270E", "action", `Updating ${baseName(raw.file_path)}`);
    default:
      return null;
  }
}

// ../codevibez-cli/packages/core/dist/rules/outcome-rules.js
function numberAt(match, index) {
  return Number(match[index] ?? 0);
}
function pairedCounts(output) {
  const failedFirst = output.match(/(\d+)\s+fail(?:ed|ing)\b[\s\S]{0,200}?(\d+)\s+pass(?:ed|ing)\b/i);
  if (failedFirst !== null) {
    return {
      failed: numberAt(failedFirst, 1),
      passed: numberAt(failedFirst, 2)
    };
  }
  const passedFirst = output.match(/(\d+)\s+pass(?:ed|ing)\b[\s\S]{0,200}?(\d+)\s+fail(?:ed|ing)\b/i);
  if (passedFirst !== null) {
    return {
      failed: numberAt(passedFirst, 2),
      passed: numberAt(passedFirst, 1)
    };
  }
  return null;
}
function cargoCounts(output) {
  const lines = output.split("\n").filter((line) => /\btest result:/i.test(line));
  if (lines.length === 0)
    return null;
  let failed = 0;
  let passed = 0;
  let matched = false;
  for (const line of lines) {
    const passedMatch = line.match(/(\d+)\s+passed\b/i);
    const failedMatch = line.match(/(\d+)\s+failed\b/i);
    if (passedMatch !== null || failedMatch !== null)
      matched = true;
    passed += passedMatch === null ? 0 : numberAt(passedMatch, 1);
    failed += failedMatch === null ? 0 : numberAt(failedMatch, 1);
  }
  return matched ? { failed, passed } : null;
}
function goCounts(output) {
  const passed = output.match(/^\s*--- PASS:/gm)?.length ?? 0;
  const failed = output.match(/^\s*--- FAIL:/gm)?.length ?? 0;
  return passed + failed === 0 ? null : { failed, passed };
}
function parseTestCounts(output) {
  const lines = output.split("\n");
  const authoritative = lines.filter((line) => /^\s*Tests(?::|\s)/i.test(line) && !/^\s*Test (?:Files|Suites)\b/i.test(line) && !/^\s*Suites\b/i.test(line));
  for (let index = authoritative.length - 1; index >= 0; index -= 1) {
    const line = authoritative[index];
    if (line === void 0)
      continue;
    const counts = pairedCounts(line);
    if (counts !== null)
      return counts;
  }
  const cargo = cargoCounts(output);
  if (cargo !== null)
    return cargo;
  const go = goCounts(output);
  if (go !== null)
    return go;
  const filtered = lines.filter((line) => !/^\s*Test (?:Files|Suites)\b/i.test(line) && !/^\s*Suites\b/i.test(line)).join("\n");
  const paired = pairedCounts(filtered);
  if (paired !== null)
    return paired;
  if (/\d+\s+fail/i.test(output))
    return null;
  const passed = output.match(/(?:Tests\s*:?\s*)?(\d+)\s+pass(?:ed|ing)\b/i);
  return passed === null ? null : { failed: 0, passed: numberAt(passed, 1) };
}
function resultLine(glyph, severity, stem, raw, facts) {
  const id = severity === "failure" ? /checks failed/.test(stem) ? "out.test.fail" : "out.fail" : /checks/i.test(stem) ? "out.test.pass" : stem === "Set up finished" ? "out.install.ok" : "out.build.ok";
  return {
    glyph,
    id,
    severity,
    tier: "action",
    stem,
    ...facts === void 0 ? {} : { facts },
    text: facts === void 0 ? stem : `${stem} ${facts}`,
    raw
  };
}
function runnerName(command) {
  const argv = tokenize(command);
  const executable = argv[0] ?? "";
  if (executable === "npx")
    return argv[1] ?? "test";
  if (["npm", "pnpm", "yarn", "bun"].includes(executable) && (argv[1] === "test" || argv[1] === "run")) {
    return executable;
  }
  const fileName = executable.split("/").pop() ?? executable;
  return fileName.replace(/\.[^.]+$/, "") || "test";
}
function firstOutputLine(event) {
  const stderr = typeof event.outcome?.stderr === "string" ? event.outcome.stderr : "";
  const stdout = typeof event.outcome?.stdout === "string" ? event.outcome.stdout : "";
  return (stderr.split("\n").find((line) => line.trim() !== "") ?? stdout.split("\n").find((line) => line.trim() !== "") ?? "").trim().slice(0, 80);
}
function plainFailureStem(output) {
  if (/cannot find module|module not found|no such file|enoent\b/i.test(output)) {
    return "Something needed for that step could not be found";
  }
  if (/permission denied|eacces\b|eperm\b/i.test(output)) {
    return "That step was not allowed to access something it needed";
  }
  if (/eaddrinuse\b|address already in use|port .*in use/i.test(output)) {
    return "That step could not start because its connection point is already in use";
  }
  if (/syntaxerror\b|syntax error|unexpected token/i.test(output)) {
    return "That step could not run because its instructions were malformed";
  }
  if (/enetunreach\b|econnrefused\b|network|dns|timed? out|fetch failed/i.test(output)) {
    return "That step could not reach the network";
  }
  return "Something went wrong while running that step";
}
function translateOutcome(event, level) {
  try {
    const outcome = event.outcome;
    if (outcome === void 0)
      return null;
    const raw = event.raw !== void 0 && typeof event.raw === "object" && event.raw !== null && !Array.isArray(event.raw) ? event.raw : {};
    const command = typeof raw.command === "string" ? raw.command : "";
    const stdout = typeof outcome.stdout === "string" ? outcome.stdout : "";
    const stderr = typeof outcome.stderr === "string" ? outcome.stderr : "";
    const output = `${stdout}
${stderr}`;
    const rawOutput = output.slice(0, 400);
    const test = command !== "" && isTestCommand(command);
    if (test) {
      const counts = parseTestCounts(output);
      if (counts !== null) {
        if (counts.failed > 0) {
          const total = counts.failed + counts.passed;
          const noun = level === "developer" ? plural(total, "test") : plural(total, "check");
          const stem = `${counts.failed} of ${total} ${noun} failed`;
          return resultLine("\u2717", "failure", stem, rawOutput);
        }
        if (outcome.ok === true) {
          return resultLine("\u2713", "success", "All checks pass", rawOutput, `(${counted(counts.passed, "check")})`);
        }
      }
      const hasFailureSignal = /\bfail(?:ed|ing|ure)?\b|error/i.test(output);
      if (outcome.ok !== true || hasFailureSignal) {
        const stem = level === "plain" ? "The checks failed; codevibez could not read how many" : `The ${runnerName(command)} checks failed; codevibez could not read how many`;
        return resultLine("\u2717", "failure", stem, rawOutput);
      }
      return resultLine("\u2713", "success", "Checks finished", rawOutput);
    }
    if (outcome.ok !== true) {
      if (level === "developer") {
        const first = firstOutputLine(event);
        return resultLine("\u2717", "failure", "Something went wrong while running that step", rawOutput, first === "" ? "(1 failure)" : `(${first})`);
      }
      return resultLine("\u2717", "failure", plainFailureStem(output), rawOutput, "(1 failure)");
    }
    if (command !== "" && isInstallCommand(command)) {
      const installed = output.match(/added\s+(\d+)\s+packages?/i);
      const installedCount = installed === null ? null : numberAt(installed, 1);
      return resultLine("\u2713", "success", "Set up finished", rawOutput, installedCount === null ? void 0 : `(${counted(installedCount, "package")})`);
    }
    if (command !== "" && isBuildCommand(command)) {
      return resultLine("\u2713", "success", "Build finished", rawOutput);
    }
    return null;
  } catch {
    return null;
  }
}

// ../codevibez-cli/packages/core/dist/translate.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dangerHint(value) {
  if (!isRecord(value) || typeof value.count !== "number" || typeof value.cap !== "boolean") {
    return void 0;
  }
  return { count: value.count, cap: value.cap };
}
function serialize(value) {
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return "[unavailable tool input]";
  }
}
function genericToolLine(tool, raw, level) {
  const name = typeof tool === "string" && tool !== "" ? tool : "unknown";
  const stem = level === "plain" ? "Using one of its built-in tools" : `Doing something with a helper tool (${name})`;
  return {
    glyph: "\u2192",
    id: "tool.generic",
    level,
    stem,
    text: stem,
    severity: "info",
    tier: "action",
    raw: serialize(raw),
    generic: true
  };
}
function translate(event, level) {
  try {
    switch (event.kind) {
      case "prompt": {
        const original = typeof event.text === "string" ? event.text : "";
        const prompt = formatPrompt(original);
        const stem = `Working on: "${prompt}"`;
        return {
          glyph: "\u25CF",
          id: "prompt.chapter",
          level,
          stem,
          text: stem,
          severity: "info",
          tier: "action",
          raw: original.slice(0, 200)
        };
      }
      case "tool.pre": {
        const raw = isRecord(event.raw) ? event.raw : {};
        if (event.tool === "Bash" && typeof raw.command === "string") {
          return {
            ...translateBash(raw.command, level, dangerHint(raw.hint)),
            level
          };
        }
        const fileLine = typeof event.tool === "string" ? translateFileTool(event.tool, raw, level) : null;
        return fileLine === null ? genericToolLine(event.tool, raw, level) : { ...fileLine, level };
      }
      case "tool.post": {
        const outcome = translateOutcome(event, level);
        return outcome === null ? null : { ...outcome, level };
      }
      case "agent.done":
        return null;
      default:
        return null;
    }
  } catch {
    if (event.kind === "tool.pre") {
      return genericToolLine(event.tool, {}, level);
    }
    return null;
  }
}

// ../codevibez-cli/packages/core/dist/style.js
function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619) >>> 0;
  }
  return result;
}
var VOICE = {
  "bash.test": {
    canonical: "Checking everything still works\u2026",
    variants: [
      "Checking everything still works\u2026",
      "Making sure nothing broke\u2026",
      "Running the checks\u2026"
    ]
  },
  "bash.install.ci": {
    canonical: "Setting up the project's building blocks",
    variants: [
      "Setting up the project's building blocks",
      "Getting the project ready to run"
    ]
  },
  "bash.install.pkg": {
    canonical: "Adding a ready-made tool to the project",
    variants: [
      "Adding a ready-made tool to the project",
      "Bringing in a tool someone else built"
    ]
  },
  "bash.build": {
    canonical: "Assembling the app",
    variants: ["Assembling the app", "Putting the app together"]
  },
  "bash.commit": {
    canonical: "Saving a checkpoint of the work",
    variants: [
      "Saving a checkpoint of the work",
      "Banking the progress so far"
    ]
  },
  "bash.search": {
    canonical: "Searching through the project",
    variants: [
      "Searching through the project",
      "Hunting through the project"
    ]
  },
  "file.read": {
    canonical: "Looking at existing code",
    variants: [
      "Looking at existing code",
      "Getting familiar with the code"
    ]
  },
  "file.write.new": {
    canonical: "Writing new code",
    variants: ["Writing new code", "Putting new code on the page"]
  },
  "file.edit": {
    canonical: "Updating the app's code",
    variants: ["Updating the app's code", "Tweaking the app's code"]
  }
};
var MOOD = {
  danger: "alarm",
  failure: "oops",
  success: "win",
  info: "busy"
};
var PULSE = ["\xB7", "\u2722", "\u2733", "\u273B", "\u273D", "\u273B", "\u2733", "\u2722"];
var PULSE_ASCII = [".", "o", "O", "0", "O", "o", ".", " "];
var BREATH_PERIOD_MS = 2400;
function breath(timeMs) {
  const time = Number.isFinite(timeMs) ? timeMs : 0;
  const phase = (time % BREATH_PERIOD_MS + BREATH_PERIOD_MS) % BREATH_PERIOD_MS / BREATH_PERIOD_MS;
  const intensity = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const index = Math.min(PULSE.length - 1, Math.floor(phase * PULSE.length));
  return {
    glyph: PULSE[index] ?? PULSE[0],
    intensity,
    phase
  };
}
function decorate(line, seed, flair, timeMs = 0) {
  try {
    if (flair === "off")
      return line;
    const mood = line.glyph === "\u25CF" ? "kickoff" : MOOD[line.severity];
    const decorated = { ...line, mood };
    if (line.severity === "danger" || line.severity === "failure") {
      return decorated;
    }
    if (flair === "minimal")
      return decorated;
    const stem = line.stem ?? line.text;
    const voice = line.id === void 0 ? void 0 : VOICE[line.id];
    if (voice !== void 0 && stem === voice.canonical) {
      const index = hash(`${seed}|${line.id}`) % voice.variants.length;
      decorated.stem = voice.variants[index] ?? stem;
    }
    const selectedStem = decorated.stem ?? stem;
    decorated.text = line.facts === void 0 ? selectedStem : `${selectedStem} ${line.facts}`;
    decorated.pulse = breath(timeMs).phase;
    return decorated;
  } catch {
    return line;
  }
}

// src/events.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// src/redact.ts
var MAX_LINE = 8e3;
function capSerialized(line, fallback) {
  return line.length <= MAX_LINE ? line : fallback();
}

// src/events.ts
function defaultEventsDir() {
  return process.env.CODEVIBEZ_DIR ?? join(homedir(), ".codevibez", "events");
}
function sessionFileName(session) {
  const flattened = session.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+/, "");
  return `${flattened === "" ? "session" : flattened}.jsonl`;
}
function appendEvent(dir, event) {
  try {
    mkdirSync(dir, { recursive: true });
    const line = capSerialized(JSON.stringify(event), () => JSON.stringify({ ...event, raw: { codevibez_note: "payload omitted, too large" } }));
    appendFileSync(join(dir, sessionFileName(event.session)), `${line}
`, "utf8");
  } catch {
  }
}

// src/flair.ts
function effectiveFlair(configured) {
  if (process.env.NO_COLOR !== void 0 && process.env.NO_COLOR !== "") return "off";
  return configured;
}
function asciiOnly() {
  const locale = process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? "";
  return locale !== "" && !/utf-?8/i.test(locale);
}
function pulseColumn(line) {
  if (line.pulse === void 0) return "  ";
  const table = asciiOnly() ? PULSE_ASCII : PULSE;
  const index = Math.min(table.length - 1, Math.floor(line.pulse * table.length));
  return `${table[index] ?? table[0]} `;
}
function renderInline(line, flair) {
  const body = `${line.glyph} ${line.text}`;
  return flair === "off" ? body : `${pulseColumn(line)}${body}`;
}
function titleSequence(text, lead = "") {
  const short = text.length > 60 ? `${text.slice(0, 59)}\u2026` : text;
  return `\x1B]2;${lead}${short} \xB7 codevibez\x07`;
}
function lineTitle(line) {
  return titleSequence(line.text, line.pulse === void 0 ? "" : pulseColumn(line));
}
function bellSequence() {
  return "\x07";
}

// src/config.ts
import { readFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join2 } from "node:path";
var DEFAULTS = {
  level: "plain",
  inline: true,
  flair: "full",
  notify: false
};
function readConfig() {
  try {
    const dir = process.env.CODEVIBEZ_DIR ? dirname(process.env.CODEVIBEZ_DIR) : join2(homedir2(), ".codevibez");
    const value = JSON.parse(readFileSync(join2(dir, "config.json"), "utf8"));
    const config = typeof value === "object" && value !== null ? value : {};
    return {
      level: config.level === "developer" ? "developer" : "plain",
      inline: config.inline !== false,
      flair: config.flair === "minimal" || config.flair === "off" ? config.flair : "full",
      notify: config.notify === true
    };
  } catch {
    return { ...DEFAULTS };
  }
}

// src/io.ts
function readStdin(deadlineMs = 150) {
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(buf);
    };
    const timer = setTimeout(finish, deadlineMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}
function emit(obj) {
  console.log(JSON.stringify(obj));
}

// src/budget.ts
var BUDGET_MS = 150;
function startBudget(limitMs = BUDGET_MS) {
  const started = Date.now();
  return {
    spent: () => Date.now() - started > limitMs,
    elapsed: () => Date.now() - started
  };
}

// src/hook.ts
async function runHook(body) {
  const budget = startBudget();
  let output;
  try {
    const parsed = JSON.parse(await readStdin());
    const payload = typeof parsed === "object" && parsed !== null ? parsed : {};
    const config = readConfig();
    output = body({
      payload,
      session: String(payload.session_id ?? "unknown"),
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      config,
      flair: effectiveFlair(config.flair),
      budget
    });
  } catch {
  }
  emit(output ?? {});
  process.exit(0);
}
function lineOutput(options) {
  const { line, session, ts, config, flair } = options;
  if (!config.inline) return {};
  const decorated = decorate(line, `${session}|${ts}`, flair, Date.now());
  const output = {
    systemMessage: renderInline(decorated, flair)
  };
  if (flair !== "off") output.terminalSequence = lineTitle(decorated);
  if (config.notify && options.ring === true) {
    output.terminalSequence = `${output.terminalSequence ?? ""}${bellSequence()}`;
  }
  return output;
}

// src/prompt.ts
void runHook(({ payload, session, ts, config, flair }) => {
  const event = {
    v: 1,
    ts,
    session,
    agent: "claude-code",
    kind: "prompt",
    text: typeof payload.prompt === "string" ? payload.prompt.slice(0, 2e3) : ""
  };
  appendEvent(defaultEventsDir(), event);
  const line = translate(event, config.level);
  if (!line) return {};
  return lineOutput({ line, session, ts, config, flair });
});
