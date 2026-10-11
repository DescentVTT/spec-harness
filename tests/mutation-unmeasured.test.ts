/**
 * The count of what a mutation sweep does not measure because it stands
 * under a TypeScript `as` (scripts/mutation-unmeasured.mjs).
 *
 * The count is a gate, in the full sweep's score step and here, so what is
 * worth holding is that it counts: a small source with each kind of place a
 * mutator applies under an `as`, counted to the number, beside the ways out
 * of one, counted as none. Then the repository's own sources, on every
 * change, where the full sweep would say it a week later.
 *
 * This file reads the sources on disk and runs node, so it is not in the unit
 * suite; the full sweep leaves it out, since its sandbox holds instrumented
 * copies of the sources and no mutant is under this script
 * (vitest.mutation.config.ts).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { babel, LEFT, measure, render, sourcesOnDisk, UnmeasuredError, verdict, type Sources } from '../scripts/mutation-unmeasured.mjs';
import { PREFIX } from './temporary.js';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'mutation-unmeasured.mjs');

/** Each line under an `as`, with the places a mutator applies under it. */
const UNDER: readonly (readonly [string, number])[] = [
  // The object, its array, two strings, the inner object and its boolean.
  ["const TABLE = { a: ['x', 'y'], b: { on: true } } as const;", 6],
  // The subtraction.
  ['const before = lines[i - 1] as string;', 1],
  // The array, the sort, the arrow and its subtraction.
  ['const least = [...xs].sort((a, b) => a - b)[0] as number;', 4],
  // The condition and the string; the assertion inside it is not counted again.
  ["const outer = (flag ? (inner as string) : 'none') as string;", 2],
  // The object. A key is not a place, and neither is the number.
  ["const keyed = { 'a-key': 1 } as const;", 1],
  // The pattern, and the method that would be removed.
  ['const head = (/^ */.exec(text.trim()) as RegExpExecArray)[0];', 2],
  // The fallback and the template.
  ['const shown = (given ?? `none of ${count}`) as string;', 2],
];

/** The ways out of an `as`, and what was never under one: no place is counted for any. */
const CLEAR = [
  "const held = { a: ['x', 'y'], b: { on: true } } satisfies Record<string, unknown>;",
  'const after = lines[i + 1]!;',
  "const table = literal({ a: ['x', 'y'] });",
  "const typed: { version: string } = JSON.parse(read('package.json'));",
  // An assertion with nothing but a name, or a type, under it.
  'const named = value as string;',
  "const kind = value as { kind: 'a' | 'b'; list: [1, 2] };",
  'const both = (value as unknown) as string[];',
];

const sourceOf = (lines: readonly string[]): string => `${lines.join('\n')}\n`;

describe('the count', () => {
  it('finds each place a mutator applies under an `as`, the outermost once, and says where', async () => {
    const parse = await babel();
    const measured = measure({ 'src/a.ts': { source: sourceOf(UNDER.map(([line]) => line)) } }, parse);
    expect(measured.rows.map((row) => [row.line, row.sites])).toEqual([
      [1, 6],
      [3, 4],
      [4, 2],
      [6, 2],
      [7, 2],
      [2, 1],
      [5, 1],
    ]);
    expect(measured).toMatchObject({ files: 1, mutants: 0, expressions: 7, sites: 18, mutantsInside: 0 });
    expect(measured.rows[0]).toEqual({ file: 'src/a.ts', line: 1, sites: 6, text: "{ a: ['x', 'y'], b: { on: true } } as const" });
    // One by one, so that no line's count hides another's.
    for (const [line, sites] of UNDER) expect(measure({ 'src/a.ts': { source: `${line}\n` } }, parse).sites, line).toBe(sites);
  });

  it('counts nothing under satisfies, a non-null assertion, a call or an annotation, nor under an `as` that holds only a name or a type', async () => {
    const parse = await babel();
    for (const line of CLEAR) expect(measure({ 'src/a.ts': { source: `${line}\n` } }, parse).rows, line).toEqual([]);
    // The assertions are still seen: each of the last three lines has one.
    expect(measure({ 'src/a.ts': { source: sourceOf(CLEAR) } }, parse)).toMatchObject({ expressions: 3, sites: 0 });
  });

  it('adds the files up, the most places first, and shortens a long expression to its ends', async () => {
    const parse = await babel();
    const long = `const LONG = { ${Array.from({ length: 12 }, (_, index) => `key${index}: 'value ${index}'`).join(', ')} } as const;\n`;
    const measured = measure({ 'src/b.ts': { source: 'const before = lines[i - 1] as string;\n' }, 'src/a.ts': { source: long }, 'src/c.ts': { source: 'export const none = 1;\n' } }, parse);
    expect(measured).toMatchObject({ files: 3, expressions: 2, sites: 14 });
    expect(measured.rows.map((row) => `${row.file}:${row.line} ${row.sites}`)).toEqual(['src/a.ts:1 13', 'src/b.ts:1 1']);
    expect(measured.rows[0]?.text).toBe("{ key0: 'value 0', key1: 'value 1', key2: 'value 2', key3: 'value 3',  ... , key11: 'value 11' } as const");
  });

  it('says how many of a report\'s mutants are under an `as`: none, while Stryker passes them over', async () => {
    const parse = await babel();
    const source = "const TABLE = { a: 'x' } as const;\nconst other = 'y';\n";
    const at = (line: number, from: number, to: number) => ({ location: { start: { line, column: from }, end: { line, column: to } } });
    // A report's columns start at 1: the string on line 2, then the object and the string on line 1.
    const outside = measure({ 'src/a.ts': { source, mutants: [at(2, 15, 18)] } }, parse);
    expect(outside).toMatchObject({ mutants: 1, mutantsInside: 0, sites: 2 });
    expect(render(outside, 'a report')).toContain('mutants the report has under an `as`: 0\n');
    const inside = measure({ 'src/a.ts': { source, mutants: [at(2, 15, 18), at(1, 15, 25), at(1, 20, 23)] } }, parse);
    expect(inside).toMatchObject({ mutants: 3, mutantsInside: 2 });
    expect(render(inside, 'a report')).toContain('mutants the report has under an `as`: 2, so Stryker no longer passes them over');
  });

  it('refuses a source it cannot parse, where skipping it would count none', async () => {
    const parse = await babel();
    expect(() => measure({ 'src/a.ts': { source: 'const = ;\n' } }, parse)).toThrow(UnmeasuredError);
    expect(() => measure({ 'src/a.ts': { source: 'const = ;\n' } }, parse)).toThrow(/^src\/a\.ts cannot be parsed: /);
  });
});

describe('the gate', () => {
  const measured = (sites: number) => ({ files: 1, mutants: 0, expressions: 4, sites, mutantsInside: 0, rows: sites === 0 ? [] : [{ file: 'src/a.ts', line: 1, sites, text: 'x as const' }] });

  it('passes a count at what is recorded as left, and fails one above it with what to do', () => {
    expect(verdict(measured(0), 0)).toEqual({ passed: true, message: '0 places a mutator applies under 0 of 4 `as` expressions; 0 recorded as left.' });
    expect(verdict(measured(3), 3).passed).toBe(true);
    expect(verdict(measured(2), 3).passed).toBe(true);
    expect(verdict(measured(1), 0)).toEqual({
      passed: false,
      message:
        '1 place a mutator applies under 1 of 4 `as` expressions, where no sweep makes a mutant, and 0 recorded as left. Put what a mutator reads outside the assertion (scripts/mutation-unmeasured.mjs says how), or record why it stays and raise LEFT there.',
    });
    expect(verdict(measured(4), 3).passed).toBe(false);
  });

  it('is held to the number the script records when none is given', () => {
    expect(verdict(measured(LEFT)).passed).toBe(true);
    expect(verdict(measured(LEFT + 1)).passed).toBe(false);
  });
});

describe('the script', () => {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  afterAll(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));

  /** The script as the workflow runs it: its exit code and what it printed. */
  const run = (args: readonly string[], env: Readonly<Record<string, string>> = {}): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: directory, env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', ...env }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string };
      return { code: failed.status, out: `${failed.stdout}${failed.stderr}` };
    }
  };
  const report = (name: string, files: Sources): string => {
    const file = join(directory, name);
    writeFileSync(file, JSON.stringify({ schemaVersion: '1.0', files }));
    return file;
  };

  it('exits 0 for a report with nothing under an `as`, and 1 for one with a place there, naming it', () => {
    const clear = run([report('clear.json', { 'src/a.ts': { source: sourceOf(CLEAR), mutants: [] } })]);
    expect(clear.out).toContain('0 places a mutator applies under 0 of 3 `as` expressions; 0 recorded as left.');
    expect(clear.code).toBe(0);
    const under = run([report('under.json', { 'src/a.ts': { source: 'export const first = lines[i - 1] as string;\n', mutants: [] } })]);
    expect(under.out).toContain('    1  src/a.ts:1  lines[i - 1] as string\n');
    expect(under.out).toContain('\n1 place a mutator applies under 1 of 1 `as` expressions, where no sweep makes a mutant, and 0 recorded as left. ');
    expect(under.code).toBe(1);
  });

  it('says a failure as an annotation and in the summary where GitHub runs it', () => {
    const summary = join(directory, 'summary.md');
    const under = run([report('annotated.json', { 'src/a.ts': { source: 'export const first = lines[i - 1] as string;\n' } })], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    expect(under.code).toBe(1);
    expect(under.out).toContain('\n::error::1 place a mutator applies under 1 of 1 `as` expressions, ');
    expect(readFileSync(summary, 'utf8')).toMatch(/^### Under an `as`, where no sweep makes a mutant\n\n1 place a mutator applies /);
  });

  it('exits 2 for what is no count: a report that is not there, is not JSON or has no files, a source that cannot be parsed, and more than one argument', () => {
    expect(run([join(directory, 'missing.json')])).toMatchObject({ code: 2 });
    writeFileSync(join(directory, 'broken.json'), '{');
    expect(run([join(directory, 'broken.json')])).toMatchObject({ code: 2 });
    writeFileSync(join(directory, 'empty.json'), '{}');
    expect(run([join(directory, 'empty.json')])).toEqual({ code: 2, out: `${join(directory, 'empty.json')} is not a mutation report: it has no files.\n` });
    expect(run([report('unparsed.json', { 'src/a.ts': { source: 'const = ;\n' } })]).out).toMatch(/^src\/a\.ts cannot be parsed: /);
    expect(run([report('unparsed.json', { 'src/a.ts': { source: 'const = ;\n' } })]).code).toBe(2);
    expect(run(['a.json', 'b.json'])).toEqual({ code: 2, out: 'usage: node scripts/mutation-unmeasured.mjs [<mutation.json>]\n' });
  });
});

describe('this repository', () => {
  it('has no more under an `as` than the script records as left, in the sources the full sweep mutates', async () => {
    const files = await sourcesOnDisk(ROOT);
    // What the full sweep mutates, and nothing of spec-core's.
    expect(Object.keys(files).length).toBeGreaterThan(25);
    expect(Object.keys(files)).toContain('src/usage.ts');
    expect(Object.keys(files).filter((name) => name.startsWith('src/vendor/') || name === 'src/index.ts' || name === 'src/types.ts')).toEqual([]);
    const measured = measure(files, await babel());
    // An assertion on a name is still one, so a count of none is not a script that reads nothing.
    expect(measured.expressions).toBeGreaterThan(0);
    expect(verdict(measured).passed, `${render(measured, 'the sources on disk')}\n\n${verdict(measured).message}`).toBe(true);
  });

  it('records as left exactly what is left: the number moves down with the code, never up past it', async () => {
    const measured = measure(await sourcesOnDisk(ROOT), await babel());
    expect(measured.sites).toBe(LEFT);
  });

  it('has the full sweep\'s score step count the merged report, after the merge that writes it', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/mutation.yml'), 'utf8');
    const step = (workflow.split('      - name: Merge the shards and apply the gate\n')[1] ?? '').split('\n      - ')[0] as string;
    const merge = step.indexOf('node scripts/mutation-shards.mjs merge reports/shards\n');
    const count = step.indexOf('node scripts/mutation-unmeasured.mjs reports/mutation/mutation.json\n');
    expect(merge, step).toBeGreaterThan(-1);
    expect(count, step).toBeGreaterThan(merge);
    // The merge writes the report where the count reads it.
    expect(readFileSync(join(ROOT, 'stryker.config.mjs'), 'utf8')).toContain("jsonReporter: { fileName: 'reports/mutation/mutation.json' }");
  });
});
