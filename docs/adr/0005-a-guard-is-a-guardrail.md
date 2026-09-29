---
status: accepted
date: 2026-09-26
---

# ADR-0005: A guard is a guardrail; the audit and the archive are the gates

## Context

The plan intercepted an agent's writes by watching its output stream and
killing it on a violation. By the time a stream shows a write, the write has
happened. And an agent with a shell can write a file no tool-level hook sees.

## Decision

- **Before the write, in the agent's own hook.** `spec-harness hook claude`
  answers Claude Code's PreToolUse for Edit, Write, MultiEdit and
  NotebookEdit, reading the file from `file_path`, `path` or
  `notebook_path`. It refuses a protected file (`deny`, with the reason and
  the next step), may ask the person about a file outside the scope
  (`outOfScope: "ask"`), and otherwise says nothing. It never says `allow`:
  that would skip the person's own permission prompt.
- **After the write, a warning.** PostToolUse tells the model, as additional
  context, that it wrote outside the scope: informing, never unlocking.
- **At commit, for any agent or none.** `spec-harness hook git` is a
  pre-commit hook over the staged files.
- **Paths are compared as the filesystem spells them**: links resolved and,
  on a case-insensitive filesystem, the real case, so `SRC/db/schema.ts` does
  not walk past a protection on `src/db/schema.ts`.
- **The gates are elsewhere**: `audit` measures the whole round from its base,
  and spec-brief's `archive` refuses a round that changed a protected file.

*Amended 2026-09-30.* The audit says what it measured beside what it found.
spec-core's ADR-0005 holds that nothing measured is not clean, and the audit
reported only what failed. spec-guard lists an assertion it cannot read
apart from its results, as one of its `errors`; the audit read only the
results, so a brief whose assertions could not be read ran none of them and
passed. And a report with no finding could not be told from one that checked
nothing. Each assertion spec-guard cannot read is now `assertion-unreadable`,
a warning on its line with spec-guard's reason, which fails the audit under
`--strict` as every warning does. Beside the counts the audit reports
`measured`: whether the round's changes were measured from a base, whether
the archive answered and the assertions ran, the goals that held and
failed, the premises retired and still holding, the assertions that could
not be read, the rulings verified and not, and the dependencies changed and
the manifests that could not be read. A person reads it as one line above
the counts, which stay the last line, and `audit_round` says it too. A brief
that declares no assertion says `goals: none declared` and draws no warning:
a brief without assertions is a brief, the archive still measures its
round, and a warning on every such brief would be a false positive. The
field is added beside `counts`, so no `schemaVersion` moves.

*Amended 2026-09-30.* spec-core's ADR-0005 offers SARIF and GitHub
annotations where findings have places, and GitLab Code Quality as each tool
next touches its reporter. `audit` and `premises` take `--format gitlab`,
`sarif` and `github`; every other command prints pretty or json, and
refuses the three with exit 2, since its output has no places. The shapes
are the siblings'. An error is `major` in GitLab, a warning `minor` and a
note `info`, as in spec-brief, and each format carries the hint after the
message. A finding's fingerprint is the SHA-256 of its identity - the rule,
the file and its `subject`, the assertion, ruling, dependency or name it is
about - with a count for repeats, and never of its message or line, as in
spec-guard: GitLab compares fingerprints between a merge request and its
target, and a reworded message or a line added above would read as one
problem fixed and another found. A finding with no file is placed on the
brief, and one with no line on line 1. `subject` is a field of each finding
in `--format json` as well, added, so no `schemaVersion` moves.

## Consequences

An agent that writes through a shell passes the guard and is caught at the
audit and at the archive. The guard's job is to make an honest agent never
need them, cheaply.
