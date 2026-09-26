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
