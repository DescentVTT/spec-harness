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
still moves only up. The shards took from 5m54s to 24m47s. For 0.10.0 the sweep of
16f3a8e (run 37622048228) read 97.56% over 7,877 mutants, 96.41% with every
timeout lost, and the `break` stays 95. For 0.10.1 the sweep of b1c0f70 (run
37662090669) read 97.47% over 7,897 mutants, 96.48% with every timeout
lost, and the `break` stays 95. For 0.11.0 the sweep of a572d9d (run
37703230719) read 97.49% over 7,996 mutants, 96.54% with every timeout
lost, and the `break` stays 95. For 0.11.1 the sweep of a2a0596 (run
37791578721) read 97.47% over 8,024 mutants, 96.44% with every timeout
lost, and the `break` stays 95; three of its shards took from 31 to 36
minutes, where the table in `scripts/mutation-shards.mjs` was balanced for
14, so the table is to be measured again. For 0.12.0 the sweep of d8a7e8b
(run 37834817671), in the order and on the table of the 2026-10-09
amendment below, read 97.48% over 8,212 mutants, 96.43% with every timeout
lost, in shards of 13m34s to 16m57s, and the `break` stays 95.

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

**The split left the `break` at 89**; the sweep of c385f19, above, moved it
to 95.

*Amended 2026-10-07.* **Vitest stays on 4 until Stryker's runner reads 5.**
The Decision's "Vitest 4.1" was the family's choice of a line that had
aged; it is now a hold with a cause. On vitest 5,
`@stryker-mutator/vitest-runner` 10.0.0, the newest there is, runs no test
against a mutant a test covers and scores it as survived, with every test
green: vitest 5 matches a test's name with ` > ` between its suites, and the
runner asks for the tests of a mutant by names joined with a space
([stryker-js #6210](https://github.com/stryker-mutator/stryker-js/issues/6210),
open). The evidence is spec-guard's, which met this on 2026-09-07 and pinned
vitest then
([its ADR-0003](https://github.com/DescentVTT/spec-guard/blob/main/docs/adr/0003-mutation-testing.md)).
On 2026-10-06 Dependabot proposed vitest 5.0.0 (pull request 45), and the
core sweep measured it:

| Vitest | Run | Score | Mutants | Killed | Timed out | Survived | No coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4.1.11, main at 94203e3 | 37555884370 | 98.13% | 4,871 | 4,752 | 28 | 87 | 4 |
| 5.0.0, pull request 45 | 37528943599 | 3.83% | 4,862 | 186 | 0 | 4,672 | 4 |

spec-core's sweep of the same bump read 4.00%, where its main reads 96.36%.
The core sweep is the only one a pull request runs here, and it failed
with a score and no reason, on a pull request whose every test had passed.

So `.github/dependabot.yml` proposes no major of `vitest` or of an `@vitest`
package, and `tests/source.test.ts` fails when `package.json` admits a
vitest that is not a 4, with the issue and this amendment in its message: a
bump made by hand fails `npm test` with its reason. Minors and patches of 4
still come, and a security update is not held back.

The hold is the family's and is lifted in spec-core first, by the steps in
[its ADR-0008](https://github.com/DescentVTT/spec-core/blob/main/docs/adr/0008-toolchain.md)
(amended 2026-10-07), which also records what vitest 4 still receives while
it is held. When the bump comes here, its pull request's core sweep
measures it; dispatch `mutation.yml` on the branch as well, for the modules
the core sweep leaves out, and hold both to that ADR's two conditions
before merging.

*Amended 2026-10-08.* **A run of the suite works in a temporary directory of
its own.** On 2026-10-07 one workstation's temporary directory held 998
directories of the suite's making: 874 `spec-harness-test-*`, the
repositories its tests make, and 124 `spec-harness-*`, worktrees of the
sandbox, of which every one that still said whose it was, 104, was a test
repository's. Measured there, each with a temporary directory given to the
run and empty at the start:

| Run, on main at 10f0e8b | Left behind |
| --- | --- |
| 18 of the 19 integration files, every test passing | nothing |
| `sandbox.test.ts` with 17 of its tests timing out | 4 worktrees of the sandbox |
| four files, the run ended after 45 seconds as an agent's is | 86 directories of the tests |

So a run that ends leaves nothing unless a sandbox test fails while its
worktree is in use, and a run that is ended leaves all it had made.
`vitest.config.ts` now has every run start in `tests/temporary.ts`, which
makes one directory with the suite's prefix in the system's temporary
directory and names it, in `TMPDIR`, `TMP` and `TEMP`, as the temporary
directory to everything the run starts: the tests, the sandbox under test,
and git and node under those. The run removes it when it ends, with whatever
a failed test left in it: the timed-out run above then leaves nothing, and
the ended one leaves one directory. Before it makes its own, a run removes
the directories earlier runs left: those with the suite's prefix, directly
in the system's temporary directory, that nothing was added to or taken from
for a day. No run lasts a day; a watch left idle for one loses its directory
to the next run and is started again. A link is never followed, and the
sandbox's own prefix is never removed, since a person's `probe` makes
directories with it on the same machine.

One directory for the whole run was chosen over each file clearing up after
the others because only it holds what a test did not make itself: a worktree
the sandbox made carries the sandbox's prefix, which the suite may not
remove from the system's temporary directory. The mutation sweeps run
without it, as before, on a runner that is thrown away, and
`tests/mutation-shards.test.ts` still holds their configuration to this
one's files and timeouts.

*Amended 2026-10-09.* **The shards measured again: a static mutant costs the
test files that run before its killer.** Three shards of 0.11.1's sweep took
31 to 36 minutes on a table balanced for 14. The logs and reports of the
nine sharded sweeps were read again, shard by shard, with
`scripts/mutation-timeline.mjs`. The minutes are the eight shards' added up,
and a static mutant is killed late when a test file other than its killer's
had run to its end first:

| Run | Source | Tests | Initial run, a shard | Mutants not static | Static mutants | Killed late | Survived | Timed out | Slowest shard |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 36709265748 | 82d1817 | 759 | 60 to 62 s | 41 min | 78 min | 158 of 1,139 | 73 | 15 | 21m53s |
| 36711848267 | 82d1817 | 759 | 46 to 62 s | 37 min | 72 min | 150 | 73 | 15 | 18m21s |
| 36714214575 | 82d1817 | 759 | 50 to 65 s | 40 min | 76 min | 165 | 73 | 15 | 18m21s |
| 36743578103 | c385f19 | 829 | 57 to 77 s | 38 min | 66 min | 151 of 1,141 | 30 | 16 | 24m47s |
| 37307780901 | c385f19 | 829 | 55 to 76 s | 36 min | 73 min | 159 | 30 | 16 | 23m56s |
| 37622048228 | 16f3a8e | 984 | 66 to 88 s | 40 min | 89 min | 162 of 1,179 | 23 | 26 | 26m49s |
| 37662090669 | b1c0f70 | 1,073 | 90 to 114 s | 38 min | 93 min | 179 | 30 | 16 | 25m06s |
| 37703230719 | a572d9d | 1,114 | 97 to 119 s | 43 min | 103 min | 168 of 1,182 | 28 | 16 | 32m37s |
| 37791578721 | a2a0596 | 1,128 | 105 to 141 s | 49 min | 134 min | 181 of 1,183 | 28 | 13 | 36m29s |

The first three ran 82d1817's code on the branch that brought the shards,
and 37307780901 ran c385f19's on the commit that released it. The mutants
that are not static took what they took when the table was made. The static
ones came to take nearly twice as long, with 44 more of them. The table's
own premises had gone as well: `server.ts`, given a shard for its 13
minutes, has taken 2.4 to 3.2 since its 15 static survivors were killed, and
the last shard, put at 12 to 14 minutes, took 25 in the sweep of c385f19.

**Where a static mutant's minutes go.** Stryker's vitest runner runs a
mutant's test files one after another in one worker and stops at the first
test that fails; a static mutant's files are all of them. Vitest runs first
the file that failed in the worker's last run, then the longest. So a static
mutant killed by the file that killed the one before it costs a second or
two, and any other runs `tests/integration/sandbox.test.ts` first, then the
audit, probe and rulings tests, until it reaches its killer: a mutant only a
unit test kills waits for nearly the whole suite. The reports say how many
tests each mutant had completed when it was decided, and those killed late,
about one in seven, had completed 206 to 296 of them on average. Fitted to
each file's static minutes in the four sweeps from 16f3a8e to a2a0596 (108
readings, R-squared 0.88), a mutant killed late cost 0.7 of an initial run, a
survivor 1.6 and a timeout 2.4, in worker-seconds with four workers busy,
and one killed in the first file under 3 seconds: the mutants killed late
took 53% of the static minutes, the survivors 19%, the timeouts 17%, and the
four in five killed at once 10%. Which mutants are killed late is an
accident of which worker ran which mutant last: `workspace.ts`, unchanged,
had 8 of them in one sweep and 20 in the next, and took 3.8 and 13.6
minutes.

**What the suite costs.** An initial run is the suite, once, and it doubled.
CI's test step on Ubuntu spent 76 seconds in tests at 82d1817, 96 at
16f3a8e, 102 at b1c0f70, 107 at a572d9d and 124 at a2a0596. Of the 48 it
grew by, 35 are `tests/integration/sandbox.test.ts`, from 10.8 seconds and
26 tests to 45.6 and 46, and 7 are `tests/integration/probe.test.ts`. At
a2a0596 eleven tests took three seconds or more, 43 seconds between them,
and ten were in `sandbox.test.ts`: eight took the three seconds of the
sandbox's bound, and two ran the built command line through a timeout and
the bound, 14.6 seconds that no mutant is covered by.

**No test leaves the run; its files run the quickest first.**
`vitest.mutation.config.ts` gives the sweep an order of its own: the file
that failed in the worker's last run first, as vitest has it, then the
quickest, and a file the worker has not run yet after those it has, the
smaller first. A mutant survives when every file has passed, in any order,
so the sweep proves what it proved. The sweep of effd817 (run 37810898544)
is 0.11.1's source and table with the order alone changed:

| Shard, by the table of 2026-10-01 | Vitest's order, run 37791578721 | The quickest first, run 37810898544 |
| --- | ---: | ---: |
| `server.ts`, `guard.ts` | 5m19s | 4m02s |
| `round.ts`, `host.ts`, `premises.ts` | 19m30s | 17m29s |
| `siblings.ts`, `reader.ts`, `context.ts` | 26m44s | 19m17s |
| `git.ts`, `sandbox.ts` | 27m01s | 23m28s |
| `branch.ts`, `rulings.ts`, `hooks.ts` | 31m22s | 16m56s |
| `commands.ts`, `workspace.ts` | 23m47s | 10m01s |
| `signers.ts`, `config.ts`, `cli.ts`, `probe.ts`, `briefs.ts` | 34m34s | 11m46s |
| the rest | 36m29s | 13m10s |
| Static mutants, the eight shards | 134 min | 57 min |
| Mutants not static | 49 min | 38 min |
| Static mutants killed late | 181 | 135 |
| Score | 97.47% over 8,024 | 97.47% over 8,024 |
| Killed, timed out, survived, no coverage | 7,738, 83, 172, 31 | 7,739, 82, 172, 31 |

The survivors are the same 172. Twenty-one mutants moved between killed and
timed out, ten one way and eleven the other, where two sweeps of the same
code in vitest's order differed in four verdicts and in six; with every
timeout lost the sweep would read 96.45%. By the same fit on the two sweeps
of that source in the new order, a mutant killed late costs 0.3 of an
initial run, and survivors and timeouts, which run the whole suite in any
order, take 57% of the static minutes that are left.

The tests that wait out a bound stay in the run. They share a file with the
tests that cover `sandbox.ts`, so the configuration could leave them out
only by their names; and in each of the two sweeps before the order changed
the tests of three seconds or more were the recorded killer of three
mutants, all in `sandbox.ts`, and the only cover of one. With the quickest
first they run last, and a static mutant pays for them when it survives,
when it times out, or when nothing else kills it. What they still cost is
their 43 seconds in every shard's initial run and in every static survivor
and timeout, 28 and 17 a sweep: by the fit, about 16 of the 116 minutes the
eight jobs took. Making them cheaper is a change to the tests, a bound they
need not wait out or a file of their own, and not to the sweep.

**The table.** Two sweeps of a475910's source ran the quickest first: effd817
on the table of 2026-10-01, above, and d340a82 on a first table made from
its minutes (run 37818344640, 97.48% over 8,024). The files took 95 minutes
between them both times. That first table had `config.ts` with `branch.ts`
and `reader.ts`, and its shards took 12m12s to 18m05s where it had them at
14 to 15: the shard of `branch.ts`, fifteen static survivors in it, took
15.2 minutes for its files where the others took 9.7 to 12.7. The timeline
had charged `branch.ts` too little. It reads a file's minutes off the count
of mutants tested, and the count runs on into the next file while a worker
is still on a survivor, so a file is charged for the survivors of the file
before it in its shard: `config.ts` took 0.8 minutes after `cli.ts` and 3.4
after `branch.ts`. A shard's own minutes are the measure, and the table
moved `config.ts`, `hooks.ts` and `guard.ts` on that sweep's. The sweep of
226dfe8 (run 37821498621) is that table on 08b8ab4, which changes
`sandbox.ts` and `commands.ts` and has 28 more mutants and 8 more tests:

| Shard | Its files' minutes in runs 37810898544 and 37818344640 | In run 37821498621 | Its job |
| --- | ---: | ---: | ---: |
| `round.ts` | 12.4, 11.4 | 11.9 | 15m11s |
| `siblings.ts` | 12.0, 12.0 | 11.0 | 13m36s |
| `sandbox.ts` | 11.3, 12.7 | 13.0 | 15m21s |
| `git.ts`, `premises.ts`, `host.ts`, `briefs.ts`, `hooks.ts`, `guard.ts` | 12.6, 11.1 | 10.4 | 12m46s |
| `branch.ts`, `reader.ts` | 11.3, 11.7 | 13.3 | 16m05s |
| `rulings.ts`, `commands.ts` | 11.2, 11.0 | 9.3 | 12m10s |
| `cli.ts`, `signers.ts`, `workspace.ts`, `server.ts`, `probe.ts`, `config.ts` | 12.9, 13.2 | 11.2 | 14m01s |
| the rest | 11.3, 12.1 | 12.8 | 16m48s |

It read **97.48% over 8,052 mutants**: 7,760 killed, 89 by timeout, 172
survived and 31 without coverage, 96.37% with every timeout lost, and the
`break` stays 95. In the files 08b8ab4 leaves alone, four verdicts differ
from the sweep before. The files took 93 minutes and the eight jobs 116,
where 0.11.1's took 183 and 205, and the sweep had its merged score 17
minutes after it was dispatched, where 0.11.1's had it after 38. A job takes
two to four minutes more than its files: its setup, and its initial run of
the suite, 107 to 131 seconds in that sweep. The shard of `rulings.ts` and
`commands.ts` has room, and the last shard is where the next file to move
is.

Between sweeps of the same code, in vitest's order and on one table
(c385f19, runs 36743578103 and 37307780901), a shard moved by up to 6m05s
and a file by up to 3.4 minutes, and the files took 104 and 109 minutes in
all. No two sweeps in the new order had the same code and table. The shards
of `round.ts` and `siblings.ts` and the last, whose files 08b8ab4 leaves
alone, took 14m50s, 14m44s and 14m55s in the sweep of a475910's source and
15m11s, 13m36s and 16m48s in that of 08b8ab4's. The runners differ by as
much: the initial run took 108 to 133 seconds across the eight shards of one
sweep.

`tests/mutation-shards.test.ts` holds the order: the failed file first, the
quickest after it, a file never run after those, the keys vitest's own
sequencer reads, and `npm test` left with vitest's order.
`scripts/mutation-timeline.mjs` prints the three counts above beside each
file's minutes, so the next measurement reads them off a report. A shard
that keeps passing 22 minutes, half as long again as the table has it, is
the sign to measure again; so is a suite that has grown, since every static
mutant that survives runs all of it.
