import { defineConfig } from 'vitest/config';

/**
 * The unit suite: every test that reads no disk and spawns no process, which
 * is what the core mutation sweep holds the pure modules to. Under per-test
 * coverage an integration test that spawns git would run for every mutant it
 * reaches.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // Named, so that vitest adds none of its own. A suite that names none
    // gets vitest's github-actions reporter beside the default one on a
    // runner, and it appends a summary of each run to the step's: one a
    // mutant, which came to 1,093k over this sweep's 6,279 runs on main's
    // push of bd6a87c. GitHub uploads 1MiB of a step's summary, and the job
    // ended on an error annotation that the upload was aborted. The default
    // reporter writes to the worker's output, as it did, which Stryker shows
    // only for a worker that exits unexpectedly.
    reporters: ['default'],
  },
});
