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

## Consequences

Each tool is released, pinned and dropped on its own, and the harness adds no
dependency to any of them. The cost is a process per question: roughly 100 ms
on Linux and several hundred on a Windows workstation with real-time
scanning. The guard hook asks spec-brief only when a brief is named, once per
tool call.
