# codevibez

![Pretending to read code vs Reading 'code'](codevibez.jpg)

**A simple idea: make English the next coding language (everywhere).**

Instead of this:

```
⏺ Bash(grep -rn "handleLogin" src/)
⏺ Bash(npm install express)
⏺ Write(/app/login.ts)
⏺ Bash(npm test)
⏺ Bash(rm -rf dist/)
```

You see this:

```
→ Searching through the project
→ Adding a ready-made tool to the project
✎ Writing new code (1 new file)
→ Checking everything still works…
  ✗ 3 of 42 checks failed
⚠ Deleting 'dist/' and everything inside it

codevibez: ✗ This turn: changed 1 file (1 new), ran 4 commands (1 failed), 3 of 42 checks failed, 1 destructive step.
```

The English takes the place of Claude Code's own rows. It does not sit
beside them.

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

- **Commands being run.** Installing, testing, building, committing, deleting.
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

Every line in the right column is real output from the engine in this project.
None of it was written by hand for the README, which is a low bar that a
surprising amount of software does not clear:

| What your agent runs | What you get told |
|---|---|
| `grep -rn "handleLogin" src/` | → Searching through the project |
| `npm install express` | → Adding a ready-made tool to the project |
| `npm ci` | → Setting up the project's building blocks |
| `mkdir -p src/components` | → Creating a folder |
| `curl -s https://api.example.com/v1` | → Fetching something from the internet |
| write a new file | ✎ Writing new code (1 new file) |
| edit an existing file | ✎ Updating the app's code (1 file) |
| `git commit -m "add login"` | → Saving a checkpoint of the work |
| `git checkout -b feature/login` | → Starting work on a separate track |
| `npm test` | → Checking everything still works… |
| `npm test`, and it fails | ✗ 3 of 42 checks failed |
| `npm test`, and it passes | ✓ All checks pass (42 checks) |
| `rm -rf dist/` | ⚠ Deleting 'dist/' and everything inside it |

## One warning

Everything above this line is friendly. This part is not, on purpose.
Friendliness that hides things is worse than the jargon it replaced, so there
is one rule codevibez does not break:

**Deletions and failures are never softened, never abbreviated, and never
decorated.**

```
⚠ Deleting 'node_modules' and everything inside it
✗ 3 of 42 checks failed
✗ The checks failed; codevibez could not read how many
✗ Something needed for that step could not be found (exit code 1)
```

It names exactly what is being deleted instead of guessing at a number. Force
pushes, hard resets, overwritten files, permission changes and dropped
database tables get the same treatment. It says how many checks failed, and
when it cannot work that out, it says exactly that. A failed command keeps its
exit code. And it never guesses that something succeeded: when it cannot
determine the result, it stays silent.

These lines are also bold and colored, while routine reading is dimmed. That
is deliberate. Routine work fades into the background. Anything you actually
need to look at stands out.

## Install

You need Claude Code 2.1.287 or later in the terminal, or 2.1.286 or later in
the Code tab of the Desktop app. Tested on 2.1.295.

In a Claude Code terminal session:

```
/plugin install codevibez --marketplace leonhong18/codevibez
```

Answer `y` to add the marketplace, then pick a scope. No build step, no
account, no dependencies added to your machine, no newsletter. The English
appears as your agent works, in that session and every one after.

To uninstall: `/plugin uninstall codevibez`

## Where it shows up

- **The terminal and the Desktop app's Code tab:** every tool call's row is
  plain English.
- **The permission prompt stays as Claude Code draws it.** When Claude Code
  asks whether a step may run, the question and the step it is about show
  Claude Code's own words, so you approve exactly what will run. The English
  row takes over once you answer.
- **Not drawn:** the VS Code chat panel, `claude -p`, and cloud sessions. Those
  show Claude Code's own output, unchanged.

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
per prompt you typed, the prompt word for word as its heading, then every step
in English and the line that ended the turn. Failures and destructive steps
are always in it.

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
pane, and draw rows. No model calls, no network, no files,
no running programs.

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
