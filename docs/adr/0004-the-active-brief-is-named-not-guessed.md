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

## Consequences

No file records the active brief, so no file can record it wrongly, and two
worktrees on two branches run two rounds without coordinating.
