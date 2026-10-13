# Where this engine came from

This folder is the codevibez translation engine (the `codevibez-core`
package), vendored from the engine's source at commit `93d2176`. It is plain,
dependency-free TypeScript that Claude Code loads directly as part of the mod:
no build step, no npm package at run time.

Changes made while vendoring:

- Imports between engine files use the `.ts` extension, so Claude Code can
  load them as written.
- The engine's own tests run under Claude Code's test kit with
  `claude plugin test`, beside the mod's, so nothing has to be installed.
  Their only edit is the import line: `tests/kit.ts` maps vitest's `it` and
  `it.each` onto the kit. One `toBeTypeOf` check became a `typeof` check.
- The danger analysis gained two kinds of destructive step: permission
  changes (`chmod`, `chown`, `chgrp`) and dropped data (`DROP TABLE`,
  `TRUNCATE`, `dropdb`, a Redis flush, a Prisma reset). Their tests are in
  `tests/danger-extra.test.ts`.
- Test runs gained the runners that need nothing installed: `node --test`,
  `deno test`, and `python -m unittest` or `pytest`, with Node's and
  unittest's summary lines read for exact counts. Their tests are in
  `tests/runners-extra.test.ts`.
- Three wordings were fixed after an end-to-end test: a chain of commands is
  named by its first meaningful step rather than filler such as `sleep` or
  `git add`, moving to a folder (`cd`) or setting a variable is not counted
  as a step, and a shell overwrite no longer claims the file had contents
  ("Writing over 'x'; anything already in it is lost"). Their tests are in
  `tests/e2e-fixes.test.ts`.
- 0.2.2 added broader wording rules (installers, version checks, project
  tasks, helper tools, scripts and snippets, process, text, archive,
  container and server tools, more git commands, env prefixes, wrappers,
  absolute paths, `git -C`, shell keywords and heredoc bodies), and the danger
  analysis now sees through `timeout` and `nohup`. Their tests are in
  `tests/rules-0.2.2.test.ts`.

Everything else is as it was at `93d2176`.
