/**
 * The count of what a mutation sweep does not measure because it stands
 * under a TypeScript `as` (scripts/mutation-unmeasured.mjs).
 *
 * The count is a gate, in the full sweep's score step and here, so what is
 * worth holding is that it counts: a small source with each kind of place a
 * mutator applies under an `as`, counted to the number, beside the ways out
 * of one, counted as none. And that it counts what Stryker would mutate: one
 * source is handed to the instrumenter installed, with its casts and with
 * spaces where they were, and the places counted under each cast are the
 * places the instrumenter then mutates, no more and no fewer. Then the
 * repository's own sources, on every change, where the full sweep would say
 * it a week later.
 *
 * This file reads the sources on disk, runs node and loads Stryker's
 * instrumenter, so it is not in the unit suite; the full sweep leaves it out,
 * since its sandbox holds instrumented copies of the sources and no mutant
 * is under this script (vitest.mutation.config.ts). It has no hook that
 * prepares anything: each test loads what it reads within its own time,
 * which the suite sets (vitest.config.ts), and the one hook removes a
 * directory.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, parse as parsePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { babel, inside, LEFT, measure, render, sourcesOnDisk, UnmeasuredError, verdict, type Placed, type Row, type Sources } from '../scripts/mutation-unmeasured.mjs';
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
  // The string. A ternary that only chooses is no place, and the assertion inside it is not counted again.
  ["const outer = (flag ? (inner as string) : 'none') as string;", 1],
  // The object. A key is not a place, and neither is the number.
  ["const keyed = { 'a-key': 1 } as const;", 1],
  // The pattern, and the method that would be removed.
  ['const head = (/^ */.exec(text.trim()) as RegExpExecArray)[0];', 2],
  // The fallback and the template.
  ['const shown = (given ?? `none of ${count}`) as string;', 2],
  // The key a value is read by, where the assertion stands around the read.
  ["const id = message['id'] as string;", 1],
  // The subtraction: a `!` under the assertion is read through, as Stryker reads through one.
  ['const sure = lines[i - 1]! as string;', 1],
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
  // The key is read outside the assertion, which holds the name alone.
  "const id = (message as { id: string })['id'];",
  // What no mutator changes: an arrow that returns `undefined`, a table and a block with nothing in them.
  'const none = (() => undefined) as () => undefined;',
  'const empty = {} as Record<string, never>;',
  'const idle = (() => {}) as () => void;',
];

/**
 * One source for Stryker's own instrumenter. Each cast stands between two
 * comments, so that the same source can be read with its casts and with
 * spaces where they were, every other character where it was. The first
 * seventeen lines are spec-core's, from which the count is adapted; the rest
 * are what this count read otherwise until 2026-10-14.
 */
const CAST = /\/\*<\*\/.*?\/\*>\*\//g;
const WRITTEN = [
  'const ESC = String.fromCharCode(27);',
  "export const COLOURS = { red: `${ESC}[31m`, none: '', shades: [1, -2] }/*<*/ as const/*>*/;",
  'export function before(lines: readonly string[], at: number): string {',
  '  const last = lines[lines.length - 1]/*<*/ as string/*>*/;',
  '  const named = last/*<*/ as string | undefined/*>*/;',
  '  return (lines[at - 1] ?? named?.trimEnd())/*<*/ as string/*>*/;',
  '}',
  "export const first = (names: string[]) => names.filter((name) => name !== '' && !name.startsWith('.')).sort()[0]/*<*/ as string/*>*/;",
  "export const held = { a: 'x' } satisfies Record<string, string>;",
  'export const sure = (names: string[]) => names[names.length - 1]!;',
  "export const kind = 'file'/*<*/ as 'file' | 'directory'/*>*/;",
  "export const walk = (() => { if (kind) { held.a.trim(); } for (;;) { throw new Error('x'); } })/*<*/ as () => void/*>*/;",
  "export const pair = [(COLOURS.shades[0] + 1)/*<*/ as number/*>*/, 'b']/*<*/ as const/*>*/;",
  'export const still = (() => { held.a.at(0); throw new Error(); })/*<*/ as () => void/*>*/;',
  'export const either = (kind ? 1 : 2)/*<*/ as number/*>*/;',
  'let count = 0;',
  'export const step = (count++ > 0 || (count += 2) > 0 ? /a+/ : null)/*<*/ as RegExp | null/*>*/;',
  'export const seen = new Array<boolean>(3)/*<*/ as boolean[]/*>*/;',
  'export const flipped = (~count)/*<*/ as number/*>*/;',
  "export const joined = ('a' + kind)/*<*/ as string/*>*/;",
  'export const dated = ((day: Date) => day.setMinutes(1))/*<*/ as (day: Date) => number/*>*/;',
  "export const chosen = ((n: number) => { switch (n) { case 1: return 'a'; default: return 'b'; } })/*<*/ as (n: number) => string/*>*/;",
  'export const looped = (() => { while (count < 3) { count--; } })/*<*/ as () => void/*>*/;',
  'export const asked = ((ask?: () => number) => ask?.())/*<*/ as (ask?: () => number) => number/*>*/;',
  'export const none = (() => undefined)/*<*/ as () => undefined/*>*/;',
  'export const empty = {}/*<*/ as Record<string, never>/*>*/;',
  'export const idle = (() => {})/*<*/ as () => void/*>*/;',
  '',
].join('\n');
const UNCAST = WRITTEN.replace(CAST, (cast) => ' '.repeat(cast.length));

/** Line by line, the places counted under each cast of the source above that has one. */
const COUNTED: readonly (readonly [number, number])[] = [
  // The table, its template, its empty string, its list and the minus in it.
  [2, 5],
  // The subtraction in the index.
  [4, 1],
  // `??`, the subtraction, the optional chain and the `trimEnd` behind it.
  [6, 4],
  // Three methods, the arrow, `&&`, `!==`, `!` and two strings.
  [8, 9],
  // The value, and nothing of the type beside it.
  [11, 1],
  // Three blocks, the test of the `if`, the `trim`, a `for` with no test and
  // the string. Neither statement: each would not be its own only mutant.
  [12, 7],
  // The list, the addition under the cast inside it, and the string.
  [13, 3],
  // The block, and the call and the throw, each a statement's only mutant.
  [14, 3],
  // `||`, `>` twice, `++`, `+=` and the pattern.
  [17, 6],
  // A list made with `new Array`, which read as none.
  [18, 1],
  // `~`, which read as none.
  [19, 1],
  // The string. A `+` beside a text joins, and no mutator changes it.
  [20, 1],
  // The arrow, and a setter of a date among the methods.
  [21, 2],
  // The block, both cases, and both strings.
  [22, 5],
  // Two blocks, the test of the `while`, and `--`.
  [23, 4],
  // The arrow and the optional call.
  [24, 2],
];
const TOTAL = COUNTED.reduce((sum, [, sites]) => sum + sites, 0);

/**
 * What the source above does not write, one cast to a source, with the
 * places counted under it. spec-core's test found its count wrong for both
 * as first written.
 */
const MORE: readonly (readonly [string, number])[] = [
  // A key written as a string is no place: the table and its value are.
  ["export const TABLE = { 'a-b': 'x' }/*<*/ as const/*>*/;", 2],
  // A type inside the expression is no place, whatever it is written with:
  // the arrow is, and neither `true` nor the ternary that only chooses.
  ['export const pick = ((flag: true): true | 2 => (flag ? flag : 2))/*<*/ as (flag: true) => true | 2/*>*/;', 1],
];

const sourceOf = (lines: readonly string[]): string => `${lines.join('\n')}\n`;
const one = (source: string): Sources => ({ 'src/written.ts': { source } });

/** A mutant as Stryker's instrumenter hands it back: lines and columns from 0. */
interface Made {
  mutatorName: string;
  location: { start: { line: number; column: number }; end: { line: number; column: number } };
}

/** Stryker's own instrumenter, found as Stryker finds it, and the mutants it makes of one source. */
async function instrumenter(): Promise<(source: string) => Promise<Made[]>> {
  const core = createRequire(createRequire(import.meta.url).resolve('@stryker-mutator/core/package.json'));
  const { Instrumenter } = (await import(pathToFileURL(core.resolve('@stryker-mutator/instrumenter')).href)) as {
    Instrumenter: new (logger: object) => { instrument(files: object[], options: object): Promise<{ mutants: Made[] }> };
  };
  const quiet = (): void => undefined;
  const logger = { debug: quiet, info: quiet, warn: quiet, error: quiet, isDebugEnabled: () => false };
  const options = { plugins: null, excludedMutations: [], mutationRange: [], ignorers: [], noHeader: true };
  return async (source) => (await new Instrumenter(logger).instrument([{ name: 'src/written.ts', mutate: true, content: source }], options)).mutants;
}

/** The same mutant as a report places it, which is how the count's rows are placed. */
const placed = ({ location: { start, end } }: Made): Placed => ({ location: { start: { line: start.line + 1, column: start.column + 1 }, end: { line: end.line + 1, column: end.column + 1 } } });
const under = (mutant: Made, row: Row): boolean => inside(row, placed(mutant));
const place = ({ location: { start, end } }: Made): string => `${start.line}:${start.column}-${end.line}:${end.column}`;

describe('the count', () => {
  it('finds each place a mutator applies under an `as`, the outermost once, and says where', async () => {
    const parse = await babel();
    const measured = measure({ 'src/a.ts': { source: sourceOf(UNDER.map(([line]) => line)) } }, parse);
    expect(measured.rows.map((row) => [row.line, row.sites])).toEqual([
      [1, 6],
      [3, 4],
      [6, 2],
      [7, 2],
      [2, 1],
      [4, 1],
      [5, 1],
      [8, 1],
      [9, 1],
    ]);
    expect(measured).toMatchObject({ files: 1, mutants: 0, expressions: 9, sites: 19, mutantsInside: 0 });
    // Where it stands, as a report would say it: from column 15 to the first character after `const`.
    expect(measured.rows[0]).toEqual({ file: 'src/a.ts', line: 1, column: 15, endLine: 1, endColumn: 58, sites: 6, text: "{ a: ['x', 'y'], b: { on: true } } as const" });
    // One by one, so that no line's count hides another's.
    for (const [line, sites] of UNDER) expect(measure({ 'src/a.ts': { source: `${line}\n` } }, parse).sites, line).toBe(sites);
  });

  it('counts nothing under satisfies, a non-null assertion, a call or an annotation, nor under an `as` that holds only a name or a type', async () => {
    const parse = await babel();
    for (const line of CLEAR) expect(measure({ 'src/a.ts': { source: `${line}\n` } }, parse).rows, line).toEqual([]);
    // The assertions are still seen: each of the last seven lines has one.
    expect(measure({ 'src/a.ts': { source: sourceOf(CLEAR) } }, parse)).toMatchObject({ expressions: 7, sites: 0 });
  });

  it('adds the files up, the most places first, and shortens a long expression to its ends', async () => {
    const parse = await babel();
    const long = `const LONG = { ${Array.from({ length: 12 }, (_, index) => `key${index}: 'value ${index}'`).join(', ')} } as const;\n`;
    const measured = measure({ 'src/b.ts': { source: 'const before = lines[i - 1] as string;\n' }, 'src/a.ts': { source: long }, 'src/c.ts': { source: 'export const none = 1;\n' } }, parse);
    expect(measured).toMatchObject({ files: 3, expressions: 2, sites: 14 });
    expect(measured.rows.map((row) => `${row.file}:${row.line} ${row.sites}`)).toEqual(['src/a.ts:1 13', 'src/b.ts:1 1']);
    expect(measured.rows[0]?.text).toBe("{ key0: 'value 0', key1: 'value 1', key2: 'value 2', key3: 'value 3',  ... , key11: 'value 11' } as const");
  });

  it("counts an enum's initialisers, which Stryker passes over as it does what stands under an `as`", async () => {
    const parse = await babel();
    const source = "export enum Mark { Pass = 'pass', Fail = 1 + 2, Skip }\nexport const one = [1];\n";
    const measured = measure(one(source), parse);
    // The string and the addition; a member with no initialiser has nothing to count.
    expect(measured).toMatchObject({ expressions: 1, sites: 2 });
    expect(measured.rows).toEqual([{ file: 'src/written.ts', line: 1, column: 8, endLine: 1, endColumn: 55, sites: 2, text: "enum Mark { Pass = 'pass', Fail = 1 + 2, Skip }" }]);
    expect(measure(one('export enum Bare { A, B }\n'), parse)).toMatchObject({ expressions: 1, sites: 0, rows: [] });
    const made = await (await instrumenter())(source);
    // The list on the second line is mutated, so the instrumenter read the source; nothing in the enum is.
    expect(made.map((mutant) => mutant.location.start.line)).toEqual([1]);
  });

  it('counts a pattern Stryker would make nothing of, and so errs towards saying that something is unread', async () => {
    const parse = await babel();
    const source = 'export const found = /b/.exec(process.title)/*<*/ as RegExpExecArray/*>*/;\n';
    expect(measure(one(source), parse).rows.map((row) => row.sites)).toEqual([1]);
    expect(await (await instrumenter())(source.replace(CAST, (cast) => ' '.repeat(cast.length)))).toEqual([]);
  });

  it('says how many of a report\'s mutants are under an `as`: none, while Stryker passes them over', async () => {
    const parse = await babel();
    const source = "const TABLE = { a: 'x' } as const;\nconst other = 'y';\n";
    const at = (line: number, from: number, to: number) => ({ location: { start: { line, column: from }, end: { line, column: to } } });
    // A report's columns start at 1: the string on line 2, then the object and the string on line 1.
    const outside = measure({ 'src/a.ts': { source, mutants: [at(2, 15, 18)] } }, parse);
    expect(outside).toMatchObject({ mutants: 1, mutantsInside: 0, sites: 2 });
    expect(render(outside, 'a report')).toContain('mutants the report has under an `as`: 0\n');
    const within = measure({ 'src/a.ts': { source, mutants: [at(2, 15, 18), at(1, 15, 25), at(1, 20, 23)] } }, parse);
    expect(within).toMatchObject({ mutants: 3, mutantsInside: 2 });
    expect(render(within, 'a report')).toContain('mutants the report has under an `as`: 2, so Stryker no longer passes them over');
  });

  it('takes a mutant for under an `as` only where the whole of it is, to the column: one beside the assertion on its own line is not', async () => {
    const parse = await babel();
    // The assertion runs from column 15 to column 34, the first character after it.
    const source = "const TABLE = { a: 'x' } as const;\n";
    const at = (from: number, to: number) => ({ location: { start: { line: 1, column: from }, end: { line: 1, column: to } } });
    const under = (mutants: Placed[]): number => measure({ 'src/a.ts': { source, mutants } }, parse).mutantsInside;
    // The whole of it, and each of its two ends.
    expect(under([at(15, 34), at(15, 16), at(33, 34)])).toBe(3);
    // One that starts before it, one that ends after it, and one around it.
    expect(under([at(14, 25)])).toBe(0);
    expect(under([at(20, 35)])).toBe(0);
    expect(under([at(7, 35)])).toBe(0);
    // The statement it is the value of, and the word before it.
    expect(under([at(1, 35), at(1, 6)])).toBe(0);
  });

  it('refuses a source it cannot parse, where skipping it would count none', async () => {
    const parse = await babel();
    expect(() => measure({ 'src/a.ts': { source: 'const = ;\n' } }, parse)).toThrow(UnmeasuredError);
    expect(() => measure({ 'src/a.ts': { source: 'const = ;\n' } }, parse)).toThrow(/^src\/a\.ts cannot be parsed: /);
  });
});

describe('the count, held to the Stryker installed', () => {
  it('is place by place what is written here, under the outermost assertion only', async () => {
    const measured = measure(one(WRITTEN), await babel());
    expect([...measured.rows].sort((a, b) => a.line - b.line).map((row) => [row.line, row.sites])).toEqual(COUNTED);
    // Twenty-two assertions are written and one is inside another. Five have
    // no row: a name on line 5, on line 15 a ternary that only chooses, and
    // on the last three an arrow that returns `undefined`, a table and a
    // block with nothing in them. The test after the next holds Stryker to
    // making nothing of those either.
    expect(measured).toMatchObject({ expressions: 21, sites: TOTAL });
    expect(measure(one(UNCAST), await babel())).toMatchObject({ expressions: 0, sites: 0, rows: [] });
  });

  it('is of places Stryker makes no mutant at while the assertions stand', async () => {
    const made = await (await instrumenter())(WRITTEN);
    // Were this to fail, Stryker reads under an `as` now, and the script, its
    // step in the workflow and `LEFT` have nothing left to say.
    for (const row of measure(one(WRITTEN), await babel()).rows) expect(made.filter((mutant) => under(mutant, row)), row.text).toEqual([]);
    // What stands under no assertion is mutated: the instrumenter did read the source.
    expect(made.length).toBeGreaterThan(0);
  });

  it('is of exactly the places Stryker mutates once the assertions are taken away', async () => {
    const instrument = await instrumenter();
    const written = await instrument(WRITTEN);
    const uncast = await instrument(UNCAST);
    const { rows } = measure(one(WRITTEN), await babel());

    for (const row of rows) {
      const places = new Set(uncast.filter((mutant) => under(mutant, row)).map(place));
      expect([row.line, places.size], `${row.text}: ${[...places].join(' ')}`).toEqual([row.line, row.sites]);
    }
    // Every mutant the assertions had kept from being made is at one of those
    // places: none was behind an assertion the script counted nothing under.
    const freed = uncast.filter((mutant) => rows.some((row) => under(mutant, row)));
    expect(uncast.length - written.length).toBe(freed.length);
    // A place is not a mutant: Stryker makes more than one of some.
    expect(freed.length).toBeGreaterThan(TOTAL);
  });

  it('is of the places Stryker mutates for a key written as a string and for a type inside the expression, which are none', async () => {
    const parse = await babel();
    const instrument = await instrumenter();
    for (const [source, sites] of MORE) {
      const { rows } = measure(one(source), parse);
      expect(rows.map((row) => row.sites), source).toEqual([sites]);
      const row = rows[0] as Row;
      expect((await instrument(source)).filter((mutant) => under(mutant, row)), source).toEqual([]);
      const uncast = await instrument(source.replace(CAST, (cast) => ' '.repeat(cast.length)));
      expect(new Set(uncast.filter((mutant) => under(mutant, row)).map(place)).size, source).toBe(sites);
    }
  });
});

describe('the parser', () => {
  // Stryker's own, found from Stryker and not by its bare name, which npm
  // may have given to another package's copy at the top of node_modules.
  it('is not taken for found where a step of the way to it is not installed: nothing is counted, and the sentence says which step', async () => {
    const elsewhere = pathToFileURL(join(parsePath(ROOT).root, 'nowhere', 'scripts', 'mutation-unmeasured.mjs')).href;
    await expect(babel(elsewhere)).rejects.toThrow(UnmeasuredError);
    await expect(babel(elsewhere)).rejects.toThrow(
      '@stryker-mutator/core cannot be found, on the way to the parser Stryker reads a source with (@stryker-mutator/core, then @stryker-mutator/instrumenter, then @babel/core, then @babel/parser). Nothing was counted: run npm ci, and if Stryker no longer parses with Babel, read the sources with the parser it does bring.',
    );
  });
});

describe('the gate', () => {
  const measured = (sites: number) => ({
    files: 1,
    mutants: 0,
    expressions: 4,
    sites,
    mutantsInside: 0,
    rows: sites === 0 ? [] : [{ file: 'src/a.ts', line: 1, column: 1, endLine: 1, endColumn: 11, sites, text: 'x as const' }],
  });

  it('passes a count at what is recorded as left, and fails one above it with what to do', () => {
    expect(verdict(measured(0), 0)).toEqual({ passed: true, message: '0 places a mutator applies under 0 of 4 `as` expressions and enums; 0 recorded as left.' });
    expect(verdict(measured(3), 3).passed).toBe(true);
    expect(verdict(measured(2), 3).passed).toBe(true);
    expect(verdict(measured(1), 0)).toEqual({
      passed: false,
      message:
        '1 place a mutator applies under 1 of 4 `as` expressions and enums, where no sweep makes a mutant, and 0 recorded as left. Put what a mutator reads outside the assertion (scripts/mutation-unmeasured.mjs says how), or record why it stays and raise LEFT there.',
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
    expect(clear.out).toContain('0 places a mutator applies under 0 of 7 `as` expressions and enums; 0 recorded as left.');
    expect(clear.code).toBe(0);
    const under = run([report('under.json', { 'src/a.ts': { source: 'export const first = lines[i - 1] as string;\n', mutants: [] } })]);
    expect(under.out).toContain('    1  src/a.ts:1  lines[i - 1] as string\n');
    expect(under.out).toContain('\n1 place a mutator applies under 1 of 1 `as` expressions and enums, where no sweep makes a mutant, and 0 recorded as left. ');
    expect(under.code).toBe(1);
  });

  it('exits 1 for what read as none until the count was held to Stryker: a list made with `new Array`, a `~`, and an enum', () => {
    for (const [name, source, shown] of [
      ['array.json', 'export const seen = new Array<boolean>(3) as boolean[];\n', 'new Array<boolean>(3) as boolean[]'],
      ['tilde.json', 'export const flipped = (~count) as number;\n', '(~count) as number'],
      ['enum.json', "export enum Mark { Pass = 'pass' }\n", "enum Mark { Pass = 'pass' }"],
    ] as const) {
      const got = run([report(name, { 'src/a.ts': { source, mutants: [] } })]);
      expect(got.out, name).toContain(`    1  src/a.ts:1  ${shown}\n`);
      expect(got.code, name).toBe(1);
    }
  });

  it('says a failure as an annotation and in the summary where GitHub runs it', () => {
    const summary = join(directory, 'summary.md');
    const under = run([report('annotated.json', { 'src/a.ts': { source: 'export const first = lines[i - 1] as string;\n' } })], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    expect(under.code).toBe(1);
    expect(under.out).toContain('\n::error::1 place a mutator applies under 1 of 1 `as` expressions and enums, ');
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
