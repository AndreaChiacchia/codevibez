# codevibez

![Pretending to read code vs Reading 'code'](codevibez.jpg)

**A simple idea: make English the next coding language (everywhere).**

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

## Install

Needs Claude Code 2.1.287 or later. In your terminal:

```
claude plugin install codevibez --marketplace leonhong18/codevibez
```

To uninstall:

```
claude plugin uninstall codevibez
```

## Contributing

Found a step it described badly? Open an issue at
https://github.com/leonhong18/codevibez/issues with what ran and what you
expected it to say.
