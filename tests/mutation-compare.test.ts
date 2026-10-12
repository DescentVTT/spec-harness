/**
 * Which undetected mutants of a full sweep are new against main's
 * (scripts/mutation-compare.mjs).
 *
 * The list is what a pull request is read by, so what is worth holding is
 * what it calls the same mutant: one that only moved is not new, and one
 * that took another's line is. Then that a comparison which was not made is
 * said as that, and never as a list with nothing on it; and which of main's
 * sweeps a sweep is compared with.
 *
 * This file writes to disk and runs node, so it is not in the unit suite;
 * the full sweep leaves it out, since no mutant is under this script
 * (vitest.mutation.config.ts).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { compare, CompareError, line, main, mainsReport, mutatedText, notCompared, render, summary, type Compared, type Gh, type Location } from '../scripts/mutation-compare.mjs';
import { PREFIX } from './temporary.js';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'mutation-compare.mjs');

const PLAN = ['export function plan(lines: string[]): string {', "  if (lines.length === 0) return 'none';", "  return lines.join('; ');", '}'].join('\n');

/** Where `text` stands in `source`, the `nth` time, as a report says it: lines and columns from 1, the end one past. */
function locate(source: string, text: string, nth = 0): Location {
  let from = -1;
  for (let found = 0; found <= nth; found += 1) {
    from = source.indexOf(text, from + 1);
    if (from === -1) throw new Error(`${JSON.stringify(text)} is not in the source ${nth + 1} times`);
  }
  const position = (offset: number) => {
    const before = source.slice(0, offset).split('\n');
    return { line: before.length, column: (before.at(-1) as string).length + 1 };
  };
  return { start: position(from), end: position(from + text.length) };
}

type Made = { mutatorName: string; replacement: string; status: string; location: Location };

const mutant = (source: string, text: string, mutatorName: string, replacement: string, status = 'Survived', nth = 0): Made => ({ mutatorName, replacement, status, location: locate(source, text, nth) });

const report = (files: Record<string, readonly [string, Made[]]>): Compared => ({
  schemaVersion: '1.0',
  files: Object.fromEntries(Object.entries(files).map(([name, [source, mutants]]) => [name, { language: 'typescript', source, mutants }])),
});

/** One file, `src/a.ts`, with these mutants. */
const one = (source: string, ...mutants: Made[]): Compared => report({ 'src/a.ts': [source, mutants] });

const EMPTY = mutant(PLAN, 'lines.length === 0', 'ConditionalExpression', 'true');

describe('the text a mutant replaces', () => {
  it("is read from the report's own source by line and column, the end one past the last character", () => {
    expect(mutatedText(PLAN, { start: { line: 2, column: 7 }, end: { line: 2, column: 25 } })).toBe('lines.length === 0');
    expect(mutatedText(PLAN, locate(PLAN, "'; '"))).toBe("'; '");
  });

  it('runs over every line a mutant spans, each whole but the first and the last', () => {
    const body = PLAN.slice(PLAN.indexOf('{'));
    expect(mutatedText(PLAN, { start: { line: 1, column: 47 }, end: { line: 4, column: 2 } })).toBe(body);
    expect(mutatedText(PLAN, { start: { line: 2, column: 3 }, end: { line: 3, column: 9 } })).toBe("if (lines.length === 0) return 'none';\n  return");
  });
});

describe('a mutant in two reports', () => {
  it('is the same one where only its line moved, and is not listed', () => {
    const moved = `// A comment.\n// And another.\n\n${PLAN}`;
    const here = one(moved, mutant(moved, 'lines.length === 0', 'ConditionalExpression', 'true'));
    expect(here.files['src/a.ts']?.mutants?.[0]?.location.start.line).toBe(5);
    expect(compare(one(PLAN, EMPTY), here)).toMatchObject({ fresh: [], gone: [], new: 0, lost: 0 });
  });

  it('is new where another text stands on its line, which a comparison by line would call the same', () => {
    const edited = PLAN.split('lines.length === 0').join('lines.length <= 1');
    const here = one(edited, mutant(edited, 'lines.length <= 1', 'ConditionalExpression', 'true'));
    // The same file, line, columns but the last, mutator, replacement and verdict.
    expect(here.files['src/a.ts']?.mutants?.[0]?.location.start).toEqual(EMPTY.location.start);
    const result = compare(one(PLAN, EMPTY), here);
    expect(result).toMatchObject({ new: 1, lost: 1 });
    expect(result.fresh).toEqual([{ file: 'src/a.ts', mutator: 'ConditionalExpression', text: 'lines.length <= 1', replacement: 'true', at: [{ line: 2, status: 'Survived' }], count: 1 }]);
    expect(result.gone.map((row) => row.text)).toEqual(['lines.length === 0']);
  });

  it('is new where a test killed it for main and none does here, or where it timed out there', () => {
    for (const status of ['Killed', 'Timeout']) {
      const result = compare(one(PLAN, { ...EMPTY, status }), one(PLAN, EMPTY));
      expect(result.fresh.map((row) => row.text), status).toEqual(['lines.length === 0']);
      expect(result, status).toMatchObject({ new: 1, lost: 0 });
    }
  });

  it('is not new where it was undetected there another way: without coverage there and survived here, or the other way about', () => {
    const uncovered = { ...EMPTY, status: 'NoCoverage' };
    expect(compare(one(PLAN, uncovered), one(PLAN, EMPTY))).toMatchObject({ new: 0, lost: 0 });
    expect(compare(one(PLAN, EMPTY), one(PLAN, uncovered))).toMatchObject({ new: 0, lost: 0 });
    // And one no test reaches is undetected like one every test passes under.
    expect(compare(one(PLAN), one(PLAN, uncovered)).fresh.map((row) => row.at)).toEqual([[{ line: 2, status: 'NoCoverage' }]]);
  });

  it('is gone, and not new, where a test kills it here', () => {
    const result = compare(one(PLAN, EMPTY), one(PLAN, { ...EMPTY, status: 'Killed' }));
    expect(result).toMatchObject({ new: 0, lost: 1, fresh: [] });
    expect(result.gone.map((row) => row.text)).toEqual(['lines.length === 0']);
  });

  it('is another mutant under another mutator, with another replacement, or in another file', () => {
    const mains = one(PLAN, EMPTY);
    expect(compare(mains, one(PLAN, { ...EMPTY, mutatorName: 'EqualityOperator' }))).toMatchObject({ new: 1, lost: 1 });
    expect(compare(mains, one(PLAN, { ...EMPTY, replacement: 'false' }))).toMatchObject({ new: 1, lost: 1 });
    expect(compare(mains, report({ 'src/b.ts': [PLAN, [EMPTY]] }))).toMatchObject({ new: 1, lost: 1 });
  });

  it('is told from its like by how many there are, where one text is replaced by one thing more than once in a file', () => {
    const twice = "const a = read(first, 'utf8');\nconst b = read(second, 'utf8');\n";
    const first = mutant(twice, "'utf8'", 'StringLiteral', '""', 'Survived', 0);
    const second = mutant(twice, "'utf8'", 'StringLiteral', '""', 'NoCoverage', 1);
    const more = compare(one(twice, first), one(twice, first, second));
    expect(more).toMatchObject({ new: 1, lost: 0 });
    // Which of the two is the new one a report cannot say, so both lines are given.
    expect(more.fresh).toEqual([{ file: 'src/a.ts', mutator: 'StringLiteral', text: "'utf8'", replacement: '""', at: [{ line: 1, status: 'Survived' }, { line: 2, status: 'NoCoverage' }], count: 1 }]);
    expect(line(more.fresh[0]!)).toBe('src/a.ts:1,2  survived and no coverage  StringLiteral  \'utf8\' -> ""  (1 of the 2 at these lines)');
    expect(compare(one(twice, first, second), one(twice, second))).toMatchObject({ new: 0, lost: 1 });
    expect(compare(one(twice, first, second), one(twice, second, first))).toMatchObject({ new: 0, lost: 0 });
    expect(compare(one(twice), one(twice, first, second))).toMatchObject({ new: 2, fresh: [{ count: 2 }] });
  });

  it('counts each report: its mutants, and those undetected of each kind', () => {
    const mains = one(PLAN, EMPTY, { ...mutant(PLAN, "'none'", 'StringLiteral', '""'), status: 'Killed' }, { ...mutant(PLAN, "'; '", 'StringLiteral', '""'), status: 'Timeout' });
    const here = one(PLAN, EMPTY, mutant(PLAN, "'none'", 'StringLiteral', '""'), { ...mutant(PLAN, "'; '", 'StringLiteral', '""'), status: 'NoCoverage' });
    const result = compare(mains, here);
    expect(result.main).toEqual({ mutants: 3, survived: 1, noCoverage: 0, undetected: 1 });
    expect(result.here).toEqual({ mutants: 3, survived: 2, noCoverage: 1, undetected: 3 });
    expect(result.fresh.map((row) => `${row.at[0]?.line} ${row.text}`)).toEqual(["2 'none'", "3 '; '"]);
  });

  it('refuses what is no report, and a report that cannot say what an undetected mutant replaced', () => {
    expect(() => compare({}, one(PLAN, EMPTY))).toThrow(new CompareError("Main's report is not a mutation report: it has no files."));
    expect(() => compare(one(PLAN, EMPTY), null)).toThrow("This sweep's report is not a mutation report: it has no files.");
    const sourceless = { files: { 'src/a.ts': { mutants: [EMPTY] } } };
    expect(() => compare(sourceless, one(PLAN, EMPTY))).toThrow("Main's report holds no source for src/a.ts, so its mutants cannot be told by the text they replace.");
  });

  it('takes a file with no source where every mutant of it was detected, and a file with no mutants', () => {
    const detected = { files: { 'src/a.ts': { mutants: [{ ...EMPTY, status: 'Killed' }] }, 'src/document.ts': { source: 'export type A = string;\n' } } };
    expect(compare(detected, one(PLAN, EMPTY))).toMatchObject({ new: 1, lost: 0, main: { mutants: 1, undetected: 0 } });
  });
});

describe('what is written', () => {
  const twice = "const a = read(first, 'utf8');\nconst b = read(second, 'utf8');\n";
  const mains = report({ 'src/a.ts': [PLAN, [EMPTY]], 'src/b.ts': [twice, [mutant(twice, "'utf8'", 'StringLiteral', '""')]] });
  const here = report({
    'src/a.ts': [PLAN, [mutant(PLAN, "'; '", 'StringLiteral', '""'), mutant(PLAN, PLAN.slice(PLAN.indexOf('{')), 'BlockStatement', '{}', 'NoCoverage')]],
    'src/b.ts': [twice, [mutant(twice, "'utf8'", 'StringLiteral', '""', 'Survived', 0), mutant(twice, "'utf8'", 'StringLiteral', '""', 'Survived', 1)]],
  });

  it('is each new mutant and each that is gone on a line of its own, a text that spans lines on one', () => {
    expect(render(compare(mains, here), "main's sweep")).toBe(
      [
        'this sweep: 4 mutants, 4 undetected (3 survived, 1 without coverage)',
        "main's sweep: 2 mutants, 2 undetected (2 survived, 0 without coverage)",
        '',
        "undetected mutants that are new against main's: 3",
        "  src/a.ts:1  no coverage  BlockStatement  { if (lines.length === 0) return 'none'; return lines.join('; '); } -> {}",
        '  src/a.ts:3  survived  StringLiteral  \'; \' -> ""',
        '  src/b.ts:1,2  survived  StringLiteral  \'utf8\' -> ""  (1 of the 2 at these lines)',
        '',
        "undetected mutants of main's that are not in this sweep: 1",
        '  src/a.ts:2  survived  ConditionalExpression  lines.length === 0 -> true',
      ].join('\n'),
    );
  });

  it('is, for a summary, the count, what it was compared with, the new ones in a block, and what a new one asks of the change', () => {
    expect(summary(compare(mains, here), "main's newest full sweep that passed and has its report, [run 7](https://github.com/o/r/actions/runs/7) of abcdef0 on 2026-10-12")).toBe(
      [
        '### Undetected mutants new against main: 3',
        '',
        "Compared with main's newest full sweep that passed and has its report, [run 7](https://github.com/o/r/actions/runs/7) of abcdef0 on 2026-10-12: 2 undetected there, 4 here.",
        '',
        '```text',
        "src/a.ts:1  no coverage  BlockStatement  { if (lines.length === 0) return 'none'; return lines.join('; '); } -> {}",
        'src/a.ts:3  survived  StringLiteral  \'; \' -> ""',
        'src/b.ts:1,2  survived  StringLiteral  \'utf8\' -> ""  (1 of the 2 at these lines)',
        '```',
        '',
        'A mutant is its file, its mutator, the text it replaces and what replaces it, never its line: one whose own text changed is listed as new, and so is an undetected mutant of anything main took after the commit that report is of. The sweep is not failed for these. Each is killed by a test, or said equivalent beside its code, before the change merges (CONTRIBUTING.md).',
        '',
        "1 undetected mutant of main's is not in this sweep; the job's log has which.",
        '',
        '',
      ].join('\n'),
    );
  });

  it('says none where it compared and found none, with what it compared', () => {
    const text = summary(compare(mains, mains), '`main.json`');
    expect(text).toBe('### Undetected mutants new against main: none\n\nCompared with `main.json`: 2 undetected there, 2 here.\n\n');
  });

  it('says of a comparison that was not made that it was not made, and never that it found none', () => {
    const sentence = notCompared('main has no full sweep that passed');
    expect(sentence).toBe("There is no report of main's to compare this sweep with: main has no full sweep that passed. Nothing is said here of new survivors, neither that there are some nor that there are none.");
  });

  it('shortens a long text to its ends', () => {
    const long = `const LONG = [${Array.from({ length: 30 }, (_, index) => `'value ${index}'`).join(', ')}];\n`;
    const array = long.slice(long.indexOf('['), long.indexOf(']') + 1);
    const [row] = compare(one(long), one(long, mutant(long, array, 'ArrayDeclaration', '[]'))).fresh;
    // Seventy characters of its start and thirty of its end.
    expect(line(row!)).toBe("src/a.ts:1  survived  ArrayDeclaration  ['value 0', 'value 1', 'value 2', 'value 3', 'value 4', 'value 5', 'va ... e 27', 'value 28', 'value 29'] -> []");
  });

  it('closes its block only where it ends, whatever backticks a mutated text holds', () => {
    const source = 'const fence = "```";\nconst longer = "`````";\n';
    const three = compare(one(source), one(source, mutant(source, '"```"', 'StringLiteral', '""')));
    expect(summary(three, 'x')).toContain('\n\n````text\nsrc/a.ts:1  survived  StringLiteral  "```" -> ""\n````\n\n');
    const five = compare(one(source), one(source, mutant(source, '"```"', 'StringLiteral', '""'), mutant(source, '"`````"', 'StringLiteral', '""')));
    expect(summary(five, 'x')).toContain('\n\n``````text\nsrc/a.ts:1  survived  StringLiteral  "```" -> ""\nsrc/a.ts:2  survived  StringLiteral  "`````" -> ""\n``````\n\n');
  });

  it('starts no line of the log with a text of the source, which could be a command to the runner', () => {
    const source = 'function f() {\n::error::not a failure\n  ::add-mask::x\n}\n';
    const body = source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1);
    const result = compare(one(source), one(source, mutant(source, body, 'BlockStatement', '{}'), mutant(source, '::error::not a failure', 'StringLiteral', '::warning::x')));
    const written = render(result, 'x').split('\n');
    expect(written.filter((text) => text.includes('::error::'))).toEqual([
      '  src/a.ts:1  survived  BlockStatement  { ::error::not a failure ::add-mask::x } -> {}',
      '  src/a.ts:2  survived  StringLiteral  ::error::not a failure -> ::warning::x',
    ]);
    expect(written.filter((text) => text.trimStart().startsWith('::'))).toEqual([]);
  });

  it('lists two hundred rows in a summary and says how many more the log has, every one', () => {
    const source = `${Array.from({ length: 205 }, (_, index) => `export const v${index} = 'value ${index}';`).join('\n')}\n`;
    const all = Array.from({ length: 205 }, (_, index) => mutant(source, `'value ${index}'`, 'StringLiteral', '""'));
    const result = compare(one(source), one(source, ...all));
    expect(result.new).toBe(205);
    const text = summary(result, 'x');
    expect(text.split('\n').filter((row) => row.startsWith('src/a.ts:'))).toHaveLength(200);
    expect(text).toContain("\n\nAnd 5 more rows, in the job's log.\n\n");
    expect(render(result, 'x').split('\n').filter((row) => row.startsWith('  src/a.ts:'))).toHaveLength(205);
    // A step's summary may hold 1 MiB.
    expect(text.length).toBeLessThan(100_000);
  });
});

/** A run as GitHub lists one, as far as the script reads it. */
const sweep = (id: number, created: string, changes: Record<string, unknown> = {}) => ({
  id,
  head_branch: 'main',
  head_sha: `${String(id).padStart(7, '0')}${'a'.repeat(33)}`,
  event: 'push',
  conclusion: 'success',
  created_at: created,
  html_url: `https://github.com/o/r/actions/runs/${id}`,
  ...changes,
});

describe("main's report", () => {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  afterAll(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));

  /**
   * A `gh` that lists `runs`, and hands the report of each run in `reports`;
   * any other has lost its artifact. It unpacks a report into the directory
   * it is given, or into `within` under it.
   */
  const github = (runs: unknown, reports: Record<number, string> = {}, within = '.', named = 'mutation.json'): { gh: Gh; asked: string[][] } => {
    const asked: string[][] = [];
    const gh: Gh = (args) => {
      asked.push(args);
      if (args[0] === 'api') {
        if (runs instanceof Error) throw runs;
        return JSON.stringify(runs);
      }
      const content = reports[Number(args[2])];
      if (content === undefined) throw Object.assign(new Error('Command failed: gh run download'), { stderr: 'no valid artifacts found to download\n' });
      const into = join(args[args.indexOf('--dir') + 1] as string, within);
      mkdirSync(into, { recursive: true });
      writeFileSync(join(into, named), content);
      return '';
    };
    return { gh, asked };
  };
  const fetch = (name: string, gh: Gh, own = '99') => mainsReport({ gh, repository: 'o/r', directory: join(directory, name), own });

  it("is that of main's newest sweep that passed, by when each was created and in whatever order GitHub lists them", () => {
    const { gh, asked } = github({ workflow_runs: [sweep(3, '2026-10-05T12:00:00Z'), sweep(8, '2026-10-12T05:00:00Z', { event: 'schedule' }), sweep(5, '2026-10-11T21:00:00Z', { event: 'workflow_dispatch' })] }, { 8: '{"files":{}}' });
    const found = fetch('newest', gh);
    expect(found).toEqual({ file: join(directory, 'newest', '8', 'mutation.json'), run: '8', sha: `0000008${'a'.repeat(33)}`, created: '2026-10-12T05:00:00Z', url: 'https://github.com/o/r/actions/runs/8' });
    expect(readFileSync((found as { file: string }).file, 'utf8')).toBe('{"files":{}}');
    // One question for the list, of the workflow's runs on main that passed, and one for the report, by the artifact's name.
    expect(asked).toEqual([
      ['api', 'repos/o/r/actions/workflows/mutation.yml/runs?branch=main&status=success&per_page=30'],
      ['run', 'download', '8', '--repo', 'o/r', '--name', 'mutation-full', '--dir', join(directory, 'newest', '8')],
    ]);
  });

  it("is never a pull request's from a branch named main, a sweep that did not pass, another branch's, or this run's own", () => {
    const { gh, asked } = github(
      {
        workflow_runs: [
          sweep(9, '2026-10-12T09:00:00Z', { event: 'pull_request' }),
          sweep(8, '2026-10-12T08:00:00Z', { conclusion: 'failure' }),
          sweep(7, '2026-10-12T07:00:00Z', { head_branch: 'fix/a-branch' }),
          sweep(6, '2026-10-12T06:00:00Z'),
          sweep(4, '2026-10-12T04:00:00Z'),
        ],
      },
      { 9: '{}', 8: '{}', 7: '{}', 6: '{}', 4: '{}' },
    );
    expect(fetch('own', gh, '6')).toMatchObject({ run: '4' });
    expect(asked.filter((args) => args[0] === 'run').map((args) => args[2])).toEqual(['4']);
  });

  it('is that of the sweep before where the newest no longer has its report', () => {
    const { gh, asked } = github({ workflow_runs: [sweep(8, '2026-10-12T05:00:00Z'), sweep(5, '2026-10-11T21:00:00Z'), sweep(3, '2026-10-05T12:00:00Z')] }, { 5: '{}', 3: '{}' });
    expect(fetch('before', gh)).toMatchObject({ run: '5', created: '2026-10-11T21:00:00Z' });
    expect(asked.filter((args) => args[0] === 'run').map((args) => args[2])).toEqual(['8', '5']);
  });

  it('is found where one artifact is unpacked: in the directory asked for, or in one of its name under it', () => {
    const runs = { workflow_runs: [sweep(8, '2026-10-12T05:00:00Z')] };
    expect(fetch('flat', github(runs, { 8: '{}' }).gh)).toMatchObject({ run: '8', file: join(directory, 'flat', '8', 'mutation.json') });
    expect(fetch('nested', github(runs, { 8: '{}' }, 'mutation-full').gh)).toMatchObject({ run: '8', file: join(directory, 'nested', '8', 'mutation-full', 'mutation.json') });
  });

  it('is that of the sweep before where the artifact of the newest holds no report', () => {
    const runs = { workflow_runs: [sweep(8, '2026-10-12T05:00:00Z'), sweep(5, '2026-10-11T21:00:00Z')] };
    // The page alone, as a merge that failed before it wrote the report would leave.
    const { gh } = github(runs, { 8: '<html>', 5: '{}' }, '.', 'index.html');
    expect(fetch('page', gh)).toEqual({ reason: "none of main's 2 newest sweeps that passed gave its report (run 8: its artifact holds no mutation.json; run 5: its artifact holds no mutation.json)" });
    const other = github(runs, { 8: '{}' }, 'another-artifact');
    expect(fetch('elsewhere', other.gh)).toEqual({ reason: "none of main's 2 newest sweeps that passed gave its report (run 8: its artifact holds no mutation.json; run 5: no valid artifacts found to download)" });
  });

  it('is none after five sweeps without one, with what GitHub said of each', () => {
    const runs = Array.from({ length: 7 }, (_, index) => sweep(index + 1, `2026-10-0${index + 1}T05:00:00Z`));
    const { gh, asked } = github({ workflow_runs: runs });
    expect(fetch('none', gh)).toEqual({
      reason: `none of main's 5 newest sweeps that passed gave its report (${[7, 6, 5, 4, 3].map((id) => `run ${id}: no valid artifacts found to download`).join('; ')})`,
    });
    expect(asked).toHaveLength(6);
    const single = github({ workflow_runs: [sweep(1, '2026-10-01T05:00:00Z')] });
    expect(fetch('single', single.gh)).toEqual({ reason: "none of main's one sweep that passed gave its report (run 1: no valid artifacts found to download)" });
  });

  it('is none where main has no sweep that passed, where GitHub does not list them, and where what it lists is no list', () => {
    expect(fetch('empty', github({ workflow_runs: [] }).gh)).toEqual({ reason: 'main has no full sweep that passed' });
    expect(fetch('others', github({ workflow_runs: [sweep(9, '2026-10-12T09:00:00Z', { event: 'pull_request' })] }).gh)).toEqual({ reason: 'main has no full sweep that passed' });
    const refused = Object.assign(new Error('Command failed: gh api'), { stderr: 'gh: Resource not accessible by integration (HTTP 403)\n{"message":"Resource not accessible by integration"}\n' });
    expect(fetch('refused', github(refused).gh)).toEqual({ reason: "GitHub did not list main's sweeps (gh: Resource not accessible by integration (HTTP 403))" });
    expect(fetch('missing', github(Object.assign(new Error('spawnSync gh ENOENT'), { stderr: '' })).gh)).toEqual({ reason: "GitHub did not list main's sweeps (spawnSync gh ENOENT)" });
    expect(fetch('shape', github({ message: 'Not Found' }).gh)).toEqual({ reason: "GitHub's list of main's sweeps is not a list" });
  });
});

describe('the script', () => {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  afterAll(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));

  const twice = "const a = read(first, 'utf8');\nconst b = read(second, 'utf8');\n";
  const written = (name: string, content: unknown): string => {
    const file = join(directory, name);
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  };
  const mains = written('main.json', one(PLAN, EMPTY));
  const here = written('here.json', report({ 'src/a.ts': [PLAN, [EMPTY, mutant(PLAN, "'; '", 'StringLiteral', '""')]], 'src/b.ts': [twice, [mutant(twice, "'utf8'", 'StringLiteral', '""')]] }));

  /** The script as a person runs it on two reports: its exit code and what it printed. */
  const run = (args: readonly string[], env: Readonly<Record<string, string>> = {}): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: directory, env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', ...env }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string };
      return { code: failed.status, out: `${failed.stdout}${failed.stderr}` };
    }
  };

  /** The script as the workflow runs it, with a `gh` that answers as `runs` and `reports` say. */
  const fetched = (name: string, argv: readonly string[], runs: unknown, reports: Record<number, string>, actions = true) => {
    const said: string[] = [];
    const asked: string[][] = [];
    const file = join(directory, `${name}.md`);
    const gh: Gh = (args) => {
      asked.push(args);
      if (args[0] === 'api') {
        if (runs instanceof Error) throw runs;
        return JSON.stringify(runs);
      }
      const content = reports[Number(args[2])];
      if (content === undefined) throw Object.assign(new Error('Command failed'), { stderr: 'no valid artifacts found to download\n' });
      const into = args[args.indexOf('--dir') + 1] as string;
      mkdirSync(into, { recursive: true });
      writeFileSync(join(into, 'mutation.json'), content);
      return '';
    };
    const env = { GITHUB_ACTIONS: actions ? 'true' : '', GITHUB_STEP_SUMMARY: file, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '99' };
    const code = main(argv, { env, gh, directory: join(directory, name), log: (text) => said.push(text), fail: (text) => said.push(text) });
    let summarised = '';
    try {
      summarised = readFileSync(file, 'utf8');
    } catch {
      // Nothing was written to it.
    }
    return { code, out: said.join('\n'), summary: summarised, asked };
  };

  it("exits 0 with the new ones named, for two reports on disk, main's first", () => {
    const { code, out } = run([mains, here]);
    expect(out).toContain("\nundetected mutants that are new against main's: 2\n  src/a.ts:3  survived  StringLiteral  '; ' -> \"\"\n  src/b.ts:1  survived  StringLiteral  'utf8' -> \"\"\n");
    expect(out).toContain(`\n2 undetected mutants are new against ${mains}. The sweep is not failed for any: `);
    expect(code).toBe(0);
    const none = run([here, here]);
    expect(none.out).toContain("\nundetected mutants that are new against main's: 0\n");
    expect(none.out).not.toContain('The sweep is not failed');
    expect(none.code).toBe(0);
  });

  it("fetches main's report where the workflow asks, and says in the summary which sweep it compared with", () => {
    const got = fetched('fetched', ['--main', here], { workflow_runs: [sweep(8, '2026-10-12T05:00:00Z')] }, { 8: readFileSync(mains, 'utf8') });
    expect(got.code).toBe(0);
    expect(got.out).toContain(`\nmain's newest full sweep that passed and has its report, run 8 of 0000008 on 2026-10-12: 1 mutant, 1 undetected (1 survived, 0 without coverage)\n`);
    expect(got.out).toContain("\n::notice::2 undetected mutants are new against main's newest full sweep that passed and has its report, run 8 of 0000008 on 2026-10-12. ");
    expect(got.summary).toMatch(/^### Undetected mutants new against main: 2\n\nCompared with main's newest full sweep that passed and has its report, \[run 8\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/8\) of 0000008 on 2026-10-12: 1 undetected there, 3 here\.\n\n```text\nsrc\/a\.ts:3 /);
    expect(got.asked.map((args) => args.slice(0, 2).join(' '))).toEqual(['api repos/o/r/actions/workflows/mutation.yml/runs?branch=main&status=success&per_page=30', 'run download']);
  });

  it('exits 0 and says that nothing was compared, as a warning and in the summary, where main has no report to fetch', () => {
    const got = fetched('nothing', ['--main', here], { workflow_runs: [] }, {});
    expect(got.code).toBe(0);
    const sentence = "There is no report of main's to compare this sweep with: main has no full sweep that passed. Nothing is said here of new survivors, neither that there are some nor that there are none.";
    expect(got.out).toBe(`::warning::${sentence}`);
    expect(got.summary).toBe(`### Undetected mutants new against main: not compared\n\n${sentence}\n\n`);
    // Off GitHub the sentence is the same, without the annotation.
    expect(fetched('nothing-here', ['--main', here], { workflow_runs: [] }, {}, false).out).toBe(sentence);
  });

  it('says the same where the report has gone, and where the one fetched is no report or one that cannot be read through', () => {
    const gone = fetched('gone', ['--main', here], { workflow_runs: [sweep(8, '2026-10-12T05:00:00Z')] }, {});
    expect(gone.code).toBe(0);
    expect(gone.summary).toContain("### Undetected mutants new against main: not compared\n\nThere is no report of main's to compare this sweep with: none of main's one sweep that passed gave its report (run 8: no valid artifacts found to download). ");
    const broken = fetched('broken', ['--main', here], { workflow_runs: [sweep(8, '2026-10-12T05:00:00Z')] }, { 8: '{' });
    expect(broken.code).toBe(0);
    expect(broken.summary).toMatch(/^### Undetected mutants new against main: not compared\n\nThere is no report of main's to compare this sweep with: the report of run 8 cannot be used \(.*mutation\.json cannot be read as a mutation report: /);
    const empty = fetched('empty', ['--main', here], { workflow_runs: [sweep(8, '2026-10-12T05:00:00Z')] }, { 8: '{}' });
    expect(empty.summary).toContain("the report of run 8 cannot be used (Main's report is not a mutation report: it has no files.)");
    // A report whose mutant has no place in its source, which no reading of it expects.
    const placeless = fetched('placeless', ['--main', here], { workflow_runs: [sweep(8, '2026-10-12T05:00:00Z')] }, { 8: JSON.stringify({ files: { 'src/a.ts': { source: PLAN, mutants: [{ mutatorName: 'StringLiteral', replacement: '""', status: 'Survived' }] } } }) });
    expect(placeless.code).toBe(0);
    expect(placeless.summary).toContain('the report of run 8 cannot be used (');
    for (const got of [gone, broken, empty, placeless]) {
      expect(got.out).toMatch(/^::warning::There is no report of main's to compare this sweep with: /);
      expect(got.summary).not.toContain('new against main: none');
      expect(got.summary).not.toContain('src/a.ts');
    }
  });

  it("exits 2 where this sweep's own report cannot be read, before GitHub is asked anything", () => {
    const missing = fetched('unread', ['--main', join(directory, 'missing.json')], { workflow_runs: [sweep(8, '2026-10-12T05:00:00Z')] }, { 8: readFileSync(mains, 'utf8') });
    expect(missing.code).toBe(2);
    expect(missing.out).toMatch(/^::error::.*missing\.json cannot be read as a mutation report: /);
    expect(missing.asked).toEqual([]);
    expect(missing.summary).toBe('');
    expect(fetched('unfiled', ['--main', written('empty.json', '{}')], { workflow_runs: [] }, {})).toMatchObject({ code: 2, out: "::error::This sweep's report is not a mutation report: it has no files.", asked: [] });
  });

  it('exits 2 for a report named by hand that cannot be read, and for anything but two reports or --main and one', () => {
    expect(run([join(directory, 'missing.json'), here])).toMatchObject({ code: 2 });
    expect(run([written('broken.json', '{'), here])).toMatchObject({ code: 2 });
    expect(run([written('unfiled.json', '{}'), here])).toEqual({ code: 2, out: "Main's report is not a mutation report: it has no files.\n" });
    const usage = "usage: node scripts/mutation-compare.mjs <main's mutation.json> <this sweep's mutation.json>\n       node scripts/mutation-compare.mjs --main <this sweep's mutation.json>\n";
    for (const args of [[], [here], [mains, here, here], ['--main'], ['--main', '--main'], ['--other', here], [mains, '--main']]) expect(run(args), args.join(' ')).toEqual({ code: 2, out: usage });
  });
});

describe('this repository', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/mutation.yml'), 'utf8');
  /** A job of the workflow, from its key to the next job's. */
  const job = (name: string): string => (workflow.split(`\n  ${name}:\n`)[1] ?? '').split(/\n  [a-z-]+:\n/)[0] as string;

  it("has the merge compare the merged report with main's, after the step that writes it and where that step failed the score", () => {
    const steps = job('full').split('\n      - ');
    const merge = steps.findIndex((step) => step.startsWith('name: Merge the shards and apply the gate\n'));
    const named = steps.findIndex((step) => step.includes('run: node scripts/mutation-compare.mjs --main reports/mutation/mutation.json'));
    expect(merge).toBeGreaterThan(-1);
    expect(named).toBe(merge + 1);
    const step = steps[named] as string;
    // Not where the run was cancelled, and not where the merge refused the sweep and wrote no report.
    expect(step).toContain("\n        if: ${{ !cancelled() && hashFiles('reports/mutation/mutation.json') != '' }}\n");
    expect(step).toContain('\n          GH_TOKEN: ${{ github.token }}\n');
    // The upload after it still takes the report where the score failed.
    expect(steps[named + 1]).toMatch(/^uses: actions\/upload-artifact@[0-9a-f]{40} # v[\d.]+\n        if: always\(\)\n/);
    expect(readFileSync(join(ROOT, 'stryker.config.mjs'), 'utf8')).toContain("jsonReporter: { fileName: 'reports/mutation/mutation.json' }");
  });

  it('uploads the merged report under the name the comparison fetches it by', () => {
    expect(job('full')).toContain('\n          name: mutation-full\n');
    expect(readFileSync(SCRIPT, 'utf8')).toContain("const ARTIFACT = 'mutation-full';");
  });

  it("lets the merge's job read Actions, which fetching another run's artifact takes, and gives no job anything more", () => {
    const granted = [...workflow.matchAll(/^( *)permissions:\n((?:\1 +\S.*\n)+)/gm)].map((match) => `${(match[1] as string).length}: ${(match[2] as string).trim().split(/\n\s*/).join(', ')}`);
    // The workflow's own, then the one job's: a job that names its permissions has no other.
    expect(granted).toEqual(['0: contents: read', '4: contents: read, actions: read']);
    expect(job('full')).toContain('\n    permissions:\n      contents: read\n      actions: read\n');
    expect(job('shard')).not.toMatch(/permissions:|GH_TOKEN|github\.token|secrets\./);
    expect(workflow).not.toMatch(/:\s*write\b|write-all/);
  });
});
