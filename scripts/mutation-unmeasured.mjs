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
 * that list. On 2026-10-12 the full sweep of 36a6c8e had 8,355 mutants and
 * none under an `as`, where 198 places a mutator applies stood under 29 of
 * them, 143 in the tables of `src/usage.ts` that decide what each command
 * refuses (ADR-0010, amended 2026-10-12).
 *
 * This counts those places, in the sources a report holds or in the ones on
 * disk, and fails when there are more than `LEFT`. A place is where one of
 * Stryker's mutators applies, not a mutant: each makes one to three, so the
 * count says where to look and how much, not what a sweep would score.
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

/**
 * The parser Stryker's instrumenter reads a source with, so that what is
 * counted is the tree Stryker walks. It is Stryker's dependency and not a
 * direct one of this package, as the merge's are (mutation-shards.mjs): a
 * copy pinned here could drift from the one a sweep runs. Where it cannot be
 * loaded - a Stryker that no longer brings it - this throws, and the script
 * ends with exit 2 and that sentence: a count that could not be made is not
 * a count of none.
 */
export async function babel() {
  let parser;
  try {
    parser = await import('@babel/parser');
  } catch (error) {
    throw new UnmeasuredError(
      `@babel/parser cannot be loaded (${error instanceof Error ? error.message.split('\n')[0] : String(error)}). It comes with @stryker-mutator/core; run npm ci, and if Stryker no longer brings it, read the sources with the parser it does bring.`,
    );
  }
  return (source) => parser.parse(source, { sourceType: 'module', plugins: ['typescript'] });
}

// The methods Stryker's MethodExpression mutator removes or swaps.
const METHODS = new Set([
  'charAt', 'endsWith', 'startsWith', 'every', 'some', 'filter', 'reverse', 'slice', 'sort', 'substr', 'substring',
  'toLocaleLowerCase', 'toLocaleUpperCase', 'toLowerCase', 'toUpperCase', 'trim', 'trimEnd', 'trimStart', 'min', 'max',
]);
const ARITHMETIC = new Set(['+', '-', '*', '/', '%']);
const EQUALITY = new Set(['<', '<=', '>', '>=', '==', '!=', '===', '!==']);

/** Whether one of Stryker's mutators applies at this node. */
function isSite(node, parent, key) {
  switch (node.type) {
    case 'StringLiteral':
      // Not a property's key, an import's source or a literal type.
      return !((parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod') && key === 'key') && parent?.type !== 'ImportDeclaration' && parent?.type !== 'TSLiteralType';
    case 'TemplateLiteral':
    case 'BooleanLiteral':
    case 'ConditionalExpression':
    case 'LogicalExpression':
    case 'UpdateExpression':
    case 'ArrayExpression':
    case 'RegExpLiteral':
    case 'IfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
    case 'SwitchCase':
      return true;
    case 'ObjectExpression':
      return node.properties.length > 0;
    case 'BlockStatement':
      return node.body.length > 0;
    case 'ArrowFunctionExpression':
      return node.body.type !== 'BlockStatement';
    case 'BinaryExpression':
      return ARITHMETIC.has(node.operator) || EQUALITY.has(node.operator);
    case 'UnaryExpression':
      return node.operator === '!' || node.operator === '-' || node.operator === '+';
    case 'AssignmentExpression':
      return node.operator !== '=';
    case 'OptionalMemberExpression':
    case 'OptionalCallExpression':
      return node.optional === true;
    case 'CallExpression': {
      const callee = node.callee;
      return (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && callee.property.type === 'Identifier' && METHODS.has(callee.property.name);
    }
    default:
      return false;
  }
}

const NOT_CHILDREN = new Set(['loc', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

function children(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (NOT_CHILDREN.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === 'string') out.push([key, item]);
    } else if (value && typeof value.type === 'string') {
      out.push([key, value]);
    }
  }
  return out;
}

// The expressions that carry a value through a type: what they wrap is read on.
const WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression']);

function sitesUnder(node, parent, key) {
  // A type holds nothing a mutator reads.
  if (node.type.startsWith('TS') && !WRAPPERS.has(node.type)) return 0;
  let count = isSite(node, parent, key) ? 1 : 0;
  for (const [childKey, child] of children(node)) {
    if (node.type === 'TSAsExpression' && childKey === 'typeAnnotation') continue;
    count += sitesUnder(child, node, childKey);
  }
  return count;
}

// The outermost only: what stands under an `as` inside another is counted once, with the outer one.
function outermost(node, found) {
  if (node.type === 'TSAsExpression') {
    found.push(node);
    return;
  }
  for (const [, child] of children(node)) outermost(child, found);
}

function shown(text) {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 110 ? `${flat.slice(0, 70)} ... ${flat.slice(-30)}` : flat;
}

// A report's columns start at 1 and the parser's at 0.
function inside(loc, mutant) {
  const { start, end } = mutant.location;
  const afterStart = start.line > loc.start.line || (start.line === loc.start.line && start.column - 1 >= loc.start.column);
  const beforeEnd = end.line < loc.end.line || (end.line === loc.end.line && end.column - 1 <= loc.end.column);
  return afterStart && beforeEnd;
}

/**
 * Every outermost `as` of each source, with the places under it. `files` is a
 * report's: a name to a source and, where a sweep made them, its mutants.
 * `mutantsInside` is the mutants a report has under an `as`: none while
 * Stryker reads a source as this script takes it to.
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
      mutantsInside += (file.mutants ?? []).filter((mutant) => inside(node.loc, mutant)).length;
      const sites = sitesUnder(node.expression, node, 'expression');
      if (sites > 0) rows.push({ file: name, line: node.loc.start.line, sites, text: shown(file.source.slice(node.start, node.end)) });
    }
  }
  rows.sort((a, b) => b.sites - a.sites || a.file.localeCompare(b.file) || a.line - b.line);
  return { files: Object.keys(files).length, mutants, expressions, sites: rows.reduce((sum, row) => sum + row.sites, 0), mutantsInside, rows };
}

/** Whether the count is within what is recorded as left, and the sentence for either. */
export function verdict(measured, left = LEFT) {
  const counted = `${measured.sites} ${measured.sites === 1 ? 'place' : 'places'} a mutator applies under ${measured.rows.length} of ${measured.expressions} \`as\` expressions`;
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
    `\`as\` expressions, the outermost of each: ${measured.expressions}; with a place a mutator applies under them: ${measured.rows.length}; places: ${measured.sites}`,
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
