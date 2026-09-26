// @ts-check
/**
 * The core sweep: the pure modules against the unit suite alone, in minutes.
 * The edges - cli, commands, round, setup, workspace, server, premises,
 * plugin, git, fs, siblings, sandbox - read the disk, git or a sibling, so
 * the unit suite cannot reach them; the full sweep measures them.
 *
 * `setup.ts` and `workspace.ts` are edges holding pure functions - the three
 * merges `init` applies and the option parser - so only those functions'
 * lines are mutated. tests/source.test.ts holds each range to the function it
 * names, so an edit that moves one fails a test rather than the sweep.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
import base from './stryker.config.mjs';

export const PURE_RANGES = {
  'src/setup.ts:54-67': 'mergeClaudeSettings',
  'src/setup.ts:70-74': 'mergeMcp',
  'src/setup.ts:77-81': 'mergeSpecGraph',
  'src/workspace.ts:74-136': 'parseOptions',
};

export default {
  ...base,
  vitest: { configFile: 'vitest.core.config.ts', related: false },
  mutate: [
    'src/audit.ts',
    'src/branch.ts',
    'src/briefs.ts',
    'src/config.ts',
    'src/context.ts',
    'src/guard.ts',
    'src/hooks.ts',
    'src/junit.ts',
    'src/manifests.ts',
    'src/probe.ts',
    'src/reader.ts',
    'src/rulings.ts',
    'src/versions.ts',
    ...Object.keys(PURE_RANGES),
  ],
  timeoutMS: 3000,
  // First measured 97.89% on 2026-09-26: 3200 of 3269 mutants killed or timed
  // out, and the 69 left equivalent - a bound one past the end of a string, a
  // cache that only saves a scan, a trim after a trim. The break sits below
  // that and moves only up (ADR-0010).
  thresholds: { high: 95, low: 90, break: 97 },
  htmlReporter: { fileName: 'reports/mutation-core/index.html' },
  jsonReporter: { fileName: 'reports/mutation-core/mutation.json' },
};
