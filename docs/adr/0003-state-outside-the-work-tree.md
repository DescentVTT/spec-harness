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

## Consequences

`git worktree add` is the one git write in the family, bounded to a directory
the tool created and deletes. A crash that skips every handler leaves a
directory in the temporary directory and an entry `git worktree prune`
removes.
