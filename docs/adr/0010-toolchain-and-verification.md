---
status: accepted
date: 2026-09-26
---

# ADR-0010: Toolchain and verification

## Decision

The family's toolchain (spec-core ADR-0008): Node >= 22, TypeScript 7,
Vitest 4.1, Stryker 10, zero runtime dependencies, native ESM, the strictest
compiler options. spec-core modules are vendored under
`src/vendor/spec-core/` and verified by hash (`tests/vendor.test.ts`); they
are excluded from this repository's coverage and mutation sweeps.

Two suites, as in spec-brief (its ADR-0009): the unit suite (`tests/unit/`)
reads no disk and spawns nothing, and the core mutation sweep holds the pure
modules to it; the integration suite drives git, the sandbox and real sibling
tools in temporary repositories. The mutation `break` is set below the first
full measurement and moves only up.

*Amended 2026-09-27.* The full sweep, `stryker.config.mjs`, has a job of its
own. `.github/workflows/mutation.yml` runs it weekly and on request (Actions,
Mutation, Run workflow, with `full` ticked), builds `dist/` first for the
integration tests that spawn the command line, and uploads its report; the
core sweep stays a job in `ci.yml`, on every change. The full sweep runs the
whole suite but `tests/source.test.ts`, which reads the repository as it is
on disk and Stryker's sandbox is not, and writes `// @ts-nocheck` into the
harness's own modules alone: a vendored file given it no longer has the hash
`tests/vendor.test.ts` holds it to, and spec-brief's first hosted full sweep
stopped at its initial test run on exactly that. Its `break` stays `null`
until a hosted run has been measured, then sits below that measurement and
moves only up.
