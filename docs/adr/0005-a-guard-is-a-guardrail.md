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

## Consequences

An agent that writes through a shell passes the guard and is caught at the
audit and at the archive. The guard's job is to make an honest agent never
need them, cheaply.
