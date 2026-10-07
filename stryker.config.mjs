// @ts-check
/**
 * Mutation testing: the full sweep, edges included, against the whole suite.
 * It spawns git and the sibling tools for every mutant it reaches, so it runs
 * weekly and on request (.github/workflows/mutation.yml) rather than per
 * change; the core sweep gates changes. CI runs it in shards
 * (stryker.shard.config.mjs) and applies the break here to the merged report.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  // The whole suite but tests/source.test.ts, which reads the repository as it
  // is on disk, and the sandbox is not; vitest.mutation.config.ts says why.
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  coverageAnalysis: 'perTest',
  // The vendored spec-core copies are measured in spec-core (its ADR-0001).
  mutate: ['src/**/*.ts', '!src/vendor/**', '!src/index.ts', '!src/types.ts'],
  // A file that does not exist turns off Stryker's tsconfig rewrite, which
  // calls an API the native TypeScript 7 compiler does not have.
  tsconfigFile: 'tsconfig.stryker-noop.json',
  // Stryker writes "// @ts-nocheck" atop every file this matches, since a
  // mutant can be a type error. The harness's own modules need it. A vendored
  // file must not get it: it would lose the hash tests/vendor.test.ts holds it
  // to, and the full sweep's initial run would fail, as spec-brief's first
  // hosted one did. The glob is spec-graph's. The core sweep inherits it; its
  // unit suite has no vendor test, so the old glob never failed there.
  disableTypeChecks: 'src/{*.ts,!(vendor)/**/*.ts}',
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: { allowColor: false, maxTestsToLog: 0, reportScoreTable: true },
  timeoutMS: 20000,
  dryRunTimeoutMinutes: 30,
  // The full sweep of 16f3a8e read 97.56% over 7,877 mutants (ADR-0010);
  // losing its 91 timeout kills would leave 96.41%. The break sits under that
  // worst case and moves only up. The core sweep's gate is in its own file.
  thresholds: { high: 95, low: 90, break: 95 },
};
