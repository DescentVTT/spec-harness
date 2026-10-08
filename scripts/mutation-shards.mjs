/**
 * The full mutation sweep, split across parallel CI jobs and put back together
 * as one report with one score.
 *
 * The full sweep mutates every module against the whole suite, git and the
 * sibling tools included, and one runner took 69 to 130 minutes for it
 * (ADR-0010). The amendment of 2026-10-01 to ADR-0010 has the measurements
 * behind the split, and that of 2026-10-09 those behind the table below. The
 * core sweep, in ci.yml, is not split.
 *
 * Each shard runs Stryker with stryker.shard.config.mjs, which takes `mutate`
 * from mutateFor() and switches the break threshold off, because a shard is not
 * a score. The merge refuses anything that is not exactly one sweep: a missing
 * shard, a file mutated twice or by the wrong shard, a shard that ran with other
 * patterns, shards that ran different tests. It then scores the merged report
 * with the library Stryker's own gate uses, and compares it the way that gate
 * does.
 *
 * Adapted from spec-core (its ADR-0007), which took it from
 * @descent-vtt/spec-graph (its ADR-0019) and @descent-vtt/spec-guard (its
 * ADR-0003); the same merge scores all their sweeps. The full sweep has no
 * incremental file to split between the shards.
 *
 *   node scripts/mutation-shards.mjs merge <directory holding the shard reports>
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Stryker's own dependencies, not direct ones of this package, and deliberately
// so: the merged score must be computed by the same code as the gate it
// replaces, and `mutate` read by the same matcher Stryker reads it with. A
// separately pinned copy of either could drift from the one Stryker runs.
import { minimatch } from 'minimatch';
import { calculateMutationTestMetrics } from 'mutation-testing-metrics';

// Minutes each file took in the full sweep of effd817 (run 37810898544), read
// off the shards' logs with scripts/mutation-timeline.mjs:
//
//   round 12.4   siblings 12.0   sandbox 11.3   git 9.3   branch 7.5
//   rulings 6.2   commands 5.0   reader 3.8   cli 3.5   signers 3.1
//   workspace 2.7   setup 2.3   versions 2.2   fs 1.5   server 1.5
//   premises 1.4   manifests 1.3   probe 1.3   configure 1.2   config 0.8
//   context 0.8   host 0.8   audit 0.7   junit 0.7   hooks 0.5   briefs 0.4
//   formats 0.3   answers 0.2   guard 0.2   plugin 0.1
//
// 95 minutes in all. That sweep was the first to run a mutant's quickest test
// files first (vitest.mutation.config.ts). The sweep before it, of the same
// source in vitest's own order (run 37791578721), took 183, on a table
// balanced a week earlier on 110 to 119: ADR-0010, amended 2026-10-09, has
// where the minutes had gone.
//
// Stryker instruments only a shard's own files, but here that saves nothing:
// the suite spends its time in git and the sibling tools rather than in the
// harness's own code. So a file's minutes add up wherever it goes, and a
// shard is balanced by adding them; a job takes two to three minutes more,
// its initial run of the suite. Three in five of the minutes are static
// mutants, each of which runs every test file until a test fails, and the
// whole suite when none does or one hangs. So a file's minutes follow the
// suite's seconds and the file's own static survivors and timeouts: ten
// survivors in branch.ts, and in siblings.ts ten timeouts in that sweep
// where the one before had six.
//
// A file cannot be split, so no shard takes less time than round.ts, and
// eight shards come level with it; a ninth would wait on it. sandbox.ts has a
// shard to itself because it has grown in each of the last four sweeps. The
// last shard mutates everything else the base configuration mutates, so a
// file added later is still mutated without anyone remembering to list it
// here; it holds the small files, and has room for one more. A file listed
// here must have mutants: the merge refuses a listed file its shard did not
// report, and document.ts, which holds only types, has none, so it stays in
// the last shard. When a shard passes the others by more than the sweeps
// differ - the same shard moved by up to six minutes between two sweeps of
// the same code and table in vitest's order - re-measure and move files or
// add a shard, and add it to the workflow's matrix, which a test checks.
// Minutes in eight shards, by that sweep's files:
export const ASSIGNED = [
  ['src/round.ts'], // 12.4
  ['src/siblings.ts'], // 12.0
  ['src/sandbox.ts'], // 11.3
  ['src/git.ts', 'src/premises.ts', 'src/host.ts', 'src/briefs.ts'], // 11.9
  ['src/branch.ts', 'src/reader.ts', 'src/config.ts'], // 12.1
  ['src/rulings.ts', 'src/commands.ts', 'src/hooks.ts', 'src/guard.ts'], // 11.9
  ['src/cli.ts', 'src/signers.ts', 'src/workspace.ts', 'src/server.ts', 'src/probe.ts'], // 12.1
]; // and the rest: 11.3

export const SHARD_COUNT = ASSIGNED.length + 1;

export class ShardError extends Error {
  name = 'ShardError';
}

// Stryker's reading of `mutate`: patterns in order, a `!` pattern taking back
// what an earlier one matched.
function mutates(patterns, file) {
  let included = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (minimatch(file, pattern.slice(1))) included = false;
    } else if (minimatch(file, pattern)) {
      included = true;
    }
  }
  return included;
}

export function checkAssignment(base, assigned = ASSIGNED) {
  const owners = new Map();
  assigned.forEach((files, index) => {
    const shard = index + 1;
    for (const file of files) {
      if (owners.has(file)) {
        throw new ShardError(`${file} is assigned to shards ${owners.get(file)} and ${shard}.`);
      }
      if (!mutates(base, file)) {
        throw new ShardError(
          `${file} is assigned to shard ${shard}, but the configuration does not mutate it (${base.join(', ')}).`,
        );
      }
      owners.set(file, shard);
    }
  });
  return owners;
}

function shardNumber(value, count) {
  const text = String(value);
  const shard = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!(shard >= 1 && shard <= count)) {
    throw new ShardError(`A shard is a number from 1 to ${count}, got "${text}".`);
  }
  return shard;
}

export function mutateFor(base, shard, assigned = ASSIGNED) {
  const number = shardNumber(shard, assigned.length + 1);
  checkAssignment(base, assigned);
  return number <= assigned.length
    ? [...assigned[number - 1]]
    : [...base, ...assigned.flat().map((file) => `!${file}`)];
}

// A test is its file and its name; ids are numbered afresh in every run.
const testKey = (file, name) => JSON.stringify([file, name]);

function testsOf(shard, report) {
  const tests = new Map();
  for (const [file, entry] of Object.entries(report.testFiles ?? {})) {
    for (const test of entry.tests) {
      const key = testKey(file, test.name);
      if (tests.has(key)) {
        throw new ShardError(`Shard ${shard} has two tests named "${test.name}" in ${file}, so its tests cannot be matched by name.`);
      }
      tests.set(key, test);
    }
  }
  return tests;
}

const describeTest = (key) => {
  const [file, name] = JSON.parse(key);
  return `"${name}" in ${file}`;
};

export function mergeReports(shards, { base, thresholds, assigned = ASSIGNED }) {
  const count = assigned.length + 1;
  const reports = new Map();
  for (const { shard, report } of shards) {
    if (!(Number.isInteger(shard) && shard >= 1 && shard <= count)) {
      throw new ShardError(`There are ${count} shards, but a report came from shard ${shard}.`);
    }
    if (reports.has(shard)) throw new ShardError(`Shard ${shard} reported twice.`);
    reports.set(shard, report);
  }
  const numbers = Array.from({ length: count }, (_, index) => index + 1);
  const missing = numbers.filter((shard) => !reports.has(shard));
  if (missing.length > 0) {
    throw new ShardError(
      `No report from shard ${missing.join(' or ')} of ${count}: the sweep is incomplete, and an incomplete sweep has no score.`,
    );
  }

  const owners = checkAssignment(base, assigned);
  const mutatedBy = new Map();
  for (const shard of numbers) {
    const report = reports.get(shard);
    const expected = mutateFor(base, shard, assigned);
    if (JSON.stringify(report.config?.mutate) !== JSON.stringify(expected)) {
      throw new ShardError(
        `Shard ${shard} ran with mutate ${JSON.stringify(report.config?.mutate)}, not ${JSON.stringify(expected)}.`,
      );
    }
    for (const file of Object.keys(report.files)) {
      if (mutatedBy.has(file)) {
        throw new ShardError(`${file} was mutated by shards ${mutatedBy.get(file)} and ${shard}.`);
      }
      mutatedBy.set(file, shard);
      const owner = owners.get(file) ?? count;
      if (owner !== shard) throw new ShardError(`${file} belongs to shard ${owner}, but shard ${shard} reported it.`);
    }
  }
  for (const [file, shard] of owners) {
    if (mutatedBy.get(file) !== shard) {
      throw new ShardError(
        `${file} is assigned to shard ${shard}, which reported no mutants in it. If it was renamed or removed, update ASSIGNED in scripts/mutation-shards.mjs.`,
      );
    }
  }

  // Stryker numbers tests afresh in every run, so an id means nothing outside
  // its own report. A test is its file and its name, and every shard must have
  // run the same ones, or the merge would be several sweeps rather than one.
  const reference = testsOf(1, reports.get(1));
  for (const shard of numbers.slice(1)) {
    const tests = testsOf(shard, reports.get(shard));
    const onlyFirst = [...reference.keys()].filter((key) => !tests.has(key));
    const onlyThis = [...tests.keys()].filter((key) => !reference.has(key));
    if (onlyFirst.length > 0 || onlyThis.length > 0) {
      throw new ShardError(
        `Shards 1 and ${shard} ran different tests: ${onlyFirst.length} only in shard 1, ${onlyThis.length} only in shard ${shard}, such as ${describeTest(onlyFirst[0] ?? onlyThis[0])}.`,
      );
    }
  }

  const ids = new Map();
  const testFiles = {};
  for (const [file, entry] of Object.entries(reports.get(1).testFiles ?? {})) {
    testFiles[file] = {
      ...entry,
      tests: entry.tests.map((test) => {
        const id = String(ids.size);
        ids.set(testKey(file, test.name), id);
        return { ...test, id };
      }),
    };
  }

  const files = {};
  let nextMutant = 0;
  for (const shard of numbers) {
    const report = reports.get(shard);
    const local = new Map();
    for (const [file, entry] of Object.entries(report.testFiles ?? {})) {
      for (const test of entry.tests) local.set(test.id, ids.get(testKey(file, test.name)));
    }
    const remap = (list) =>
      list.map((id) => {
        const unified = local.get(id);
        if (unified === undefined) throw new ShardError(`Shard ${shard} names test ${id}, which its report does not define.`);
        return unified;
      });
    for (const [name, file] of Object.entries(report.files)) {
      files[name] = {
        ...file,
        mutants: file.mutants.map((mutant) => ({
          ...mutant,
          id: String(nextMutant++),
          ...(mutant.coveredBy && { coveredBy: remap(mutant.coveredBy) }),
          ...(mutant.killedBy && { killedBy: remap(mutant.killedBy) }),
        })),
      };
    }
  }

  const first = reports.get(1);
  return {
    ...first,
    files: Object.fromEntries(Object.keys(files).sort().map((name) => [name, files[name]])),
    testFiles,
    thresholds,
    config: { ...first.config, mutate: base, thresholds },
  };
}

// The comparison MutationTestReportHelper.determineExitCode makes, on the
// unrounded score.
export function gate(report, thresholds) {
  const { metrics } = calculateMutationTestMetrics(report).systemUnderTestMetrics;
  const score = metrics.mutationScore;
  const formatted = score.toFixed(2);
  if (typeof thresholds.break !== 'number') {
    return { metrics, passed: true, message: `Final mutation score ${formatted}, with no break threshold configured.` };
  }
  return score < thresholds.break
    ? { metrics, passed: false, message: `Final mutation score ${formatted} under breaking threshold ${thresholds.break}.` }
    : { metrics, passed: true, message: `Final mutation score of ${formatted} is greater than or equal to break threshold ${thresholds.break}.` };
}

const COLUMNS = [
  ['% score', (m) => (Number.isNaN(m.mutationScore) ? 'n/a' : m.mutationScore.toFixed(2))],
  ['% covered', (m) => (Number.isNaN(m.mutationScoreBasedOnCoveredCode) ? 'n/a' : m.mutationScoreBasedOnCoveredCode.toFixed(2))],
  ['killed', (m) => String(m.killed)],
  ['timeout', (m) => String(m.timeout)],
  ['survived', (m) => String(m.survived)],
  ['no cov', (m) => String(m.noCoverage)],
  ['errors', (m) => String(m.runtimeErrors + m.compileErrors)],
];

// Full paths, sorted, because that is how the shards are assigned; the metrics
// tree drops the directory every file shares.
export function formatTable(report) {
  const metricsOf = (files) => calculateMutationTestMetrics({ ...report, files }).systemUnderTestMetrics.metrics;
  const rows = [
    ['All files', metricsOf(report.files)],
    ...Object.keys(report.files)
      .sort()
      .map((name) => [name, metricsOf({ [name]: report.files[name] })]),
  ];
  const cells = rows.map(([name, metrics]) => [name, ...COLUMNS.map(([, read]) => read(metrics))]);
  const header = ['File', ...COLUMNS.map(([title]) => title)];
  const widths = header.map((title, column) => Math.max(title.length, ...cells.map((row) => row[column].length)));
  const line = (row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[column]))).join(' | ');
  return [line(header), widths.map((width) => '-'.repeat(width)).join('-|-'), ...cells.map(line)].join('\n');
}

// The page Stryker's HTML reporter writes, less its logo. The report is a
// script expression, so every `<` is split out of its string as Stryker does,
// and no source text can close the <script> tag.
export function reportHtml(report, elementsScript) {
  const json = JSON.stringify(report).replace(/</g, '<"+"');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script>
${elementsScript}
</script>
</head>
<body>
<mutation-test-report-app titlePostfix="Stryker"></mutation-test-report-app>
<script>
const app = document.querySelector('mutation-test-report-app');
app.report = ${json};
function updateTheme() {
  document.body.style.backgroundColor = app.themeBackgroundColor;
}
app.addEventListener('theme-changed', updateTheme);
updateTheme();
</script>
</body>
</html>
`;
}

const minutes = (seconds) => `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`;

async function main(argv) {
  const [command, directory] = argv;
  if (command !== 'merge' || directory === undefined) {
    console.error('usage: node scripts/mutation-shards.mjs merge <directory holding the shard reports>');
    return 2;
  }
  const { default: config } = await import(pathToFileURL(path.resolve('stryker.config.mjs')).href);

  const shards = [];
  const seconds = new Map();
  for (const entry of readdirSync(directory, { recursive: true })) {
    const file = path.join(directory, String(entry));
    const name = path.basename(file);
    const report = /^shard-(\d+)\.json$/.exec(name);
    const timing = /^shard-(\d+)\.timing\.json$/.exec(name);
    if (report) shards.push({ shard: Number(report[1]), report: JSON.parse(readFileSync(file, 'utf8')) });
    if (timing) seconds.set(Number(timing[1]), JSON.parse(readFileSync(file, 'utf8')).seconds);
  }

  let merged;
  try {
    merged = mergeReports(shards, { base: config.mutate, thresholds: config.thresholds });
  } catch (error) {
    if (!(error instanceof ShardError)) throw error;
    console.error(`${process.env.GITHUB_ACTIONS === 'true' ? '::error::' : ''}${error.message}`);
    return 1;
  }

  const lines = shards
    .sort((a, b) => a.shard - b.shard)
    .map(({ shard, report }) => {
      const mutants = Object.values(report.files).reduce((sum, file) => sum + file.mutants.length, 0);
      const took = seconds.has(shard) ? `, ${minutes(seconds.get(shard))}` : '';
      return `shard ${shard}: ${Object.keys(report.files).length} files, ${mutants} mutants${took}`;
    });
  const verdict = gate(merged, config.thresholds);
  console.log(`${lines.join('\n')}\n\n${formatTable(merged)}\n\n${verdict.message}`);

  const elements = readFileSync(fileURLToPath(import.meta.resolve('mutation-testing-elements/dist/mutation-test-elements.js')), 'utf8');
  const outputs = [
    [config.jsonReporter?.fileName ?? 'reports/mutation/mutation.json', JSON.stringify(merged)],
    [config.htmlReporter?.fileName ?? 'reports/mutation/index.html', reportHtml(merged, elements)],
  ];
  for (const [file, content] of outputs) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Mutation score: ${verdict.metrics.mutationScore.toFixed(2)}%\n\n${verdict.message}\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\n`,
    );
  }
  return verdict.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
