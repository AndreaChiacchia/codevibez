# Where this engine came from

This folder is the codevibez translation engine (the `codevibez-core`
package), vendored from the engine's source at commit `93d2176`. It is plain,
dependency-free TypeScript that Claude Code loads directly as part of the mod:
no build step, no npm package at run time.

Changes made while vendoring:

- Imports between engine files use the `.ts` extension, so Claude Code can
  load them as written.
- The engine's own tests are named `*.spec.ts` and run with `npm test`
  (vitest). The mod's tests are `*.test.tsx` and run with
  `claude plugin test`, which would otherwise pick these up too.
- The danger analysis gained two kinds of destructive step: permission
  changes (`chmod`, `chown`, `chgrp`) and dropped data (`DROP TABLE`,
  `TRUNCATE`, `dropdb`, a Redis flush, a Prisma reset). Their tests are in
  `tests/danger-extra.spec.ts`.

Everything else is as it was at `93d2176`.
