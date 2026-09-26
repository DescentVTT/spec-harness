// @ts-check
/**
 * Mutation testing: the full sweep, edges included, against the whole suite.
 * It spawns git and the sibling tools for every mutant it reaches, so it runs
 * weekly rather than per change; the core sweep gates changes.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts', related: false },
  coverageAnalysis: 'perTest',
  // The vendored spec-core copies are measured in spec-core (its ADR-0001).
  mutate: ['src/**/*.ts', '!src/vendor/**', '!src/index.ts', '!src/types.ts'],
  // A file that does not exist turns off Stryker's tsconfig rewrite, which
  // calls an API the native TypeScript 7 compiler does not have.
  tsconfigFile: 'tsconfig.stryker-noop.json',
  disableTypeChecks: 'src/**/*.ts',
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: { allowColor: false, maxTestsToLog: 0, reportScoreTable: true },
  timeoutMS: 20000,
  dryRunTimeoutMinutes: 30,
  thresholds: { high: 95, low: 90, break: null },
};
