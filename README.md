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
● Working on: "add a login page"
→ Searching through the project
→ Adding a ready-made tool to the project
✎ Writing new code (1 new file)
→ Checking everything still works…
⚠ Deleting 'dist/' and the 14 items inside it
✗ 3 of 42 checks failed
```

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
- **Your own prompt,** quoted back as a heading, so the activity underneath
  has something to belong to.

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
⚠ Deleting 'node_modules' and the 74 items inside it
✗ 3 of 42 checks failed
✗ The checks failed; codevibez could not read how many
```

It counts what is being deleted instead of guessing. It says how many checks
failed, and when it cannot work that out, it says exactly that. And it never
guesses that something succeeded: when it cannot determine the result, it
stays silent.

These lines also sit still while everything else gently pulses. That is
deliberate. Routine work breathes. Anything you actually need to look at
stops moving.

## Install

Inside Claude Code:

```
/plugin marketplace add leonhong18/codevibez
/plugin install codevibez
```

No build step, no account, no dependencies added to your machine, no
newsletter. Start a session and the English appears as your agent works.

To uninstall: `/plugin uninstall codevibez`

## Settings (probably for your agent to read)

Entirely optional. Create `~/.codevibez/config.json` only if you want to
change something, or paste this whole section at your agent and let it deal
with it:

```json
{
  "level": "plain",
  "inline": true,
  "flair": "full",
  "notify": false
}
```

- **level**: `plain` for no technical words at all, or `developer`, which
  names tools, packages and files. Pick `developer` if you have ever
  voluntarily read a stack trace.
- **inline**: set to `false` to stop the live English lines and keep only the
  recorded session.
- **flair**: `full`, `minimal` (no motion), or `off` (plain text, for people
  at work).
- **notify**: set to `true` to also ring the terminal bell on a deletion or a
  failure, so you can be startled in a second modality.

Setting `NO_COLOR` turns all styling off, as it does for any well-behaved
terminal program.

## What it writes down

One plain-text file per session in `~/.codevibez/events/`, so you can go back
and see what actually happened. On your machine, going nowhere. Long values
get trimmed before they are written, so the log stays a record of what
happened rather than quietly becoming a second copy of your codebase.

## How it works

Claude Code lets a plugin listen for events: a tool is about to run, a tool
finished, you submitted a prompt, the turn ended. codevibez listens, and for
each event asks a translator "what is this, in English?"

The translator is an ordinary function that knows nothing about the outside
world. Same event in, same sentence out, every time. No network call, no AI
model, no measurable delay. This is deliberate and slightly boring: a
codevibez that occasionally hallucinates a reassuring sentence would be worse
than no codevibez, and an AI model narrating an AI model is how you get two
things confidently wrong instead of one.

If any part of it breaks, it prints nothing and gets out of the way. It is
not allowed to interrupt your session. That rule outranks every feature here,
including all the nice ones.

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
