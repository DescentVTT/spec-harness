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

The first hosted full sweep, on 3b04262 (run 36316697866), measured **90.74%
over 6,466 mutants** in 69 minutes: 5,809 killed, 58 timed out, 483 survived,
116 without coverage. Losing every timeout kill would leave 89.84%, so the
full sweep's `break` is 89. It sits below the core sweep's 97 because it also
mutates the modules the core sweep leaves out, and the lowest scores are
theirs: `sandbox.ts` 33.33, 43 of its mutants reached by no test on Linux,
`plugin.ts` 62.22, `server.ts` 70.65, `git.ts` 77.63 and `round.ts` 79.95.
Those, the 116 mutants no test reaches and the 483 survivors are where the
number moves up from.

*Amended 2026-10-01.* `mutation.yml` runs the full sweep in eight shards,
each mutating its own files against every test, and a job after them merges
the reports and applies the `break` once, to the merged score; a shard is
not a score. It is still the sweep a single run would make: every test but
`tests/source.test.ts` and the merge's own, in every shard, with the same
`timeoutMS` and `break`, and `npm run test:mutation:full` still runs it in
one process. The merge, `scripts/mutation-shards.mjs`, is spec-core's (its
ADR-0007), with its tests: it refuses a missing shard, a shard reported
twice, a file mutated by two shards or by one it does not belong to, a
listed file its shard did not report, a shard that ran with other patterns,
and shards that ran different tests, matching tests by file and name. An
unset or unknown shard is an error when the shard configuration loads, never
a run over everything, and a file no shard lists is mutated by the last.

*Amended again 2026-10-01.* After the survivors of the full sweep were
worked through, main's sharded sweep of c385f19 (run 36743578103) measured
**97.42% over 7,717 mutants**: 7,438 killed, 80 by timeout, 168 survived and
31 without coverage. Losing every timeout kill would leave 96.38%, so the full
sweep's `break` rises from 89 to 95, under that worst case as before, and
still moves only up. The shards took from 5m54s to 24m47s.

One runner took 69 to 130 minutes for the full sweep. Before any sharded
sweep ran, the report of eb39599 was cut into shards the way Stryker writes
them and put back by the merge: all 7,507 verdicts came back with their
tests, and its 91.18%.

**Where the minutes went.** spec-core's shards were quicker than its single
run because a shard instruments only its own files, and its suite spent most
of its time in instrumented code. This suite spends it in git and the
sibling tools: it ran in 61 seconds in every shard, as in the single run, so
a file took the same minutes in a shard as in the single run, and a shard's
minutes are its files' added up (`scripts/mutation-timeline.mjs` reads them
off a log). `server.ts` takes 13 to 14 minutes on its own, most of them
static mutants, each of which runs the whole suite, so no shard finishes
sooner; eight shards come within a few minutes of it, and more would wait on
it. The table is balanced on the mean of the first two sharded sweeps, at
13.7 to 14.5 minutes a shard; the same shard moved by up to four minutes
between runners.

| Run | Layout | Score | Mutants | Killed | Timed out | Survived | No coverage | Took |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| 36708096066 | one job | 92.94% | 7,665 | 7,041 | 83 | 455 | 86 | 2h10m |
| 36709265748 | eb39599's minutes | 92.95% | 7,665 | 7,045 | 80 | 454 | 86 | 22m10s |
| 36711848267 | the first sharded sweep's | 92.95% | 7,665 | 7,047 | 78 | 454 | 86 | 19m52s |
| 36714214575 | the mean of the two | 92.95% | 7,665 | 7,046 | 79 | 454 | 86 | see below |

All four are of 82d1817's code and tests, the sharded ones dispatched on the
branch that brought the shards and timed from the first shard starting to
the merged score. Mutant by mutant the sharded sweeps differ from the single
run only by three to five mutants that timed out there and were killed in a
shard, and one survivor killed in each, as a faster runner differs from a
slower one. In the third, one shard's runner lost contact with GitHub after
49 minutes, and the merge refused the sweep, as it should; re-running that
job alone took 16 minutes, and the merge scored the sweep from its report
and the other seven shards' of the first attempt, whose slowest had ended
18 minutes after the start.

The core sweep in `ci.yml` stays one job. It takes 6 to 8 minutes, the
longest of CI's jobs, of which a minute and a half is the start every
shard would pay again; split, it would add jobs to every change to save a
few minutes.

**The `break` stays 89.**
