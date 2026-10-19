---
status: accepted
date: 2026-09-26
---

# ADR-0002: Siblings through their command lines

## Context

spec-harness needs spec-brief's view of the briefs, spec-guard's rules and
assertions, and spec-graph's view of the documents. It could import their
packages, or run their command lines and read the versioned JSON they
already print.

## Decision

**Command lines and versioned JSON, never imports** (spec-core ADR-0005).

- A sibling is found as the repository installed it,
  `node_modules/@descent-vtt/<tool>/bin/<tool>.js`, run with the current
  Node - or as `tools` in `.spec-harness.json` names it. Never through a
  shell: a brief id or a path is an argument, not syntax.
- A JSON document is read only at a `schemaVersion` this release knows. An
  unknown version, a document of the wrong shape, or exit 2 from a sibling is
  exit 2 here: the answer rests on something that cannot be read.
- **A missing sibling is reported, never assumed clean.** `audit` without
  spec-guard says the assertions were not run; `context` without spec-guard
  says the rules could not be read. Only spec-brief is required, because the
  brief is the contract and spec-brief is its reader.

*Amended 2026-10-12.* **What waits on nothing else is asked at once.** A
process per question is the cost this record took, and on a Windows
workstation it is what a command takes. Measured through the launcher of
main as it stood before this change, 0.16.0 and the two changes after it, in
a project with spec-brief 0.8.0, spec-guard 0.23.0 and the harness installed
and `init`'s entries written: on Windows 11 (Node 24.18.1, git 2.55.0,
Claude Code 2.1.235), and on Linux (Ubuntu 24.04 in a container on the same
machine, Node 24.21.0, git 2.43.0, with a `claude` that answers at once).
Ten runs of each, at the median:

| | Processes, one after another | Windows | Linux |
| --- | --- | ---: | ---: |
| `doctor`, no brief named | 9: eight of git's and `claude --version` | 5.3 s | 102 ms |
| `doctor`, on a brief's branch, with `--brief` on the hook's line | 14: eleven of git's, spec-brief twice and `claude --version` | 6.8 s | 301 ms |
| `init`, before anything is written | 6 of git's | 1.7 s | 90 ms |
| `hook claude`, no brief named | 3 of git's | 1.1 s | 87 ms |
| `hook claude`, a brief named, a write to a protected file | 7: six of git's and spec-brief | 2.5 s | 197 ms |

On Windows a git command took 227 ms, spec-brief 0.7 seconds to list the
briefs, and Claude Code 2.6 to say its release, half of what a `doctor`
takes; node itself took 0.4 seconds to reach its first line. On Linux git
took 2 ms and spec-brief 89 ms, and what a command takes is node: 24 ms to
start and 43 ms to load the harness's modules, of the 87 ms of a hook.

Few of those answers were needed to ask for the next. Git names the root
before anything is asked of it; the branch names the brief spec-brief is
asked about; the base's commit and HEAD's come before the commit the two
share, and that one before the signers' file is read on the base; and the
settings say whether Claude Code runs the guard before it is asked its
release. The rest waited on one another for being written one after another,
and no longer do:

- **Opening a work tree**, which every command does, the hooks among them:
  the common directory, the configuration and the branch are asked for at
  once, when git has named the root.
- **The base**: its commit and HEAD's are asked for at once.
- **`doctor`** asks at once for the brief, the base with the signers on it,
  spec-brief's plugin, Claude Code's wiring with its release, and git's
  hook.
- **`init`** asks at once for the remote's default branch and the local
  branches, for the wiring, and for git's hook.

Each answer is read where it was awaited before (`Promise.allSettled`, and
`answerOf` in `src/workspace.ts`), so a run in which one of them fails ends
on the first that failed in that order, with what it said, whichever failed
first by the clock. What is asked is what was asked, of the same program,
from the same directory, as often: no answer is kept from one run to the
next (ADR-0003), and no sibling is asked less. One thing is asked that was
not, and its answer is not read: what stood after a failure in that order,
as HEAD's commit does where the base names none.

Nothing `doctor`, `init` or either hook prints changed. 90 trees on Linux,
the 51 of 0.16.0's own measurement among them, were each run through main's
build and this one at one path: the hook before a write and after one,
`doctor` in three ways, `init` in two, git's hook, `init --write`, and
`doctor` and `init` after it, 1,054 steps. Stdout, stderr and the exit code
of each were the same, as they were on Windows over 91 trees and 1,066
steps, but for one thing in one tree: the frames of the stack that an error
nothing expected ends on, which name lines of the build, where git's
pre-commit hook is a directory.

With the two builds taking turns inside each of ten runs, at the median, and
in how many of the ten this build was the quicker:

| | Windows: before | after | quicker in | Linux: before | after | quicker in |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `doctor`, no brief named | 5.3 s | 4.8 s | 8 of 10 | 102 ms | 103 ms | 5 of 10 |
| `doctor`, on a brief's branch | 5.4 s | 4.3 s | 10 of 10 | 203 ms | 177 ms | 10 of 10 |
| `doctor`, on a brief's branch, with `--brief` on the hook's line | 6.8 s | 6.1 s | 10 of 10 | 301 ms | 207 ms | 10 of 10 |
| `init`, before anything is written | 1.7 s | 1.6 s | 6 of 10 | 90 ms | 90 ms | 6 of 10 |
| `init`, after `init --write` | 1.3 s | 1.2 s | 7 of 10 | 92 ms | 94 ms | 5 of 10 |
| `hook claude`, no brief named | 1.1 s | 1.0 s | 8 of 10 | 87 ms | 85 ms | 6 of 10 |
| `hook claude`, a brief named, a write to a protected file | 2.5 s | 2.4 s | 8 of 10 | 197 ms | 192 ms | 6 of 10 |
| `hook git`, a brief named, one file staged | 2.2 s | 1.9 s | 9 of 10 | 181 ms | 183 ms | 5 of 10 |

Starting node to do nothing took 0.4 seconds beside those Windows runs.
Three hours earlier, on 0.16.0, with other work holding every processor of
the workstation and that start at 2.8 seconds, the same `doctor` took 25.5
seconds and 20.0, and `init` 17.7 and 14.4, and no difference could be told
in the hook that asks spec-brief, 14.7 seconds and 17.2. On Linux only a
`doctor` that asks spec-brief shows one.

**What is left is the processes themselves.** Node creates a process inside
the call that starts it: on this workstation the call came back after 95 ms
for git and 2.3 seconds for Claude Code's program of 326 MB, on Linux after
1 ms, and until it is back nothing else is started and no answer is read. So
a `doctor`'s nine processes are still created one after another, 3.1 of the
3.8 seconds between its first question and its last answer; asked at once,
they only run side by side. Fewer processes would take asking git several
things in one start, which changes what is asked and how its answer is read,
and was not done.

**A matcher that is a pattern is read once in a run** (ADR-0005). `doctor`
read the pattern over every entry, and `init` read an entry's once more for
what to write: fifty entries under one pattern that runs out its budget of
100 ms were fifty readings and 5.2 seconds of a `doctor`, and fifty-one of
an `init`. A run now has one reader (`patternReader`, `src/configure.ts`),
handed to whatever reads the settings, and it reads a pattern the first time
it is asked of: one reading, and 0.2 seconds. It is made where the run
begins and kept nowhere, since a reading is of the clock, and one kept past
its run would answer for a machine that is busy no longer. A file with a
pattern of its own over each entry is read as before, a budget each, fifty
in 5.2 seconds: nothing bounds what such a file can hold.

*Amended 2026-10-14.* **A command loads what it runs, a work tree is opened
at its top in one wave, and a refusal asks nothing of the base.** `hook
claude` is started before and after every write an agent makes, so what it
takes is what a session waits, write by write. Measured through the
launcher of 0.17.0, in a project with spec-brief 0.8.0, spec-guard 0.23.0
and the harness installed and `init`'s entries written, under a preload
that writes down when node reached its first line, when the command line
began to read its arguments, and when each process was asked and answered,
and hands every call on as it was given. On Linux (Ubuntu 24.04 in a
container, Node 24.21.0, git 2.43.0, with a `claude` that answers at once),
ten runs of each, at the median:

| | Processes | The run | node, to its first line | The modules | Everything asked |
| --- | --- | ---: | ---: | ---: | ---: |
| `hook claude`, no brief named | 3 of git's | 96 ms | 28 ms | 49 ms | 11 ms |
| `hook claude`, on a brief's branch, a write in its scope | 3 of git's and spec-brief | 196 ms | 29 ms | 46 ms | 109 ms |
| `hook claude`, on a brief's branch, a write to a protected file | 6 of git's and spec-brief | 218 ms | 27 ms | 47 ms | 126 ms |
| `hook claude`, in a directory that is in no work tree | 1 of git's | 92 ms | 26 ms | 51 ms | 5 ms |
| `doctor`, no brief named | 8 of git's and `claude --version` | 114 ms | 27 ms | 48 ms | 31 ms |
| `init`, before anything is written | 6 of git's | 103 ms | 25 ms | 49 ms | 18 ms |

The modules were half of a hook that names no brief: `cli.ts` imported
every command before it read which one was typed, 52 modules, 44 ms loaded
at once without the preload, and 63 ms on Windows. No one of them is the
cost. Loaded one at a time, each after all it imports, none took 4 ms on
either system (`node:crypto` 4.0 on Linux, the front matter of the vendored
Markdown scanner 2.4, `node:util`, `cli.js` and `configure.js` 2.2 each),
and half of them took under a millisecond: the cost is how many there are.

On Windows 11 (Node 24.18.1, git 2.55.0) a hook is its processes. With the
workstation at rest, where starting node to do nothing took 0.3 seconds,
the hook that names no brief took 1.4 seconds, through the build main had
when this change met it: 0.18 of them node reaching its first line, 0.06
the modules, and 0.97 git's three processes in their two waves. Shared by
six agents with every processor held, where starting node took 5.3
seconds, it took 22.7 through 0.17.0: 3.6 node, 0.07 the modules, and 15.4
git's three processes, six seconds each.

Three things were built, each for what was measured, the hook first:

- **A command loads what it runs.** `cli.ts` imports what every run needs,
  the hook's among it: the parser, the refusals, the work tree, the
  siblings' edge and the hook's own language. A module that only some
  commands run is asked for where one of them is the command, with
  `import()`: the commands that read a round (`commands.ts`), `premises`,
  `init` and the server, and for `doctor` the tables of `init` and the
  signers. The hook, `guard` and git's hook ask for the operations of a
  round (`round.ts`) where there is a write to decide, and for the reader
  of a brief where a ruling is read; `round.ts` asks for the audit's
  judgement where an audit runs, which is what brought the Markdown scanner
  with it, for the hash where a copy of the signers is named by one, and
  for what asks Claude Code its release where the wiring of a guard has it
  asked. A hook that names no brief loads 26 modules where it loaded 52, 39
  where it reads a brief's rulings, and 12 where it decides nothing: a
  session in no work tree, a tool that writes no file. `checkPaths` takes as
  its reader a reader or what makes one, so that a caller that decides
  every write loads no scanner for those that read no ruling.
- **A work tree is opened at its top in one wave.** The top and the common
  directory are asked for in one start of git, `rev-parse --show-toplevel
  --path-format=absolute --git-common-dir`, where they were two, and where
  a `.git` stands in the directory the command runs in, as it does at the
  top of a work tree, the branch is asked for beside them and not after:
  two processes at once where there were three in two waves. The branch
  stays a question of its own: measured with git 2.55.0, in a repository
  with no commit `symbolic-ref` names the branch and `rev-parse
  --abbrev-ref HEAD` fails.

  Measured with git 2.43.0 and 2.55.0, rev-parse answers the two in the
  order they stand on its line, a line each, and prints nothing where the
  first fails. Its manual says of that only that `--show-toplevel` reports
  an error where there is no working tree (git-rev-parse(1), *Options for
  Files*, as git 2.55.0 has it, read 2026-10-14), so nothing is read on
  trust. The one answer is read only where it is two lines, each what
  `trim` would leave, from a git that did not fail. Nothing printed, by a
  git that failed, is the first question failing: the directory is in no
  work tree, as before. Anything else has the questions asked one at a
  time, as they were, which is what a path with a line break in it gets, a
  top whose name ends in a space, and, as follows from the manual and was
  not measured, a git older than 2.31: under *Options for Filtering* a
  flag is put out unless `--no-flags` says otherwise, and
  `--path-format` is new in the release notes of 2.31.0.

  What git said from the directory the command runs in is taken for the
  root's only where that directory is the root, spelled by the filesystem
  as git spells a top. Measured with both gits: started in a work tree
  that `core.worktree` names, away from its repository, git finds no
  repository, so asked of that root it names no branch, where from the
  repository it names one, and every release has read the first. Anywhere
  else the common directory and the branch are asked for from the root, at
  once, as they were: below a top, three processes in two waves as before,
  and in no work tree one. Two trees start more than they did: one where
  the one answer is not read, by one process, or by two at a top; and one
  where a `.git` stands in a directory that is not the top of its work
  tree, by one.
- **A refusal asks nothing of the base.** A write to a protected file had
  the base resolved, three of git's processes in two waves, before the
  brief's rulings were read, and the base is read only for the allowed
  signers a ruling's commit is checked against. The rulings are now read
  first, and where no row allows anything, what was decided without a
  ruling stands: a refusal starts three processes where it started seven.
  Where a row allows something the base is asked for as before.

**A module that cannot be loaded is a failure with a sentence.** It is
thrown where it was asked for, and ends the run in exit 2: with the line
the launcher has for a build without its command line, `build output is
missing`, where a file of the build is not there, and with `unexpected
error` and its stack for anything else. The hook before a write says it
`cannot check this write`, and exit 2 holds the write, as for a spec-brief
that cannot answer. This is the one thing a run can show of the change: in
a build with one command's module missing, every command ended on the
launcher's line, and now the commands that do not run the module answer.

**A sweep still reads every module whole.** Stryker 10.0.0 runs every
test for a mutant that was reached outside any test, whether or not one
reached it too, and only the tests that reached it for any other
(`planMutant` in its `mutants/mutant-test-planner.js`, with `ignoreStatic`
off, as it is here). What a module does as it loads, its tables and
constants, was reached outside any test wherever a test file loaded the
command line, which imported every module. Left to an `import()`, a module
loads inside the first test that needs it, and a mutant of one of its
tables would be run for that test alone. So each module asked for with
`import()` has a test file that imports it at its top, which is one file
that reaches it outside any test, and `tests/source.test.ts` fails for one
that has none; `commands.ts` had none, and has one now. Under a
mutant that makes one of them throw as it loads, a file that imports it
does not load, and a sweep counts a test that failed and not a file that
did not load (ADR-0010): `tests/integration/loads.test.ts` imports none of
them at its top, runs each command through the command line, and fails.
And a test file that loads modules afresh, as each test of the sandbox
does, loads the command line afresh where it runs it: one loaded before
would run a command's module of the new ones and judge what it throws by
the classes of the old, which no process does. Two tests of the sandbox
ended on a stack that way until they did.

What is asked of spec-brief is what was asked, as often: the list of
briefs, once for a hook that names a brief. No answer is kept from one run
to the next (ADR-0003).

Nothing any command prints changed, nor an exit code. Main moved while
this was measured, to a `doctor` that says more of a hook's line
(ADR-0005), so the comparison was made twice: against the build of 0.17.0,
and, with main merged in, against main as it then stood. The second, on
Linux: 139 trees, the 90 of the amendment of 2026-10-12 among them and 49
more, for where a work tree is opened from, what a repository is besides
one checkout of one branch, what the rulings of a brief hold, what stands
outside its scope, and what that `doctor` newly reads, a root on the
hook's line in another work tree among it, were each run through main's
build and this one at one path: the hook handed the words of its line
before and after a write to a protected file, to one in the scope and to
one outside it, `doctor` in three ways, `init` in two, git's hook, `init
--write` and `doctor` and `init` after it, and in 41 of them every other
command and a session of the server, 3,114 steps. Stdout, stderr and the
exit code of each were the same. The first, of 125 trees and 2,850 steps,
differed in the frames of a stack alone, in the one tree that ended on
one, where git's pre-commit hook is a directory, which main now says in a
line. On Windows, where a tree takes minutes, those that turn on how
Windows spells a directory were run first, the project reached through a
junction and the project named in another case, then others of how a work
tree is opened and those of what that `doctor` reads: 20 trees and 475
steps against main as it stood, the same in every one, and 35 trees and
665 steps against 0.17.0, the same but for the frames of that stack.

With the two builds taking turns inside each of ten runs, main as it stood
and this one, at the median, and in how many of the ten this build was the
quicker. On Linux:

| | Before | After | Processes | Modules loaded | Quicker in |
| --- | ---: | ---: | --- | --- | ---: |
| `hook claude` before a write, no brief named | 91 ms | 64 ms | 3, then 2 | 52, then 26 | 10 of 10 |
| `hook claude` after a write, no brief named | 88 ms | 64 ms | 3, then 2 | 52, then 26 | 10 of 10 |
| `hook claude`, on a brief's branch, a write in its scope | 176 ms | 155 ms | 4, then 3 | 52, then 26 | 10 of 10 |
| `hook claude`, on a brief's branch, a write to a protected file | 182 ms | 164 ms | 7, then 3 | 52, then 39 | 10 of 10 |
| `hook claude`, in a directory that is in no work tree | 75 ms | 47 ms | 1 | 52, then 12 | 10 of 10 |
| `hook claude`, a session started below the root, on a brief's branch | 177 ms | 154 ms | 4 | 52, then 26 | 10 of 10 |
| `hook claude`, under a line whose root is a repository beside the project | 82 ms | 60 ms | 3, then 2 | 52, then 26 | 10 of 10 |
| `hook git`, on a brief's branch, a protected file staged | 185 ms | 160 ms | 8, then 4 | 52, then 39 | 10 of 10 |
| `doctor`, no brief named | 99 ms | 81 ms | 9, then 8 | 52, then 29 | 10 of 10 |
| `doctor`, a hook's line whose root is a repository beside the project | 174 ms | 157 ms | 13, then 12 | 52, then 29 | 10 of 10 |
| `init`, before anything is written | 87 ms | 67 ms | 6, then 5 | 52, then 27 | 10 of 10 |
| `--version` | 71 ms | 40 ms | none | 52, then 12 | 10 of 10 |

Against 0.17.0, before main moved, the same runs had the hook that names
no brief at 96 ms and 72, `doctor` at 114 and 97, and `init` at 103 and
78.

On the Windows workstation at rest, where starting node to do nothing took
0.3 to 0.4 seconds beside these runs:

| | Before | After | Quicker in |
| --- | ---: | ---: | ---: |
| `hook claude` before a write, no brief named | 1.39 s | 1.01 s | 9 of 10 |
| `hook claude` after a write, no brief named | 1.62 s | 1.01 s | 10 of 10 |
| `hook claude`, on a brief's branch, a write in its scope | 2.31 s | 1.79 s | 8 of 10 |
| `hook claude`, on a brief's branch, a write to a protected file | 3.59 s | 1.87 s | 10 of 10 |
| `hook claude`, in a directory that is in no work tree | 0.75 s | 0.73 s | 8 of 10 |
| `hook claude`, a session started below the root, on a brief's branch | 2.24 s | 2.22 s | 4 of 10 |
| `hook git`, on a brief's branch, a protected file staged | 4.28 s | 2.40 s | 10 of 10 |
| `doctor`, no brief named | 5.17 s | 4.80 s | 8 of 10 |
| `doctor`, a hook's line whose root is a repository beside the project | 7.39 s | 6.75 s | 7 of 10 |
| `init`, before anything is written | 2.83 s | 2.34 s | 8 of 10 |

Below the top of a work tree as many processes are started as before, in
as many waves, and the modules not loaded are 0.04 of two seconds: the
hook is no quicker there. With every processor of that workstation held,
against 0.17.0, the hook that names no brief took 13.7 seconds where it
took 22.7, in 10 of 10, and the refusal 20.9 where it took 35.0, in 9 of
10: what a process costs there is what the workstation is doing.

**What is left of a hook** is node itself, 28 ms on Linux and 0.2 seconds
on Windows before its first line; spec-brief on a brief's branch, 100 ms
on Linux and the longest wait of a hook on Windows, for every write, which
only an answer kept between runs would take away (ADR-0003); and one wave
of git's. `round.ts` still loads the tables of `init` with it, and what
renders a context and reads a manifest, 5 ms of a hook on Linux: two of
the operations that read those tables answer at once, with no `import()`
to wait on.

**Measured again and not built: Claude Code asked its release from a
thread of its own.** A worker thread whose only work is to start `claude
--version`, beside four of git's commands that wait on one another, as the
base's do. With every processor of the workstation held, the two together
took 18.9 seconds from a thread of its own and 24.3 from the one thread,
at the median of ten rounds, and the thread was the quicker in 7 of the
10; idle, the amendment of 2026-10-12 has them at 4.3 and 5.5. It is some
thirty lines, of which the module that runs in the thread is one more for
a sweep to read and one only a Windows job can test, with the three
failures `claudeVersion` says in its own words carried across the thread.
It would serve `doctor` alone, on Windows alone, a command a person runs
now and then: on Linux a program that answers at once took 1.7 ms started
from the one thread and 36 from a thread of its own, and the hook asks
Claude Code nothing. So it is left.

*Amended 2026-10-18.* **The answer after a write is the one decided before
it, kept for that call.** *Claimed* by the evaluation of a consumer's
request in round 24, measured at bd6a87c: a PostToolUse run reports only
what is decided `warn`, and deciding it costs what a PreToolUse run costs,
on a brief's branch about 1.7 to 1.9 seconds on a Windows workstation and
about 330 ms on GitHub's Windows runner, of which spec-brief's `list` is
about 0.9 seconds on the workstation and 180 ms on the runner.

*Read from the source*: the only decision that warns is a write outside the
scope under `outOfScope: "warn"` (`decide`, `src/guard.ts`: its verdict is
the configuration's for that reason alone), and the only answer a run after
a write gives from decisions is those that warn, as additional context
(`claudeResponse`, `src/hooks.ts`). A run after a write says three other
things, none of them from a decision: exit 1 and a line for a question or a
line of its own it cannot read, exit 0 and nothing outside a work tree, and
exit 2 and a line for what it cannot check, a configuration that does not
load, a brief named that is none, a spec-brief that is missing or cannot
list the briefs. Claude Code shows the stderr of a PostToolUse hook's exit
2 to Claude, and the tool has run (the hooks reference,
<https://code.claude.com/docs/en/hooks>, *Exit code 2 behavior per event*,
read 2026-10-18).

*Measured* through the launcher of main (fd76621, the `src/` of 7b28ca8)
and of this change, Windows 11, Node 24.18.1, Git for Windows 2.55.0, in
scratch projects with spec-brief 0.8.0 installed, each run after a write
paired with the run before it by its `session_id` and `tool_use_id`, as
Claude Code's hooks reference shows both events' input to carry them
(`h24-measure-h2.mjs`, 44 cases): every answer the same in both builds, the
call before the write and after it, under no brief, a brief's branch in its
scope and out of it, a protected file, `outOfScope` `deny` and `ask`, a
linked worktree the session started in, a run after a write with no run
before it, two calls at once, another call's ids, no ids, and a write that
changes the configuration, spec-brief's configuration or the brief. Two
answers differ, each where something other than the write changed what
decides between the two runs: the configuration made `outOfScope: "deny"`,
after which the run warned of nothing and now warns as the run before
decided; and spec-brief's configuration broken, after which the run ended
in exit 2, `spec-brief could not list the briefs`, and now warns as decided,
the exit 2 coming at the next run before a write, which it holds. Every line
of the hook the amendments of ADR-0005 measured, before a write and after
the same call, was run through both builds (`h24-hook-compare.mjs`).

- **Where nothing can be said, nothing is started.** Under
  `outOfScope: "ask"` or `"deny"` no decision warns, and the run after a
  write says nothing without starting git or spec-brief. The configuration
  is read where git would read it, found by the files git keeps: the
  nearest directory at or above the hook's root that holds a `.git`, the
  git directory it is or names, and the common directory that git
  directory's `commondir` names (gitrepository-layout(5), as Git for
  Windows 2.55.0 has it, read 2026-10-18). Where git could read another
  work tree, it is decided as before: `GIT_DIR` or `GIT_WORK_TREE` set, a
  `worktree` key in the repository's configuration, a `config.worktree` of
  the git directory's own, a session whose `cwd` is outside that work tree
  or in a repository inside it, or a configuration that does not load.
- **Otherwise the run before a write keeps what the run after it would
  say.** A run before a write that lets the call go ahead keeps the
  warnings it decided, under the common directory (ADR-0003), named by the
  question's `session_id` and `tool_use_id`, each made of letters, digits,
  `_` and `-` alone and no longer than 256: a question that names neither,
  or names one otherwise, keeps nothing. With them it keeps the call as
  both runs see it: the release, the session and the call, the tool, its
  paths, the session's directory, the root, brief and base on the hook's
  line, the directory the hook was started in, and the variables it reads
  (`CLAUDE_PROJECT_DIR`, `SPEC_BRIEF`, and the four a forge's CI names a
  branch by, ADR-0004). The run after it, for the same session and call,
  takes the entry away as it reads it, and answers from it where all of
  that is the same; an entry that is missing, cannot be read, or is another
  call's is decided as before, with git and spec-brief. Keeping it is
  passed over where it fails, so that nothing kept can change the answer
  before a write, and the answer before a write reads nothing kept.
- **A call that writes what the answer is made from keeps nothing**, and
  is decided again after the write: `.spec-harness.json`, spec-brief's
  configuration (`.spec-brief.json`, `spec-brief.json`), the brief, and a
  file in the brief's directory, which spec-brief lists. So is a call that
  is refused, which no run after it comes for. Where a call's paths are
  decided in two work trees (ADR-0005, amended a third time 2026-10-18),
  what is kept is every decision of the answer, and nothing is kept where
  a decision of either refuses or is of what the answer is made from.
- **Two sessions, two worktrees, parallel calls**: each entry is named by
  its session and its call, and answers only a run for which the whole call
  is the same. Claude Code starts PostToolUse once for each tool, at once
  for parallel calls (the hooks reference, *PostToolBatch*, read
  2026-10-18), and each takes its own entry.
- **What a stale answer can cost.** A run after a write warns, or says
  what it cannot check: it holds nothing, the tool having run. Answered
  from the run before, it is the answer of the decision made a moment
  before the write. A write to what the answer is made from keeps nothing,
  so what can make the two differ is what another process changes between
  them, as the two rows above did: at worst a warning about the scope is
  given that the configuration as changed would not give, or one is
  missed, and a configuration or a spec-brief the other process broke is
  said at the next run before a write, which holds that write, instead of
  after this one.
- **The saving rests on Claude Code's ids, and nothing else does.** The
  hooks reference lists `tool_use_id` among PreToolUse's input fields and
  shows it in PostToolUse's input, `toolu_01ABC123...` in both examples
  (*PreToolUse input*, *PostToolUse input*, read 2026-10-18), and does not
  state that the two are equal for one call. Where they are not, no run
  after a write finds an entry, and each is decided as before: no answer
  depends on it, only the time. No Claude Code was started to see which.
- **Entries no run after a write reads** - a call the person refused, one
  that failed, one interrupted - are removed by the next run before a write
  once a day old, with what an interrupted write left. A day, because a
  call waits on a person's permission prompt for as long as the person is
  away, and an entry removed too soon costs only that call's answer being
  decided again; the entries a day leaves are a few hundred bytes each.

What it saves, with the two builds and the next change's taking turns
inside each round, each run after a write preceded by the run before it
for the same call, at the median and with the 95th percentile between
brackets (`h24-bench.mjs <work> <rounds> <out.json> main=<build>
h2=<build> h3=<build>`). On GitHub's Windows runner (`windows-2025-vs2026`,
Node 24.21.0, Git for Windows 2.56.0, four cores), thirty rounds, through a
workflow of a draft pull request that measured and was closed
(DescentVTT/spec-harness#111), where starting node to do nothing took 60
ms; and on the Windows workstation (Node 24.18.1, Git for Windows 2.55.0,
sixteen threads), ten rounds, where it took 693 ms, the machine shared:

| The hook | Runner: main | This change | Workstation: main | This change |
| --- | ---: | ---: | ---: | ---: |
| after an Edit, no brief named | 154 ms (166) | 92 ms (98) | 784 ms (826) | 739 ms (792) |
| after an Edit in the scope, on a brief's branch | 338 ms (350) | 89 ms (95) | 1,655 ms (1,799) | 706 ms (780) |
| after an Edit outside the scope, which it warns of | 340 ms (354) | 91 ms (102) | 1,575 ms (1,673) | 709 ms (785) |
| after an Edit, `outOfScope: "deny"` | 340 ms (366) | 90 ms (96) | 1,622 ms (1,729) | 704 ms (804) |
| after an Edit, `outOfScope: "deny"`, nothing kept | 345 ms (393) | 91 ms (103) | 1,605 ms (1,778) | 726 ms (771) |
| after an Edit outside the scope, nothing kept | 342 ms (371) | 346 ms (359) | 1,639 ms (1,790) | 1,631 ms (1,739) |
| before an Edit in the scope, on a brief's branch | 342 ms (352) | 343 ms (356) | 1,596 ms (1,718) | 1,643 ms (1,769) |
| before an Edit, no brief named | 156 ms (162) | 158 ms (173) | 792 ms (869) | 809 ms (873) |

A run after a write answered from what was kept starts no process, and
takes what node takes to start and load the hook's modules; one decided as
before takes what it took. A run before a write keeps a file and reads the
directory it keeps it in, within the spread of the rows above.

No answer the hook gives to a call Claude Code makes changes but where
another process changes what decides between its two runs: a minor
release (spec-core's ADR-0009).

*Amended 2026-10-19.* **Every process the harness starts has a time limit,
and the hook holds the write at it; every file it reads is checked to be a
file first.** *Claimed* by round 24's agents B and H: a named pipe at
`.spec-brief.json` makes spec-brief wait, and the hook and `doctor` wait on
spec-brief with no time limit; `readText` (a brief, a document a brief
cites) and the hook's own reads of git's files and of what a run before a
write kept read a path without checking it is a file.

*Measured* through the launcher of main (3c4112c) and of this change, in
scratch repositories on a brief's branch whose brief protects `src/db/**`,
with spec-brief 0.8.0 installed: a named pipe made where the row says,
nothing writing to it, in a Linux container as an ordinary account (Node
24.21.0, git 2.47.3; `b25-fifo.mjs`), each run given 65 seconds, past the 60
that `init` and the plugin give the hook's entry:

| The named pipe, and the command | main | Now |
| --- | --- | --- |
| `.spec-brief.json`; the hook before a write | no answer: spec-brief reads its configuration without end, and the harness waits on it | exit 2 at 20 seconds: `cannot check this write: spec-brief did not answer within 20 seconds, and was stopped` |
| the same; after a write | no answer | exit 2 at 20 seconds, the same words |
| the same; as a session starts | no answer | exit 0 at 20 seconds, the words, `so every write of this session is held until it is mended` |
| the same; `doctor`, `guard` | no answer | `doctor` comes back at 21 seconds, the brief's line saying it; `guard` exit 2 at 20 |
| `.git/config`; the hook before a write and after one, `doctor` | no answer: git reads its configuration without end, and the hook's own read of it after a write stops the process | exit 2 at 20 seconds: `git rev-parse did not answer within 20 seconds, and was stopped`, before a write as `cannot check this write: ...` |
| what the run before a write kept for the call; the hook after the write | no answer | the call decided as before, 1.2 seconds |
| the `package.json` of the installed spec-brief; the hook before a write, `doctor` | no answer: it is read as the process waits on it | spec-brief `declares no version`, as for one that is not JSON: the write held, `doctor` exit 1 |
| a document the brief cites; `context` | no answer | the document cited and not found, exit 0 |
| a request waiting for a ruling; `escalate --list` | no answer | passed over, as one that cannot be read |
| the report a probe's `junit` names, made by its command; `probe` | no answer | `cannot be read: it is neither a file nor a directory, not a report`, the probe invalid |
| the brief's file; the hook, `doctor` | spec-brief lists no such brief: the write held, as for a brief not there | the same: the harness reads a brief's file only once spec-brief has listed it |
| none; the hook and `doctor` | under a second | the same |

So the claims hold, and more widely: git had no limit at all, and the
hook's own reads of git's configuration, of a worktree's `commondir`, of a
sibling's manifest and of the harness's own install, made as the process
waits, stopped every timer with them. Spawned by the harness, spec-brief had
a limit of ten minutes, which Claude Code's 60 seconds on the hook's entry
reach first: the hooks reference (<https://code.claude.com/docs/en/hooks>,
*Timeouts*, read 2026-10-19) has a command hook that reaches its timeout
cancelled, and before a tool call not block it, unless `onFailure` is
`"block"`. A hook that waits on a sibling past that minute lets the write
go ahead.

- **A process asked a question is stopped after 20 seconds** (`ANSWER_MS`,
  `src/git.ts`): git's reads, and spec-brief's list of the briefs, which is
  the one sibling run a write waits on. A process that does a round's work
  keeps ten minutes (`WORK_MS`): a diff of the round, a worktree a probe
  adds or takes away, a sibling's check of the repository, spec-brief's
  `init`. `claude --version` keeps its 15 seconds, and a probe's command
  its own timeout; `taskkill` is given a question's time, and the
  sandbox's last `git worktree remove` the time of work.
- **At the limit the question is answered as one that failed, and says
  why.** git and the sibling are stopped, and the run rejected as a
  `GitError` or a `SiblingError` that names the command and the limit:
  read as a git that failed, a question of where the work tree is or which
  branch is checked out answered as a directory in none, or a head on no
  branch, under which the hook checks no write. Before a write that is a
  write the hook could not check, in the words a write gets where a sibling
  fails, `cannot check this write: ...`, exit 2, which holds it; after a
  write, exit 2 with the same words, as for any sibling that fails; as a
  session starts, the line of every write held. Every other command exits
  2 with the line, and `doctor` says spec-brief's in its brief's line.
- **Why 20 seconds.** Claude Code gives the hook's entry 60 (`"timeout":
  60`, as `init` and the plugin write it). The hook runs at most one
  process that does not answer, since the first ends the run, so a hook
  whose process hangs answers at the limit and what came before it, well
  inside that minute; the measured hang above answered at 20.2 seconds.
  And no process it asks a question of comes near the limit: on the
  Windows workstation, with a test suite running beside it and node taking
  759 ms to start and do nothing, git's two starts took 63 and 62 ms at the
  median of ten and 80 at the slowest, and spec-brief's list 915 ms and
  1,004 at the slowest (`b25-measure-limits.mjs`); on GitHub's Windows
  runner the hook as a session starts on a brief's branch, a write's check
  without the write, two of git's starts and spec-brief's list, took 325 ms
  at the median (ADR-0005, the fourth amendment of 2026-10-18,
  DescentVTT/spec-harness#111). The limit is twenty times the slowest here
  and some sixty times the whole hook there.
- **Only a regular file is read where a file is expected** (`isFile`,
  `src/fs.ts`), as `.spec-harness.json` and the settings files were from
  0.19.0: a brief's file and a document a brief cites (`readText`, which
  Windows shims are read through too), git's configuration and a worktree's
  `commondir` as the hook reads them with no process, what a run before a
  write kept, a sibling's `package.json`, the harness's own install in the
  project, a request waiting for a ruling, and a probe's report. What else
  stands there is read as a file that is not there, or, for a report, said
  as neither a file nor a directory. The harness's own files, its manifest
  and its skills, are read as they are: they are the package's, not the
  repository's.
- **The hook answers no line differently where nothing waits.** Every line
  of the hook the amendments of ADR-0005 measured was run through the
  launcher of main and of this change on Windows, taking turns, before
  seven writes, after each and as a session starts, and git's hook
  (`b25-hook-compare.mjs`): of 214 runs, each answered the same, exit code
  and both streams. On Linux the plain tree above answered in the same time
  on both builds, under a second.

Tests hold each with a run that must stop and one that must still answer:
git (`hash-object --stdin`, whose input the harness never closes) and a
sibling stopped at a limit of their own, and one that answers before it;
spec-brief's list stopped at the time a question is given, shortened to
five seconds in `tests/integration/limits.test.ts`, through the hook before
a write (held) and after one, as a session starts, through `doctor`, and a
write that names no brief, which asks spec-brief nothing and still passes;
and on Linux, each reader handed a named pipe.

An exit code that can change for a tree, and runs that now end where they
did not: a minor release (spec-core's ADR-0009). What was measured for this
and left as it was:

- **A hook whose entry gives it less than the limit.** A person may write a
  `timeout` below 20 seconds on the hook's line, under which Claude Code
  cancels it first. The hook cannot read its entry, and `doctor` does not
  read the field.
- **A process that answers slowly and does not hang.** The limit is each
  process's; a hook whose every process took nearly 20 seconds could pass
  the minute. No such machine was measured.
- **spec-brief reading the brief's file.** spec-brief 0.8.0 lists no brief
  whose file is a named pipe, so the hook holds the write as for a brief
  that is not there; that is spec-brief's to say better.

## Consequences

Each tool is released, pinned and dropped on its own, and the harness adds no
dependency to any of them. The cost is a process per question: roughly 100 ms
on Linux and several hundred on a Windows workstation with real-time
scanning. The guard hook asks spec-brief only when a brief is named, once per
tool call.
