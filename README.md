# codevibez

![version](https://img.shields.io/badge/version-0.2.3-blue)

> [!NOTE]
> This is AndreaChiacchia's fork of [leonhong18/codevibez](https://github.com/leonhong18/codevibez). It adds three
> motion effects to the English rows (a light over the running step, a settle into color and a story pane that rolls
> new lines in), each with its own switch in `/config`; see [Effects](#effects). Everything else is upstream's.

https://github.com/user-attachments/assets/e5145395-1287-4397-814b-cb42ea9760c7

![Pretending to read code vs Reading 'code'](codevibez.jpg)

**A simple idea: make natural language the next coding language (everywhere).**

codevibez replaces Claude Code's raw tool-call rows with plain English.
Failures, deletions and other risky steps are never softened. Type
`/codevibez` to switch to the raw rows. It makes no model calls and no network
requests.

## Example

Claude Code shows this:

```
⏺ Bash(node --test)
  ⎿  TAP version 13
     # Subtest: add
     ok 1 - add
     … +25 lines (ctrl+o to expand)
⏺ Bash(rm -rf build)
  ⎿  Done
```

With codevibez you see this:

```
→ Checking everything still works…
  ✓ All checks pass (3 checks)
⚠ Deleting 'build' and everything inside it
```

More lines from real sessions:

```
✗ 2 of 3 checks failed
⚠ Deleting 'docs' and everything inside it
⚠ Throwing away every unsaved edit in the project
→ Saving a checkpoint of the work (+1 more step)
✗ Not run: you said no
⏺ codevibez: ✗ This turn: changed 1 file, ran 5 commands (1 failed), all 3 checks passed, 1 destructive step.
```

## Effects

Set them in `/config` under codevibez, or in settings under `pluginConfigs.codevibez`.

| Setting | Values (default first) | What it does |
| --- | --- | --- |
| `shimmer` | `on`, `off` | on: while a step runs, its sentence dims a little and a soft light sweeps across it, left to right, until the step finishes; a group of reads and searches gets it too while one of them runs. Destructive steps never shimmer. off: a running step's sentence is still, ending in …. |
| `settle` | `on`, `off` | on: when a step finishes, its ✓, ✗ or ■ line fades from dim into its green, red or yellow in 0.3 s, once. Needs the fullscreen layout; on the main screen the line takes its color at once. off: the color shows at once. |
| `storyRoll` | `on`, `off` | on: in the /codevibez story pane, the lines added since it last drew type themselves in one after another (the newest 8, 0.2 s each); failures and destructive steps appear whole. off: new lines appear at once. |

- Finished rows stay still. Each effect plays once: while a step runs, or for 0.3 s after its step finishes. A row from
  earlier in the session, from a resumed session or scrolled back into view never plays again.
- Failures and destructive steps never shimmer or roll in: they appear whole, bold and colored, at once. A failure's
  ✗ line still settles into red when settle is on.
- Nothing moves in the raw view (`/codevibez raw`) or in the ctrl+o transcript.
- Settle needs the fullscreen layout (`/tui fullscreen`): on the main screen a finished row is printed into the
  terminal's scrollback, where it can no longer be redrawn, so it takes its color at once. The shimmer
  works in both layouts.
- The effects draw in the terminal and the desktop app; other surfaces show the rows still.
- Each effect runs on its row's own frame clock (20 frames a second) and stops with it: nothing ticks while no step is
  running or settling.

## Install

Needs Claude Code 2.1.287 or later. In your terminal:

```
claude plugin install codevibez --marketplace leonhong18/codevibez
```

To install this fork instead:

```
claude plugin install codevibez --marketplace AndreaChiacchia/codevibez
```

To uninstall:

```
claude plugin uninstall codevibez
```

## Contributing

Found a bug? Open an issue at
https://github.com/leonhong18/codevibez/issues with what ran and what you
expected it to say.

Issues with the effects belong to this fork: https://github.com/AndreaChiacchia/codevibez/issues
