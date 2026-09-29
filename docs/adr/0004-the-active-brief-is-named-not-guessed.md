---
status: accepted
date: 2026-09-26
---

# ADR-0004: The active brief is named, not guessed

## Decision

The brief a round works on is, in order: `--brief <id>`; the `SPEC_BRIEF`
environment variable; the branch name, read through templates such as
`brief/{id}` and `*/brief-{id}` (configurable as `branches`). Ids compare as
written, or as numbers when both are all digits, so `brief/12` names `012`.

It is never inferred from which brief happens to be the only active one.
With no brief named, the guard has no contract to check and says so. With a
brief named that spec-brief does not know, or one already archived, every
write waits (exit 2) until the name is fixed: a guard pointed at the wrong
contract protects the wrong files.

*Amended 2026-09-30.* CI checks out a commit on no branch, so a round's own
CI run named no brief: `premises` read the premise the round retires as
stale, and failed the round's pipeline for doing its work. On a detached
HEAD the branch is now the one the forge's CI names, in this order:
`GITHUB_HEAD_REF`, a GitHub pull request's head branch; `GITHUB_REF_NAME`
when `GITHUB_REF_TYPE` is `branch`, the branch a GitHub push built;
`CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, a GitLab merge request's source
branch; `CI_COMMIT_BRANCH`, the branch a GitLab pipeline built. Each names a
branch only: `GITHUB_REF_NAME` names a tag too, so it is read only with
`GITHUB_REF_TYPE`, and GitLab's `CI_COMMIT_REF_NAME`, which names a tag as
well, is not read. This is a name, not a guess: the forge says which branch
the run builds, and the branch's name still has to carry the brief's id. A
branch checked out always wins, so a person's detached HEAD outside CI
names no brief, as before.

## Consequences

No file records the active brief, so no file can record it wrongly, and two
worktrees on two branches run two rounds without coordinating.
