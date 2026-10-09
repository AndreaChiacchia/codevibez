# codevibez

![Pretending to read code vs Reading 'code'](codevibez.jpg)

**A simple idea: make English the next coding language (everywhere).**

Instead of this:

```
  Searched for 1 pattern (ctrl+o to expand)
⏺ Bash(node --test)
  ⎿  Error: Exit code 1
     TAP version 13
     # Subtest: add
     ok 1 - add
       ---
       duration_ms: 0.711542
       type: 'test'
       ...
     # Subtest: multiply
     not ok 2 - multiply
     … +59 lines (ctrl+o to expand)
  Read 1 file (ctrl+o to expand)
⏺ Update(math.js)
  ⎿  Added 1 line, removed 1 line
      3  }
      4
      5  function multiply(a, b) {
      6 -  return a + b;
      6 +  return a * b;
      7  }
      8
      9  module.exports = { add, multiply };
⏺ Bash(node --test)
  ⎿  TAP version 13
     # Subtest: add
     ok 1 - add
     … +25 lines (ctrl+o to expand)
⏺ Bash(rm -rf build)
  ⎿  Done
⏺ Bash(git add math.js && git commit -m 'Fix multiply')
  ⎿  [main 0f3b832] Fix multiply
      1 file changed, 1 insertion(+), 1 deletion(-)
```

You see this:

```
→ Searching through the project
→ Checking everything still works…
  ✗ 2 of 3 checks failed
→ Looking at existing code
✎ Updating the app's code (1 file)
→ Checking everything still works…
  ✓ All checks pass (3 checks)
⚠ Deleting 'build' and everything inside it
→ Saving a checkpoint of the work (+1 more step)
⏺ codevibez: ✗ This turn: changed 1 file, ran 5 commands (1 failed), all 3 checks passed, 1 destructive step.
```

Both are the same turn of a real session, with the agent's own sentences in
between left out. The English takes the place of Claude Code's own rows. It
does not sit beside them.

## Why

Claude Code is a tool built for developers, by developers, and it shows. You
ask it for a login page in plain English, and it reports back in shell
commands, file paths and test logs. If you cannot read those, you nod at the
scrolling and hope, and "watch what your agent does" stops being advice.

codevibez translates the activity into English without hiding the parts that
matter. That gap is why I created it.

## From Binary to Natural Language

Computers only ever understood binary. Nobody wanted to write that, so we
built assembly, then C, then Python and the rest. Each layer let you say the
same thing in a more human way, with a translator underneath turning it back
into what the machine actually runs. Every time, you gained readability and
gave up nothing that mattered.

Natural language is the next rung. You say "add a login page" and the agent
compiles that into code. A real new layer on a very old stack, and the first
one where the input is a sentence.

But this layer only runs one way. On every layer before it, you checked your
work in the language you wrote it in. Python in, Python back; whatever the
machine ran underneath was a detail you were never expected to open. Now you
write at the top of the stack and get handed the bottom of it to review.

codevibez is the return path. You speak English going in, and you read English
coming out. Everything below is just the detail of making that trustworthy.

## What it translates

- **Commands being run.** Searching, testing, committing, starting a branch,
  deleting.
- **Files being touched.** Created, edited, read, searched, and how many.
- **Results coming back.** What passed, what failed, and how badly.
- **What the turn changed,** in one line under the answer: files changed,
  commands run, and checks passed or failed, with exact counts. A turn that
  changed nothing and ran nothing gets no line.

It does not yet explain what a code change *does*. When your agent writes
forty lines of TypeScript, codevibez reports the activity around the change,
not the meaning of the code. That is the next real frontier, and it will be
opt-in when it arrives; the reason it is not built yet is under How it works.

## Before and after

Every line in the right column was captured from a real Claude Code session
with codevibez installed. None of it was written by hand for the README, which
is a low bar that a surprising amount of software does not clear:

| What your agent did | What you were told |
|---|---|
| `grep -rn multiply math.js test` | → Searching through the project |
| read a file | → Looking at existing code |
| write a new file | ✎ Writing new code (1 new file) |
| edit a file | ✎ Updating the app's code (1 file) |
| `mkdir -p docs` | → Creating a folder |
| `node --test`, and it fails | → Checking everything still works…<br>✗ 2 of 3 checks failed |
| `node --test`, and it passes | → Checking everything still works…<br>✓ All checks pass (3 checks) |
| `git add math.js && git commit -m 'Fix multiply'` | → Saving a checkpoint of the work (+1 more step) |
| `git checkout -b feature/docs` | → Starting work on a separate track |
| fetch `https://example.com` | → Reading a web page (example.com) |
| hand a task to a helper agent | → Handing a task to a helper: "Read math.js and describe what it does" |
| `rm -rf build` | ⚠ Deleting 'build' and everything inside it |
| `git reset --hard HEAD` | ⚠ Throwing away every unsaved edit in the project |
| `mkdir -p build && echo bundle > build/app.js` | ⚠ Writing over 'build/app.js'; anything already in it is lost |

## One warning

Everything above this line is friendly. This part is not, on purpose.
Friendliness that hides things is worse than the jargon it replaced, so there
is one rule codevibez does not break:

**Deletions and failures are never softened, never abbreviated, and never
decorated.**

```
⚠ Deleting 'build' and everything inside it
⚠ Throwing away every unsaved edit in the project
✗ 2 of 3 checks failed
✗ Something went wrong while running that step (exit code 1)
⚠ Deleting 'docs' and everything inside it
  ✗ Not run: you said no
```

It names exactly what is being deleted instead of guessing at a number. Hard
resets and overwritten files get the same treatment. It says exactly how many
checks failed, and a failed command keeps its exit code. When you say no at a
permission prompt, the line says the step did not run. And it never guesses
that something succeeded: when it cannot determine the result, it stays
silent.

These lines are also bold and colored, red for a failure and yellow for
anything destructive, while routine steps stay plain. That is deliberate.
Routine work fades into the background. Anything you actually need to look at
stands out.

## Install

You need Claude Code 2.1.287 or later. In your terminal:

```
claude plugin install codevibez --marketplace leonhong18/codevibez
```

That adds the codevibez marketplace and installs the mod for your user. No
build step, no account, no dependencies added to your machine, no newsletter.
Start Claude Code and the English appears as your agent works.

To uninstall:

```
claude plugin uninstall codevibez
```

## Where it shows up

- **The terminal:** each tool call's row is plain English. Tested on Claude
  Code 2.1.295 and 2.1.296. Mods also draw in the Code tab of the Desktop app
  (2.1.286 or later); codevibez's tests cover that surface, but it has not
  been tried there by hand yet.
- **The permission prompt stays as Claude Code draws it.** When Claude Code
  asks whether a step may run, the question and the step it is about show
  Claude Code's own words, so you approve exactly what will run. The English
  row takes over once you answer.
- **Not drawn:** the VS Code chat panel and cloud sessions. `claude -p` prints
  exactly what it printed before.

## The one switch

There are no settings files. There is one command:

```
/codevibez
```

It swaps the whole session between the English and Claude Code's own rows,
and says which view is on, so you can always see exactly what ran. Type it
again to swap back. `/codevibez raw` and `/codevibez english` pick one
directly. English is the default, and every new session starts in English.
It works mid-turn too, while your agent is still going.

`ctrl+o` still opens the detailed transcript; in the English view it shows
every step on its own line, in English.

`/codevibez story` opens a pane that tells the session so far: one chapter
per prompt you typed, the prompt word for word as its heading, then each step
in English and the line that ended the turn. When the pane is too short for
all of it, it shows the newest steps and says how many earlier lines are
above. Failures and destructive steps are always kept in it.

## What it writes down

Nothing. codevibez keeps no log and writes no files. What it needs for the
line under each answer lives in memory and is gone when the session ends.
Anything in an English line that looks like a password, a token or a key is
replaced with `[REDACTED]` before it is drawn. That scrubbing is best effort:
it catches the common shapes, not every possible one.

## How it works

codevibez is a Claude Code mod. Claude Code asks a mod how to draw each tool
call's row, and lets it watch tool calls finish and turns end. Each time a row
is drawn, codevibez asks a translator "what is this, in English?" and draws
the answer in that row's place. It only watches: it never blocks, changes,
retries or slows down anything your agent does.

The translator is an ordinary function that knows nothing about the outside
world. Same event in, same sentence out, every time. No network call, no AI
model, no measurable delay. This is deliberate and slightly boring: a
codevibez that occasionally hallucinates a reassuring sentence would be worse
than no codevibez, and an AI model narrating an AI model is how you get two
things confidently wrong instead of one.

If any part of it breaks, or it meets a tool it does not know, it steps aside
and Claude Code draws its own row. It is not allowed to interrupt your
session. That rule outranks every feature here, including all the nice ones.

You do not have to take that on trust. After installing, one command shows
everything the mod is able to do:

```
claude plugin validate ~/.claude/plugins/cache/codevibez/codevibez/0.2.0
```

Its `calls:` line lists every call the mod makes, and this is all of it:

```
./register.tsx calls: $.command.register, $.state.get, $.state.set, $.ui.log, $.ui.open, $.ui.resolve
```

That is: register the `/codevibez` command, remember which view is on and the
story so far for this session, add the line under each answer, open the story
pane, and draw rows. No model calls, no network, no files, no running
programs.

## Why I am building this

I want to build things that reflect my vision of the future. The first is
making AI genuinely accessible, rather than technically available, and those
are not the same thing. You can open Claude Code today without knowing how to
code. You cannot yet understand what it did.

Tools like Claude Cowork are great, but they get there by hiding the terminal,
and the terminal is where Claude Code's real capabilities live. codevibez
takes the other route: keep the real thing, translate it. That is the bridge
between technical people and everyone else reaching for the same tools.

My goal is to find new perspectives on the "AI market", ~~one~~ many line(s)
of 'code' at a time.

## Contributing

The most useful contribution requires no code at all: a command codevibez
described badly. Open an issue with what you ran and what you expected it to
say. Bad translations are the main thing holding this back, and complaints
are genuinely the fastest way to fix them.

I wanted to bring this concept to life with Claude Code (what I use). Feel
free to create versions for any other CLI.

## License

MIT.
