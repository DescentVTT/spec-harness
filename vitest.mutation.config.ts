import { relative } from 'node:path';

import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * The order a mutant's test files run in: a file that failed in the worker's
 * last run first, as vitest has it, then the quickest first, where vitest
 * runs the longest first.
 *
 * Stryker runs a mutant's files one after another in one worker and stops at
 * the first test that fails. A static mutant runs every file, so what it
 * costs is the files that run before the one that kills it. Vitest's order
 * suits a run that reports every failure and wants the long files started
 * early; here it puts `tests/integration/sandbox.test.ts`, 46 seconds, most
 * of them spent waiting out bounds, ahead of the unit file that kills the
 * mutant in milliseconds. In the four full sweeps before this order one
 * static mutant in seven was killed only after other files had run, 280
 * tests of them on average (ADR-0010, amended 2026-10-09).
 *
 * No test leaves the run and none is added: a mutant survives when every
 * file has passed, in any order.
 *
 * A file the worker has not run yet has no time to go by. It runs after
 * those that have, the smaller first, and has a time from then on.
 */
export class QuickestFirst extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { cache, config } = this.ctx;
    const rank = (file: TestSpecification): [number, number] => {
      // The key vitest's own sequencer reads its cache by; a test holds the two together.
      const key = `${file.project.name}:${relative(config.root, file.moduleId).replaceAll('\\', '/')}`;
      const last = cache.getFileTestResults(key);
      if (last === undefined) return [2, cache.getFileStats(key)?.size ?? 0];
      return [last.failed ? 0 : 1, last.duration];
    };
    const ranked = files.map((file) => ({ file, rank: rank(file) }));
    return ranked.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]).map(({ file }) => file);
  }
}

/**
 * The full mutation sweep's suite: every test but two, run in Stryker's
 * sandbox, a copy of the repository under `.stryker-tmp/`.
 *
 * `tests/source.test.ts` reads the repository as it is on disk, which the
 * sandbox is not: its sources are Stryker's instrumented copies, whose lines
 * are not the ones the core sweep's ranges name, and git lists no file under
 * a directory `.gitignore` leaves out. A test that fails in the initial run
 * stops the sweep before its first mutant. CI runs the file on every change,
 * and what it asks of the code, the unit suite asks as well.
 *
 * `tests/mutation-shards.test.ts` tests the script that splits the sweep and
 * merges it back, and the order above. It reaches nothing under `src/`, so it
 * cannot kill a mutant, and every static mutant would run it.
 *
 * The rest is `vitest.config.ts`'s, for the same processes, less its v8
 * coverage, which Stryker replaces with its own per test, and with the order
 * above; a test holds the two files together.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/source.test.ts', 'tests/mutation-shards.test.ts', '**/node_modules/**'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    sequence: { sequencer: QuickestFirst },
  },
});
