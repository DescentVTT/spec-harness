/**
 * What a mutation sweep does not measure because it stands under a
 * TypeScript `as`.
 *
 * Stryker 10 makes no mutant of anything under an `as` expression: its
 * transformer skips every node it takes for a type, and its list of those
 * holds `TSAsExpression` (`shouldSkip` in the instrumenter's
 * `transformers/babel-transformer.js`, `isTypeNode` in its
 * `util/syntax-helpers.js`). The whole subtree goes unread: a table written
 * `{ ... } as const`, the `i - 1` of `lines[i - 1] as string`, the comparator
 * of `[...xs].sort((a, b) => ...)[0] as T`. `satisfies` and `!` are not on
 * that list. `TSEnumDeclaration` is, so an enum's initialisers are counted
 * with them; the sources have no enum. On 2026-10-12 the full sweep of
 * 36a6c8e had 8,355 mutants and none under an `as`, where 198 places a
 * mutator applies stood under 29 of them, 143 in the tables of
 * `src/usage.ts` that decide what each command refuses (ADR-0010, amended
 * 2026-10-12).
 *
 * This counts those places, in the sources a report holds or in the ones on
 * disk, and fails when there are more than `LEFT`. A place is where one of
 * Stryker's mutators applies, not a mutant: each makes one to three, so the
 * count says where to look and how much, not what a sweep would score.
 *
 * The count is of what the Stryker installed would mutate, and
 * `tests/mutation-unmeasured.test.ts` holds it to that: it hands one source
 * to the instrumenter itself, with its casts and with spaces where they
 * were, and the places counted under each cast are the places the
 * instrumenter then mutates (ADR-0010, amended 2026-10-14). Until then the
 * count read none for `new Array(n) as T[]` and for `~x as T`, which
 * Stryker mutates once the cast is gone, and none for an enum's
 * initialisers. Where the two still part, the count is the larger: a
 * pattern the Regex mutator makes nothing of is counted, and so is every
 * block that is not empty.
 *
 * The way out is never a comment that excuses the assertion: put what a
 * mutator reads outside it. A value hoisted to a constant with the assertion
 * on the name; `!` where the assertion only says an index or a match is
 * there; a type on the declaration where the value is `any`; `satisfies`
 * where there is a type to hold a table to; and `literal()` in
 * `src/literal.ts` for a table whose literal types something reads.
 *
 *   node scripts/mutation-unmeasured.mjs                  the sources the full sweep mutates, on disk
 *   node scripts/mutation-unmeasured.mjs <mutation.json>  the sources a sweep's report holds
 */

import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The places under an `as` that are left, each for a reason beside its
 * code. There are none. The number moves only down, and a count above it
 * fails the full sweep's score step and `tests/mutation-unmeasured.test.ts`.
 */
export const LEFT = 0;

export class UnmeasuredError extends Error {
  name = 'UnmeasuredError';
}

// From this script to the parser Stryker's instrumenter reads a source with,
// each step asked of the package before it. The bare name is whichever
// `@babel/parser` stands at the top of `node_modules`, and that need not be
// Stryker's: magicast, which the coverage provider brings, asks for the
// major before. In this tree the top one is Stryker's 8 today; in
// spec-graph's it is magicast's 7, with Stryker's under `@babel/core`.
const PARSER_PATH = ['@stryker-mutator/core/package.json', '@stryker-mutator/instrumenter/package.json', '@babel/core', '@babel/parser'];

const named = (step) => step.replace('/package.json', '');

/**
 * The parser Stryker's instrumenter reads a source with, so that what is
 * counted is the tree Stryker walks. It is Stryker's dependency and not a
 * direct one of this package, as the merge's are (mutation-shards.mjs): a
 * copy pinned here could drift from the one a sweep runs. Where a step of the
 * way to it is not installed - a Stryker that no longer parses with Babel -
 * this throws, and the script ends with exit 2 and that sentence: a count
 * that could not be made is not a count of none. `from` is where the way
 * starts, this script unless a test says otherwise.
 */
export async function babel(from = import.meta.url) {
  let at = from;
  for (const step of PARSER_PATH) {
    try {
      at = createRequire(at).resolve(step);
    } catch {
      throw new UnmeasuredError(
        `${named(step)} cannot be found, on the way to the parser Stryker reads a source with (${PARSER_PATH.map(named).join(', then ')}). Nothing was counted: run npm ci, and if Stryker no longer parses with Babel, read the sources with the parser it does bring.`,
      );
    }
  }
  const { parse } = await import(pathToFileURL(at).href);
  return (source) => parse(source, { sourceType: 'module', plugins: ['typescript'] });
}

// Each list below is a mutator of @stryker-mutator/instrumenter 10.0.0
// (`dist/src/mutators`), by the name a report gives its mutants.

// ArithmeticOperator
const ARITHMETIC = new Set(['+', '-', '*', '/', '%']);
// EqualityOperator
const EQUALITY = new Set(['<', '<=', '>', '>=', '==', '!=', '===', '!==']);
// ConditionalExpression, for an expression that is the test of no statement
const BOOLEAN = new Set([...EQUALITY, '&&', '||']);
// LogicalOperator
const LOGICAL = new Set(['&&', '||', '??']);
// AssignmentOperator
const ASSIGNMENT = new Set(['+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '&&=', '||=', '??=']);
const LOGICAL_ASSIGNMENT = new Set(['&&=', '||=', '??=']);
// UnaryOperator, beside `!`, which BooleanLiteral takes
const UNARY = new Set(['+', '-', '~']);
// MethodExpression: a method taken away, or swapped for its opposite.
const METHODS = new Set([
  ...['charAt', 'filter', 'reverse', 'slice', 'sort', 'substr', 'substring', 'trim'],
  ...['endsWith', 'startsWith', 'every', 'some', 'toLocaleLowerCase', 'toLocaleUpperCase', 'toLowerCase', 'toUpperCase'],
  ...['trimEnd', 'trimStart', 'min', 'max', 'setDate', 'setTime', 'setFullYear', 'setMonth', 'setHours', 'setMinutes'],
  ...['setSeconds', 'setMilliseconds', 'setUTCDate', 'setUTCFullYear', 'setUTCMonth', 'setUTCHours', 'setUTCMinutes'],
  ...['setUTCSeconds', 'setUTCMilliseconds'],
]);

const isText = (node) => node.type === 'StringLiteral' || node.type === 'TemplateLiteral';
const isCalled = (node, name) => node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === name;

// StringLiteral leaves a string alone where emptying it would change the
// program's shape and not what it does: a key, a module's name, a directive.
function stringIsRead(parent, key) {
  if (parent === undefined) return true;
  if (/^(?:Import|Export)|^TSExternalModuleReference$|^JSXAttribute$|^ExpressionStatement$|^TSLiteralType$|^ObjectMethod$/.test(parent.type)) return false;
  if ((parent.type === 'ObjectProperty' || parent.type === 'ClassProperty') && key === 'key') return false;
  return !(isCalled(parent, 'require') || isCalled(parent, 'Symbol') || (parent.type === 'CallExpression' && parent.callee.type === 'Import'));
}

/**
 * Whether one of Stryker's mutators applies at this node.
 *
 * `quiet` is whether no place was counted beneath it: Stryker takes a call
 * or a `throw` away as a statement only where that would be the statement's
 * one mutant. A regular expression counts though the Regex mutator makes
 * nothing of a pattern with no class, quantifier, anchor or group to change,
 * and every block that is not empty counts though BlockStatement leaves
 * alone the body of some constructors that call `super`: both say that
 * something is unread where it may not be, and never the other way.
 */
function isSite(node, parent, key, quiet) {
  // ConditionalExpression: the test of a loop or an `if`, whatever it is. A ternary's test is not one.
  if (key === 'test' && /^(?:If|For|While|DoWhile)Statement$/.test(parent?.type ?? '')) return true;
  switch (node.type) {
    case 'StringLiteral':
      return stringIsRead(parent, key);
    case 'TemplateLiteral':
    case 'BooleanLiteral':
    case 'ArrayExpression':
    case 'UpdateExpression':
      return true;
    case 'RegExpLiteral':
      return node.pattern.length > 0;
    case 'ObjectExpression':
      return node.properties.length > 0;
    case 'BlockStatement':
      return node.body.length > 0;
    case 'ArrowFunctionExpression':
      return node.body.type !== 'BlockStatement' && !(node.body.type === 'Identifier' && node.body.name === 'undefined');
    case 'BinaryExpression': {
      if (BOOLEAN.has(node.operator)) return true;
      // A `+` beside a text joins, and ArithmeticOperator leaves it.
      const left = node.left.type === 'BinaryExpression' ? node.left.right : node.left;
      return ARITHMETIC.has(node.operator) && !isText(node.right) && !isText(left);
    }
    case 'LogicalExpression':
      return LOGICAL.has(node.operator);
    case 'UnaryExpression':
      return node.prefix && (node.operator === '!' || UNARY.has(node.operator));
    case 'AssignmentExpression':
      return ASSIGNMENT.has(node.operator) && (LOGICAL_ASSIGNMENT.has(node.operator) || !isText(node.right));
    case 'ForStatement':
      return node.test === null || node.test === undefined;
    case 'SwitchCase':
      return node.consequent.length > 0;
    case 'OptionalMemberExpression':
      return node.optional === true;
    case 'OptionalCallExpression':
    case 'CallExpression':
    case 'NewExpression': {
      if (node.type === 'OptionalCallExpression' && node.optional === true) return true;
      const { callee } = node;
      // ArrayDeclaration: `Array(n)` and `new Array(n)`, as a list written out.
      if (node.type !== 'OptionalCallExpression' && callee.type === 'Identifier' && callee.name === 'Array') return true;
      if (node.type === 'NewExpression') return false;
      return (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && callee.property.type === 'Identifier' && METHODS.has(callee.property.name);
    }
    case 'ExpressionStatement':
      return quiet && node.expression.type === 'CallExpression' && node.expression.callee.type !== 'Super';
    case 'ThrowStatement':
      return quiet && node.argument.type === 'NewExpression';
    default:
      return false;
  }
}

const NOT_CHILDREN = new Set(['loc', 'start', 'end', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);

function children(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (NOT_CHILDREN.has(key)) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && typeof item === 'object' && typeof item.type === 'string') out.push([key, item]);
    }
  }
  return out;
}

// What of TypeScript's own syntax holds something a program runs: the
// expressions that carry a value through a type, and an enum down to its
// initialisers. Every other `TS` node is a type, and holds nothing a mutator
// reads, wherever in an expression it stands.
const HOLDS_CODE = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression', 'TSEnumDeclaration', 'TSEnumBody']);

function sitesUnder(node, parent, key) {
  if (node.type === 'TSEnumMember') return node.initializer ? sitesUnder(node.initializer, node, 'initializer') : 0;
  if (node.type.startsWith('TS') && !HOLDS_CODE.has(node.type)) return 0;
  let beneath = 0;
  for (const [childKey, child] of children(node)) beneath += sitesUnder(child, node, childKey);
  return beneath + (isSite(node, parent, key, beneath === 0) ? 1 : 0);
}

// The outermost only: Stryker stops at the first it meets, so what stands under an `as` inside another is counted once, with the outer one.
function outermost(node, found) {
  if (node.type === 'TSAsExpression' || node.type === 'TSEnumDeclaration') {
    found.push(node);
    return;
  }
  for (const [, child] of children(node)) outermost(child, found);
}

function shown(text) {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 110 ? `${flat.slice(0, 70)} ... ${flat.slice(-30)}` : flat;
}

/**
 * Whether the whole of a report's mutant stands within an expression, to
 * the column: on the expression's own lines one that starts before it or
 * ends after it is beside it. Both count lines and columns from 1, and an
 * end is the first character after.
 */
export function inside(row, mutant) {
  const { start, end } = mutant.location;
  const afterStart = start.line > row.line || (start.line === row.line && start.column >= row.column);
  const beforeEnd = end.line < row.endLine || (end.line === row.endLine && end.column <= row.endColumn);
  return afterStart && beforeEnd;
}

/**
 * Every outermost `as` and enum of each source, with the places under it.
 * `files` is a report's: a name to a source and, where a sweep made them,
 * its mutants. A row says where its expression stands as a report would,
 * lines and columns from 1. `mutantsInside` is the mutants a report has
 * under one: none while Stryker reads a source as this script takes it to.
 */
export function measure(files, parse) {
  const rows = [];
  let expressions = 0;
  let mutants = 0;
  let mutantsInside = 0;
  for (const [name, file] of Object.entries(files)) {
    mutants += file.mutants?.length ?? 0;
    let ast;
    try {
      ast = parse(file.source);
    } catch (error) {
      throw new UnmeasuredError(`${name} cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const found = [];
    outermost(ast.program, found);
    expressions += found.length;
    for (const node of found) {
      const row = { file: name, line: node.loc.start.line, column: node.loc.start.column + 1, endLine: node.loc.end.line, endColumn: node.loc.end.column + 1 };
      mutantsInside += (file.mutants ?? []).filter((mutant) => inside(row, mutant)).length;
      const sites = node.type === 'TSAsExpression' ? sitesUnder(node.expression, node, 'expression') : sitesUnder(node, undefined, undefined);
      if (sites > 0) rows.push({ ...row, sites, text: shown(file.source.slice(node.start, node.end)) });
    }
  }
  rows.sort((a, b) => b.sites - a.sites || a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return { files: Object.keys(files).length, mutants, expressions, sites: rows.reduce((sum, row) => sum + row.sites, 0), mutantsInside, rows };
}

/** Whether the count is within what is recorded as left, and the sentence for either. */
export function verdict(measured, left = LEFT) {
  const counted = `${measured.sites} ${measured.sites === 1 ? 'place' : 'places'} a mutator applies under ${measured.rows.length} of ${measured.expressions} \`as\` expressions and enums`;
  if (measured.sites > left) {
    return {
      passed: false,
      message: `${counted}, where no sweep makes a mutant, and ${left} recorded as left. Put what a mutator reads outside the assertion (scripts/mutation-unmeasured.mjs says how), or record why it stays and raise LEFT there.`,
    };
  }
  return { passed: true, message: `${counted}; ${left} recorded as left.` };
}

/** The sources on disk the full sweep's configuration mutates, as a report would hold them. */
export async function sourcesOnDisk(root) {
  // Stryker's reading of `mutate`, as the merge has it. Loaded only here: a report needs none of it.
  const { mutates } = await import('./mutation-shards.mjs');
  const { default: config } = await import(pathToFileURL(path.join(root, 'stryker.config.mjs')).href);
  const files = {};
  for (const entry of readdirSync(path.join(root, 'src'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/');
    if (mutates(config.mutate, name)) files[name] = { source: readFileSync(path.join(root, name), 'utf8') };
  }
  return Object.fromEntries(Object.keys(files).sort().map((name) => [name, files[name]]));
}

export function render(measured, what) {
  const lines = [
    `${what}: ${measured.files} files${measured.mutants > 0 ? `, ${measured.mutants} mutants` : ''}`,
    `\`as\` expressions and enums, the outermost of each: ${measured.expressions}; with a place a mutator applies under them: ${measured.rows.length}; places: ${measured.sites}`,
  ];
  if (measured.mutants > 0) lines.push(`mutants the report has under an \`as\`: ${measured.mutantsInside}${measured.mutantsInside > 0 ? ', so Stryker no longer passes them over, and this count is of what it now measures' : ''}`);
  for (const row of measured.rows) lines.push(`  ${String(row.sites).padStart(3)}  ${row.file}:${row.line}  ${row.text}`);
  return lines.join('\n');
}

async function main(argv) {
  if (argv.length > 1 || argv[0]?.startsWith('-')) {
    console.error('usage: node scripts/mutation-unmeasured.mjs [<mutation.json>]');
    return 2;
  }
  const annotate = process.env.GITHUB_ACTIONS === 'true' ? '::error::' : '';
  let measured;
  try {
    const parse = await babel();
    const files = argv[0] === undefined ? await sourcesOnDisk(fileURLToPath(new URL('..', import.meta.url))) : JSON.parse(readFileSync(argv[0], 'utf8')).files;
    if (files === null || typeof files !== 'object') throw new UnmeasuredError(`${argv[0]} is not a mutation report: it has no files.`);
    measured = measure(files, parse);
    console.log(render(measured, argv[0] === undefined ? 'the sources on disk' : argv[0]));
  } catch (error) {
    if (!(error instanceof UnmeasuredError) && !(error instanceof SyntaxError) && error?.code !== 'ENOENT') throw error;
    console.error(`${annotate}${error.message}`);
    return 2;
  }
  const { passed, message } = verdict(measured);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Under an \`as\`, where no sweep makes a mutant\n\n${message}\n\n`);
  if (passed) console.log(`\n${message}`);
  else console.error(`\n${annotate}${message}`);
  return passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
