import { defineConfig } from 'vitest/config';

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
 * merges it back. It reaches nothing under `src/`, so it cannot kill a mutant,
 * and every static mutant would run it.
 *
 * The rest is `vitest.config.ts`'s, for the same processes, less its v8
 * coverage, which Stryker replaces with its own per test; a test holds the two
 * files together.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/source.test.ts', 'tests/mutation-shards.test.ts', '**/node_modules/**'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
