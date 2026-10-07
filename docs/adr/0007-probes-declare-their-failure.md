---
status: accepted
date: 2026-09-26
---

# ADR-0007: Probes declare their failure

## Context

A model planning work will sometimes describe a defect that does not exist.
The planned `spec-probe` answered with a test that must fail before the brief
is filed, and proposed checking that it fails "for the reason in the defect
description" - comparing prose with prose.

## Decision

- A probe is a fenced `probe` block in the brief (`id`, `run`, and optionally
  `setup`, `junit`, `test`, `runs`, `timeout`), with the files it needs as
  `probe-file <path>` blocks. The evidence and the claim are one record, and
  a hash of every block is printed with the evidence, so a later edit to the
  probe shows.
- **How it fails is declared**: a `signature` the failing output must
  contain, or a `test` whose failure the JUnit report must show - with a
  message containing the signature when both are given. A probe with neither
  is refused: a red that may be a compile error proves nothing.
- It runs in a temporary worktree (ADR-0003) at the **base**, where every run
  must be red for the declared reason (`measured`), and at the **head**,
  where every run must be green (`fixed`). Runs that disagree are `flaky`;
  green at the base is `vacuous` - the defect is not there; any other outcome
  is `invalid`.
- JUnit XML is the one report format read, because nearly every runner
  writes it, natively or through a reporter.
- The command runs through the shell. It is a line of the repository's own
  brief, approved with it, as CI runs the repository's own scripts.

*Amended 2026-10-08.* What a probe's command finds installed was measured
with the released 0.10.0 on Windows under npm 11.16.0, with a made-up name
served from a registry on the loopback address. The worktree holds the files
the commit tracks and the probe's files: no `node_modules`, and none above it
in the temporary directory. The command has no terminal and `CI` set. There
`npx <name>` fetched the registry's package of that name and ran it, unasked,
wherever `setup` had not installed the name. With `--no-install` on the line,
or `yes=false` in an `.npmrc` the commit tracks, npm asked the registry about
the name and fetched nothing. `npm test -- <file>` asked the registry
nothing, and failed where `setup` had installed nothing. The README's example
ran its test through `npx` by the runner's name alone; it now runs the
project's own script, the `draft-brief` skill says the same of a probe an
agent writes, and `tests/npm.test.ts` holds every probe this repository shows
to a command that fetches nothing. The harness still runs a probe's line as
it is written.

## Consequences

A research round whose answer may be "no" is not a defect and needs no probe;
probes are for defect briefs. A fresh worktree has no installed dependencies
until `setup` installs them, which is slow and honest.
