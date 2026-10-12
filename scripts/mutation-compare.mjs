/**
 * Which undetected mutants of a full sweep are new against main's.
 *
 * A score does not say it. 189 survivors of 9,105 mutants read 97.58%, and
 * so do 187 and 191, so a change that leaves two survivors of its own passes
 * the `break` with the rest. Twice a change to modules only the full sweep
 * reaches merged after a replay by hand had every mutant killed, and the
 * release's sweep then had survivors that were neither the sweep before's
 * nor equivalent: the body of `literal()` for 0.15.0, two in `init`'s plan
 * for 0.16.0 (ADR-0010). So the job that merges a sweep's shards names the
 * undetected mutants that main's newest sweep did not have.
 *
 * A mutant is its file, its mutator, the text it replaces and what replaces
 * it, and never its line, which moves with any edit above it. Mutants the
 * same in all four are told apart by how many there are: one more here than
 * in main's report is one new, at one of the lines given. What follows from
 * telling a mutant by its text: one whose own text changed is another
 * mutant, so a block that gained a line is listed as new and its old self as
 * gone, and so is a function that moved to another file.
 *
 * Nothing is failed for a new one. It may be equivalent, and is then said
 * beside its code; the `break` gates the score. And where there is no
 * report of main's to compare with, this says so and compares nothing: a
 * comparison that was not made is not "none new".
 *
 *   node scripts/mutation-compare.mjs <main's mutation.json> <this sweep's mutation.json>
 *   node scripts/mutation-compare.mjs --main <this sweep's mutation.json>
 *
 * The second is the workflow's. It asks GitHub, through `gh`, for main's
 * newest full sweep that passed and still has its merged report, which takes
 * a token that may read Actions, in `GH_TOKEN`.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class CompareError extends Error {
  name = 'CompareError';
}

/** The workflow that runs the full sweep, and the artifact its merge uploads. */
const WORKFLOW = 'mutation.yml';
const ARTIFACT = 'mutation-full';
const REPORT = 'mutation.json';

/** What a sweep did not detect: a mutant every test passed under, and one no test reaches. */
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

/** The text a mutant replaces. A report's lines and columns start at 1, and its end is the first character after. */
export function mutatedText(source, { start, end }) {
  const lines = source.split('\n');
  const line = (number) => lines[number - 1] ?? '';
  if (start.line === end.line) return line(start.line).slice(start.column - 1, end.column - 1);
  return [line(start.line).slice(start.column - 1), ...lines.slice(start.line, end.line - 1), line(end.line).slice(0, end.column - 1)].join('\n');
}

/**
 * Every undetected mutant of a report, under what makes it the same mutant
 * in another report, with each line it stands on in this one.
 */
export function undetected(report, name) {
  if (report === null || typeof report !== 'object' || report.files === null || typeof report.files !== 'object') {
    throw new CompareError(`${name} is not a mutation report: it has no files.`);
  }
  const found = new Map();
  const counts = { mutants: 0, survived: 0, noCoverage: 0 };
  for (const [file, entry] of Object.entries(report.files)) {
    for (const mutant of entry.mutants ?? []) {
      counts.mutants += 1;
      if (!UNDETECTED.has(mutant.status)) continue;
      // Never the line in its place: a report that cannot say what a mutant replaced cannot be compared.
      if (typeof entry.source !== 'string') throw new CompareError(`${name} holds no source for ${file}, so its mutants cannot be told by the text they replace.`);
      counts[mutant.status === 'Survived' ? 'survived' : 'noCoverage'] += 1;
      const text = mutatedText(entry.source, mutant.location);
      const replacement = mutant.replacement ?? '';
      const key = JSON.stringify([file, mutant.mutatorName, text, replacement]);
      const row = found.get(key) ?? { file, mutator: mutant.mutatorName, text, replacement, at: [] };
      row.at.push({ line: mutant.location.start.line, status: mutant.status });
      found.set(key, row);
    }
  }
  return { ...counts, undetected: counts.survived + counts.noCoverage, found };
}

function more(these, those) {
  const rows = [];
  for (const [key, row] of these.found) {
    const count = row.at.length - (those.found.get(key)?.at.length ?? 0);
    if (count > 0) rows.push({ ...row, at: [...row.at].sort((a, b) => a.line - b.line), count });
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.at[0].line - b.at[0].line || a.mutator.localeCompare(b.mutator) || a.replacement.localeCompare(b.replacement));
}

const total = (rows) => rows.reduce((sum, row) => sum + row.count, 0);

/**
 * The undetected mutants of `here` that `mains` does not have, and those of
 * `mains` that `here` does not have, each a row with how many of it differ.
 */
export function compare(mains, here) {
  const before = undetected(mains, "Main's report");
  const after = undetected(here, "This sweep's report");
  const fresh = more(after, before);
  const gone = more(before, after);
  const tally = ({ found: _found, ...counts }) => counts;
  return { here: tally(after), main: tally(before), fresh, gone, new: total(fresh), lost: total(gone) };
}

/** A text on one line, and a long one by its ends. */
function shown(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 110 ? `${flat.slice(0, 70)} ... ${flat.slice(-30)}` : flat;
}

const STATUS = { Survived: 'survived', NoCoverage: 'no coverage' };

/**
 * A row as one line, which starts with its file whatever the source holds:
 * a line of a job's log that starts with `::` is a command to the runner,
 * and the text of a pull request's source is not to be one.
 */
export function line(row) {
  const lines = row.at.map((at) => at.line).join(',');
  const statuses = [...new Set(row.at.map((at) => STATUS[at.status] ?? at.status))].join(' and ');
  const which = row.count === row.at.length ? '' : `  (${row.count} of the ${row.at.length} at these lines)`;
  return `${row.file}:${lines}  ${statuses}  ${row.mutator}  ${shown(row.text)} -> ${shown(row.replacement)}${which}`;
}

const counted = (number, one, many) => `${number.toLocaleString('en-US')} ${number === 1 ? one : many}`;
const tallied = (counts) =>
  `${counted(counts.mutants, 'mutant', 'mutants')}, ${counts.undetected.toLocaleString('en-US')} undetected (${counts.survived.toLocaleString('en-US')} survived, ${counts.noCoverage.toLocaleString('en-US')} without coverage)`;

/** What the comparison found, for a log. `against` says which report main's is. */
export function render(result, against) {
  const lines = [`this sweep: ${tallied(result.here)}`, `${against}: ${tallied(result.main)}`, ''];
  lines.push(`undetected mutants that are new against main's: ${result.new}`);
  for (const row of result.fresh) lines.push(`  ${line(row)}`);
  lines.push('', `undetected mutants of main's that are not in this sweep: ${result.lost}`);
  for (const row of result.gone) lines.push(`  ${line(row)}`);
  return lines.join('\n');
}

/** The rows a summary lists; the log has every one. A step's summary may hold 1 MiB, and a row is under 300 characters. */
const LISTED = 200;

/** A fence no row can close: one backtick longer than the longest run of them in what it holds, and three at least. */
function fenced(lines) {
  const longest = Math.max(2, ...lines.join('\n').split(/[^`]+/).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return [`${fence}text`, ...lines, fence].join('\n');
}

/** The same, as the Markdown of a job's summary. */
export function summary(result, against) {
  const parts = [`### Undetected mutants new against main: ${result.new === 0 ? 'none' : result.new}`, `Compared with ${against}: ${result.main.undetected} undetected there, ${result.here.undetected} here.`];
  if (result.new > 0) {
    parts.push(fenced(result.fresh.slice(0, LISTED).map(line)));
    if (result.fresh.length > LISTED) parts.push(`And ${result.fresh.length - LISTED} more rows, in the job's log.`);
    parts.push(
      'A mutant is its file, its mutator, the text it replaces and what replaces it, never its line: one whose own text changed is listed as new, and so is an undetected mutant of anything main took after the commit that report is of. The sweep is not failed for these. Each is killed by a test, or said equivalent beside its code, before the change merges (CONTRIBUTING.md).',
    );
  }
  if (result.lost > 0) parts.push(`${counted(result.lost, "undetected mutant of main's is", "undetected mutants of main's are")} not in this sweep; the job's log has which.`);
  return `${parts.join('\n\n')}\n\n`;
}

/** What is said where nothing was compared. It never reads as a comparison that found none. */
export function notCompared(reason) {
  return `There is no report of main's to compare this sweep with: ${reason}. Nothing is said here of new survivors, neither that there are some nor that there are none.`;
}

const firstLine = (error) => {
  const text = String(error?.stderr ?? '').trim() || (error instanceof Error ? error.message : String(error));
  return text.split('\n')[0].trim();
};

/** How many of main's sweeps are tried for a report before giving up: the newest may have lost its artifact, not the five after it. */
const TRIED = 5;

/**
 * The merged report of main's newest full sweep that passed, fetched into
 * `directory`. `gh` runs the GitHub CLI with the arguments given and returns
 * what it printed, or throws. A sweep counts when it ran for main itself, by
 * a push, the schedule or a dispatch: a pull request from a fork's `main` is
 * listed under the same branch name. `own` is this run, which is not its
 * own baseline when it is run again.
 *
 * Returns the report's file with its run, or the reason there is none.
 */
export function mainsReport({ gh, repository, directory, own }) {
  let runs;
  try {
    // Anything a query cannot say is filtered below; the file's name stands for the workflow's id.
    runs = JSON.parse(gh(['api', `repos/${repository}/actions/workflows/${WORKFLOW}/runs?branch=main&status=success&per_page=30`])).workflow_runs;
  } catch (error) {
    return { reason: `GitHub did not list main's sweeps (${firstLine(error)})` };
  }
  if (!Array.isArray(runs)) return { reason: "GitHub's list of main's sweeps is not a list" };
  const sweeps = runs
    .filter((run) => run.head_branch === 'main' && run.conclusion === 'success' && run.event !== 'pull_request' && String(run.id) !== String(own))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (sweeps.length === 0) return { reason: 'main has no full sweep that passed' };
  const tried = [];
  for (const run of sweeps.slice(0, TRIED)) {
    const into = path.join(directory, String(run.id));
    try {
      gh(['run', 'download', String(run.id), '--repo', repository, '--name', ARTIFACT, '--dir', into]);
    } catch (error) {
      tried.push(`run ${run.id}: ${firstLine(error)}`);
      continue;
    }
    // One artifact asked for by its name is unpacked into the directory
    // itself, and each of several into a directory of its name: a `gh` that
    // did the second for one is read as well.
    const file = [path.join(into, REPORT), path.join(into, ARTIFACT, REPORT)].find((candidate) => existsSync(candidate));
    if (file === undefined) {
      tried.push(`run ${run.id}: its artifact holds no ${REPORT}`);
      continue;
    }
    return { file, run: String(run.id), sha: String(run.head_sha), created: String(run.created_at), url: run.html_url };
  }
  return { reason: `none of main's ${tried.length === 1 ? 'one sweep' : `${tried.length} newest sweeps`} that passed gave its report (${tried.join('; ')})` };
}

function read(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CompareError(`${file} cannot be read as a mutation report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const USAGE = "usage: node scripts/mutation-compare.mjs <main's mutation.json> <this sweep's mutation.json>\n       node scripts/mutation-compare.mjs --main <this sweep's mutation.json>";

// A call that hangs is ended, and the job has ten minutes of its own.
const ghOf = (env) => (args) => execFileSync('gh', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });

/**
 * Exit 0 with the comparison, or with the sentence that none was made; exit
 * 2 where this sweep's own report, or a report named by hand, cannot be read.
 * `directory` is where main's report is fetched into: under `reports/`, which
 * git ignores, beside the sweep's own.
 */
export function main(argv, { env = process.env, gh = ghOf(env), directory = path.join('reports', 'main'), log = console.log, fail = console.error } = {}) {
  const annotate = (kind) => (env.GITHUB_ACTIONS === 'true' ? `::${kind}::` : '');
  const summarise = (text) => {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  };
  const fetched = argv[0] === '--main';
  if (argv.length !== 2 || argv[1].startsWith('-') || (!fetched && argv[0].startsWith('-'))) {
    fail(USAGE);
    return 2;
  }
  try {
    const here = read(argv[1]);
    // Read before anything is fetched: a sweep with no report of its own has nothing to compare.
    undetected(here, "This sweep's report");
    let mains;
    let against;
    let linked;
    if (fetched) {
      const found = mainsReport({ gh, repository: env.GITHUB_REPOSITORY ?? '', directory, own: env.GITHUB_RUN_ID ?? '' });
      let reason = found.reason;
      if (reason === undefined) {
        try {
          mains = read(found.file);
          undetected(mains, "Main's report");
        } catch (error) {
          // Whatever is wrong with it: nothing in main's report fails the sweep of a change.
          reason = `the report of run ${found.run} cannot be used (${error instanceof Error ? error.message : String(error)})`;
        }
      }
      if (reason !== undefined) {
        const sentence = notCompared(reason);
        log(`${annotate('warning')}${sentence}`);
        summarise(`### Undetected mutants new against main: not compared\n\n${sentence}\n\n`);
        return 0;
      }
      const of = `of ${found.sha.slice(0, 7)} on ${found.created.slice(0, 10)}`;
      // The newest that still has its report, which the newest of all may have lost.
      against = `main's newest full sweep that passed and has its report, run ${found.run} ${of}`;
      linked = `main's newest full sweep that passed and has its report, [run ${found.run}](${found.url}) ${of}`;
    } else {
      mains = read(argv[0]);
      against = argv[0];
      linked = `\`${argv[0]}\``;
    }
    const result = compare(mains, here);
    log(render(result, against));
    if (result.new > 0) log(`\n${annotate('notice')}${counted(result.new, 'undetected mutant is', 'undetected mutants are')} new against ${against}. The sweep is not failed for any: each is killed by a test, or said equivalent beside its code, before the change merges.`);
    summarise(summary(result, linked));
    return 0;
  } catch (error) {
    if (!(error instanceof CompareError)) throw error;
    fail(`${annotate('error')}${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
