---
name: draft-brief
description: Draft the brief for one round of work - the contract an agent works under - from a request, with its scope, its protections and, for a defect, a probe that proves the defect exists. Use when asked to plan, specify or write up a change before implementing it, or when a request is too loose to start on.
---

# Draft a brief

A brief is the contract for one round: what done looks like, what the round
must not do, which files it may write and which it may not touch. You write
it; `spec-brief` checks it; a person approves it before anyone starts. Never
start implementing from a brief the person has not approved.

## Before any command

Run every command below as written, from the repository's root. Each gives
`npx` the package's full name behind `--no-install`, so it runs the tool this
project installed and fetches nothing.

If one stops with `npx canceled due to missing packages`, the project's
dependencies are not installed in this work tree - a fresh clone, a new
worktree - or you are not at its root. Install them there, as with `npm ci`,
and run the command again; if that fails, stop and tell the person.

Never work around it by dropping `--no-install` or the `@descent-vtt/` in
front of the name. Without the scope the names are not these tools: on npm
`spec-harness` is another publisher's package, and `npx` would fetch it and
run it.

## 1. Scaffold from the repository's own rules

```bash
npx --no-install @descent-vtt/spec-brief new "<short title>" --type <feature|defect|refactor|chore> --wave <n>
```

The scaffold holds every section this repository requires, each with a hint
in a comment saying what it must answer. Those hints are your interview:
ask the person what you cannot find out yourself, one section at a time.
Press hardest on the two that keep a round from wandering:

- **What the round does not do.** Name the tempting adjacent work and rule it
  out.
- **What it is not empowered to change.** Public interfaces, schemas, other
  teams' code, the rules files themselves.

## 2. Measure the scope, do not guess it

- Find the files the change touches: search the code, read `git log` for
  files that change together, and, where the project's `package.json` lists
  `@descent-vtt/spec-guard`, ask it which rules govern them:
  `npx --no-install @descent-vtt/spec-guard query <path> --json`. A project
  that does not list it has no such rules to ask about.
- Write `affectedFiles` as narrow globs (`src/auth/**`, not `src/**`). A scope
  too wide makes rounds that could run in parallel wait for each other; one
  too narrow stops you mid-round. A new directory ends with `/`.
- Write `protectedFiles` for what lies inside or beside the scope and must not
  change.

## 3. A defect is measured before it is filed

For a `defect` brief, write a probe: a test that fails now, for the reason
the brief states, declared in the brief as a `probe` block (with the test in
a `probe-file` block if it is new). Give it a `signature` - text the failure
must contain - or a JUnit `test` name, so a compile error is never taken for
the defect.

The probe runs in a fresh worktree, where nothing is installed until its
`setup` line installs it, as `setup: npm ci` does. Make `run` one of the
project's own scripts, such as `npm test -- <file>`, and never `npx` with a
tool's name alone: where the tool is not installed, npm fetches whatever the
registry has under that name and runs it. Then:

```bash
npx --no-install @descent-vtt/spec-harness probe <id> --at base
```

`measured` means the defect is real; paste the evidence table into the
brief. `vacuous` means it is not there: say so to the person and stop.
`invalid` or `flaky` means the probe proves nothing yet: read the end of its
command's output, printed after the table, and fix the probe.

## 4. Check, then hand over

```bash
npx --no-install @descent-vtt/spec-brief lint <id> --format json    # until it reports nothing
npx --no-install @descent-vtt/spec-brief matrix                     # no collision with its wave
```

Show the person the brief, the scope and the protections, and wait for their
approval. The approval is theirs to give; a clean lint is not one.
