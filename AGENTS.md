# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- This repo is a Claude Code mod (function hooks), not a settings-hooks plugin. Entry: `hooks/hooks.json` names `hooks/register.tsx`; English lives in `hooks/narrate.ts` (rows), `hooks/ledger.ts` (turn summary) and `hooks/story.ts` (the `/codevibez story` pane). No build step: Claude Code loads the TypeScript as written, so every import between plugin files is relative with a `.ts` extension, and the mod may use only `$` (no Node, no npm packages at run time).
- `engine/` is the vendored translation engine; see `engine/PROVENANCE.md` before changing it.
- Checks: `claude plugin test .` (engine specs and mod tests, both surfaces) and `claude plugin validate --strict .`. There is deliberately no `package.json`: Claude Code runs `npm install` on an installed plugin that has one, which put 47 MB of dev tooling on users' machines. Typecheck with `npx tsc -p .` after Claude Code has loaded the folder once (`claude --plugin-dir .` writes the gitignored `.claude-plugin/types/`).
- `claude plugin validate` lists every `$` call on its `calls:` line. The README promises no model calls and no network requests, so that line must never gain `model.*`, `http.*`, `process.*`, `mcp.*` or `fs.*` calls. Locked rules: observe only (every `tool.call` hook returns exactly what `next(e)` returned), fail-open to Claude Code's own row, no model, network, process or file-write calls, no log on disk.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
