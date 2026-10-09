# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- This repo is a Claude Code mod (function hooks), not a settings-hooks plugin. Entry: `hooks/hooks.json` names `hooks/register.tsx`; English lives in `hooks/narrate.ts` (rows), `hooks/ledger.ts` (turn summary) and `hooks/story.ts` (the `/codevibez story` pane). No build step: Claude Code loads the TypeScript as written, so every import between plugin files is relative with a `.ts` extension, and the mod may use only `$` (no Node, no npm packages at run time).
- `engine/` is the vendored translation engine; see `engine/PROVENANCE.md` before changing it. Its tests are `*.spec.ts` on purpose: `claude plugin test` runs every `*.test.ts(x)` in the folder.
- Checks: `npm ci && npm test` (engine typecheck + specs), `claude plugin test .` (mod tests, both surfaces), `claude plugin validate --strict .`. `npx tsc -p .` typechecks the mod only after Claude Code has loaded the folder once (`claude --plugin-dir .` writes the gitignored `.claude-plugin/types/`).
- The README quotes validate's `calls:` line. Any new `$` call changes that line, so update the README in the same change. Locked rules: observe only (every `tool.call` hook returns exactly what `next(e)` returned), fail-open to Claude Code's own row, no model, network, process or file-write calls, no log on disk.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
