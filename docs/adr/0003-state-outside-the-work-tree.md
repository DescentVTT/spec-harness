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
three seconds, and then reported rather than waited on further.

## Consequences

`git worktree add` is the one git write in the family, bounded to a directory
the tool created and deletes. A crash that skips every handler leaves a
directory in the temporary directory and an entry `git worktree prune`
removes.
