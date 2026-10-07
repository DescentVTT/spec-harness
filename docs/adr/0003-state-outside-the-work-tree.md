---
status: accepted
date: 2026-09-26
---

# ADR-0003: State outside the work tree, and temporary worktrees

## Context

Two things are in flight while a round runs: an escalation waiting for a
person, and a sandbox a probe runs in. The plan put the first in
`.escalation/session_*.json` in the repository and did the second with stash
and rollback. Both collide with spec-brief's ADR-0002 (the brief is the
record; no state file in the tree) and ADR-0004 (read git, never write it).

## Decision

- **In-flight state lives under the git common directory**,
  `<git-common-dir>/spec-harness/`: shared by every worktree of the
  repository, invisible to `git status`, never committed. Only outcomes are
  written into documents - a ruling becomes a row in the brief.
- **A sandbox is a detached worktree under the system temporary directory**,
  added for one job and removed after it: on success, on a throw, and on
  SIGINT, SIGTERM or SIGHUP. The person's branch, index, stash and files are
  never touched. Nothing is rolled back, because nothing of theirs changed.

*Amended 2026-09-28.* A worktree is removed only once nothing runs in it. On
Linux and macOS a probe's command leads a process group of its own, so that
its timeout can stop the group, and the terminal's Ctrl+C never reaches it:
the interrupt removed the worktree while the command ran on inside it, and on
Windows, where a running command holds its directory, failed to remove it at
all. On SIGINT, SIGTERM or SIGHUP the sandbox now stops every command still
running with everything it started, as the timeout does - SIGKILL to the
process group on Linux and macOS, `taskkill /T /F` on Windows - and waits up
to three seconds for them to let go of their output before it removes the
worktrees and exits. The wait is bounded because whatever still holds the
output after a forced stop has left the tree, and no wait would end it. After
an interrupt a command never answers the job waiting on it, so the job cannot
carry on in a worktree being removed, and the signal handlers stay installed
while the interrupt waits: a second Ctrl+C would otherwise meet Node's
default, which ends the process before any exit handler runs. When the
process exits mid-job its handler can only work synchronously: it stops the
commands the same way and cannot wait for them to end. On Windows a command
just stopped lets go of its directory a moment after `taskkill` returns, so a
worktree's directory that cannot be deleted yet is tried again, for up to
three seconds, and then reported rather than waited on further. An
interrupted process exits as a shell reports a process the signal ended, 128
and the signal's number: 130 on SIGINT, 143 on SIGTERM, and 129 on SIGHUP,
which exited 143, SIGTERM's code.

A worktree is removed, and forgotten by git, alone. Its directory is deleted
first, and `git worktree remove --force` is then run on its path. Measured
with git 2.55.0: git refuses to remove a worktree whose directory is there
without its `.git` file ("validation failed"), and removes its record of one
whose directory is gone - that worktree's entry under the repository's
`worktrees/` and nothing else, found by the path it was added at, through an
8.3 short name or a directory junction as well. The integration suite holds
both cases on every platform CI runs. `git worktree prune`, which the
sandbox ran after each removal at an interrupt and whenever one failed at
the end of a job, forgets every worktree git has lost track of: one of the
person's on a drive that is not mounted, or another tool's. It is no longer
run, and the sandbox touches `worktrees/` only through git.

*Amended 2026-10-08.* **Git is asked first, and a directory that cannot be
deleted costs its job nothing.** Measured with 0.10.0 on Windows (git 2.55.0,
Node 24.18.1): a probe whose command left a process running in the worktree
for longer than the three seconds lost its verdict to a Node stack trace,
exited 1, and left the whole checkout in the temporary directory with git's
record of it in the person's repository. Deleting the directory first is
what left the record. Where a process runs in a directory, Node deletes
nothing of it; where one runs in a directory inside it, Node deletes the
`.git` file and stops there, and git refuses a worktree without one. Asked
while the worktree is as its job left it, `git worktree remove --force`
deletes what it can and forgets the worktree whether or not it could delete
it all: it exits 255 with "failed to delete", the record is gone and the
directory is left empty.

So at the end of a job, at an exit and at an interrupt, git is asked first.
What is left of the directory is deleted next, tried for the same three
seconds. Git is asked a second time only when it refused the first, as it
does a worktree whose job deleted its `.git` file, and by then the directory
is gone. A directory still there after the three seconds is no longer an
error thrown: the job's answer stands, or what the job threw; the directory
stays on the sandbox's list and is tried once more when the process exits;
and one still there then is named on the standard error, in one line that
begins `spec-harness: the temporary worktree at`, where the exit ended in an
uncaught error before. The same probe now prints its verdict, exits by it,
and leaves an empty directory and nothing in git. A worktree whose job
deleted its `.git` file and whose directory cannot be deleted either keeps
git's record: git refuses it for as long as the directory is there.

**Ctrl+Break on Windows.** Windows has a fourth signal, SIGBREAK: Ctrl+Break,
which GitHub's runner also sends there, after Ctrl+C, to a step it cancels,
where it sends SIGTERM elsewhere (`ProcessInvoker.cs` in actions/runner).
Unhandled, it ended the harness at once, with the worktree in place,
git's record of it, and the probe's commands running on: on Windows a command
is started without a console window, in a console of its own, so no console
event reaches it, as no terminal signal reaches its process group elsewhere.
SIGBREAK is handled as the other three are, and exits 149, 128 and its
number. Measured with console events sent to a console of the harness's own:
Ctrl+C exits 130, Ctrl+Break 149 and a closed console 129, each with nothing
left behind.

A closed console is the one interrupt the system puts a deadline on: Windows
ends the process about five seconds after it. On a loaded workstation it
ended 0.10.0 before the harness had finished, once in three runs, with the
directory deleted and git's record left. Nothing in a handler lifts that
deadline. A process ended outright - `taskkill /F`, a run an agent stops -
runs no handler at all, and leaves the directory, the record and the
commands, as the Consequences say of a crash.

## Consequences

`git worktree add` is the one git write in the family, bounded to a directory
the tool created and deletes. A crash that skips every handler leaves a
directory in the temporary directory and an entry `git worktree prune`
removes.
