/**
 * Which dependencies a round added, removed or moved, read from the manifests
 * it changed.
 *
 * "No new dependency without saying so" is one of the few audit questions
 * that can be answered exactly, and it matters: a dependency is code nobody in
 * the review read. Each reader here understands the part of its format that
 * declares dependencies and nothing more - no resolver, no lockfile, no
 * network. A manifest it cannot read is reported as unread, never as clean,
 * and so is a configured name it cannot read.
 *
 * The same holds for the one line that lets a dependency run code when it is
 * installed. npm 12 runs a dependency's install scripts only where the root
 * package's `allowScripts` allows the package, so an entry a round adds
 * there turns on code that is nowhere in its diff.
 */

import { globAlternatives, parseGlob, type Glob, type GlobAlternative } from './vendor/spec-core/pattern/index.js';

export type Ecosystem = 'npm' | 'cargo' | 'go' | 'pip' | 'python' | 'nuget' | 'bundler';

export interface Dependency {
  readonly section: string;
  readonly name: string;
  /** The version or requirement as written; `''` when none is. */
  readonly version: string;
}

export interface DependencyChange {
  readonly file: string;
  readonly ecosystem: Ecosystem;
  readonly section: string;
  readonly name: string;
  /** `null` when the dependency is new. */
  readonly before: string | null;
  /** `null` when the dependency was removed. */
  readonly after: string | null;
}

/** What an entry of an install-script policy says of the package it names. */
export type InstallScriptVerdict = 'allowed' | 'denied';

export interface InstallScriptEntry {
  /** The field that holds the policy, `allowScripts`. */
  readonly section: string;
  /** The entry's key as written: a package, or a package at the versions it names. */
  readonly name: string;
  readonly verdict: InstallScriptVerdict;
}

export interface InstallScriptChange {
  readonly file: string;
  readonly ecosystem: Ecosystem;
  readonly section: string;
  readonly name: string;
  /** `null` when the policy had no such entry. */
  readonly before: InstallScriptVerdict | null;
  /** `null` when the entry was removed. */
  readonly after: InstallScriptVerdict | null;
}

/** A format read for its dependencies alone: it has no install-script policy. */
type DependencyRead = { readonly ok: true; readonly dependencies: readonly Dependency[] } | { readonly ok: false; readonly error: string };

export type ManifestRead =
  | { readonly ok: true; readonly dependencies: readonly Dependency[]; readonly installScripts: readonly InstallScriptEntry[] }
  | { readonly ok: false; readonly error: string };

/** The ecosystem a manifest file name belongs to, or `null`. */
export function ecosystemOf(path: string): Ecosystem | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name === 'package.json') return 'npm';
  if (name === 'Cargo.toml') return 'cargo';
  if (name === 'go.mod') return 'go';
  if (name === 'pyproject.toml') return 'python';
  if (/^requirements.*\.txt$/.test(name)) return 'pip';
  if (name === 'Directory.Packages.props' || /\.(?:cs|fs|vb)proj$/.test(name)) return 'nuget';
  if (name === 'Gemfile') return 'bundler';
  return null;
}

export interface ManifestNames {
  /** Whether a path is a manifest by one of the names that could be read, matched at any depth. */
  readonly match: (path: string) => boolean;
  /** The names spec-core's glob refused, malformed or too large to compile, each with its reason. */
  readonly unread: readonly { readonly name: string; readonly reason: string }[];
  /** The names a leading `/` roots, alone or on a brace alternative, and whether every alternative is. */
  readonly rooted: readonly { readonly name: string; readonly whole: boolean }[];
}

/**
 * The configured manifest names, read. A name that cannot be read names no
 * manifest, and is returned so the audit can say so: every file it was
 * meant to name would otherwise go unmeasured in silence. So is a name a
 * leading `/` roots at the filesystem's root: it can be read, and names no
 * path the audit is given, all of which are repository-relative.
 */
export function readManifestNames(patterns: readonly string[]): ManifestNames {
  const globs: Glob[] = [];
  const unread: { name: string; reason: string }[] = [];
  const rooted: { name: string; whole: boolean }[] = [];
  for (const pattern of patterns) {
    const parsed = parseGlob(pattern, { dialect: 'ripgrep', caseSensitive: true });
    if (!parsed.ok) {
      unread.push({ name: pattern, reason: parsed.error });
      continue;
    }
    globs.push(parsed.glob);
    // spec-core refuses here only what parseGlob refuses, so a name read
    // above always has its alternatives read.
    const { alternatives } = globAlternatives(pattern) as { readonly alternatives: readonly GlobAlternative[] };
    const roots = alternatives.filter((alternative) => alternative.rooted).length;
    if (roots > 0) rooted.push({ name: pattern, whole: roots === alternatives.length });
  }
  return { match: (path) => globs.some((glob) => glob.match(path)), unread, rooted };
}

/** A predicate over paths for the configured manifest names, matched at any depth. */
export function manifestMatcher(patterns: readonly string[]): (path: string) => boolean {
  return readManifestNames(patterns).match;
}

/* --------------------------------------------------------------------- npm */

const NPM_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function readNpm(text: string): ManifestRead {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'not a JSON object' };
  const out: Dependency[] = [];
  for (const section of NPM_SECTIONS) {
    const table = (value as Record<string, unknown>)[section];
    if (table === undefined) continue;
    if (typeof table !== 'object' || table === null || Array.isArray(table)) return { ok: false, error: `"${section}" is not an object` };
    for (const [name, version] of Object.entries(table)) out.push({ section, name, version: String(version) });
  }
  return { ok: true, dependencies: out, installScripts: npmInstallScripts(value as Record<string, unknown>) };
}

/**
 * npm 12's install-script policy, where `npm install-scripts approve` and
 * `deny` write it: a package, or a package at exact versions, to `true` or
 * `false`.
 */
const NPM_INSTALL_SCRIPTS = 'allowScripts';

/**
 * The entries of `allowScripts`, read as npm reads them. It takes the field
 * only when it is an object and an entry only when its value is `true` or
 * `false`: anything else approves nothing and denies nothing, so it is no
 * entry here either, and never a manifest that cannot be read. Each key is
 * kept as written. Telling `canvas@1.2.3` from `canvas@^1`, which npm
 * passes over, is npm's own reading of a package spec, and the audit names
 * the entry for a person to read.
 */
function npmInstallScripts(manifest: Record<string, unknown>): InstallScriptEntry[] {
  const policy = manifest[NPM_INSTALL_SCRIPTS];
  if (typeof policy !== 'object' || policy === null) return [];
  const out: InstallScriptEntry[] = [];
  for (const [name, value] of Object.entries(policy)) {
    if (value === true) out.push({ section: NPM_INSTALL_SCRIPTS, name, verdict: 'allowed' });
    else if (value === false) out.push({ section: NPM_INSTALL_SCRIPTS, name, verdict: 'denied' });
  }
  return out;
}

/* -------------------------------------------------------------------- TOML */

/** A TOML value on one line, or the start of a multi-line array. Comments and quotes read the way TOML reads them. */
function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed.startsWith('"') || trimmed.startsWith("'")) && trimmed.endsWith(trimmed.charAt(0))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * The strings of a TOML array, `["a>=1", 'b']`, possibly spread over lines.
 * A string inside an inline table is a value of that table, not an element:
 * `{include-group = "test"}` in a dependency group names a group, not a package.
 */
function tomlStrings(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = '';
      while (j < text.length && text.charAt(j) !== ch) {
        if (text.charAt(j) === '\\' && ch === '"') {
          value += text.charAt(j + 1);
          j += 2;
          continue;
        }
        value += text.charAt(j);
        j += 1;
      }
      if (depth === 0) out.push(value);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** The name a PEP 508 requirement names, normalised as PEP 503 says. */
export function pythonName(requirement: string): string {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(requirement);
  return (match?.[1] ?? requirement.trim()).toLowerCase().replace(/[-_.]+/g, '-');
}

interface TomlLine {
  readonly table: string;
  readonly key: string;
  readonly value: string;
}

/** Top-level `key = value` lines per table header, arrays gathered across lines. Enough for dependency tables. */
function tomlEntries(text: string): TomlLine[] | string {
  const out: TomlLine[] = [];
  let table = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripTomlComment(lines[i] as string).trim();
    if (line === '') continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header !== null) {
      table = (header[1] as string).replace(/\s*\.\s*/g, '.');
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = unquote(line.slice(0, eq));
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('[') && !balanced(value)) {
      while (i + 1 < lines.length && !balanced(value)) {
        i += 1;
        value += ` ${stripTomlComment(lines[i] as string).trim()}`;
      }
      if (!balanced(value)) return `the array for "${key}" is never closed`;
    }
    out.push({ table, key, value });
  }
  return out;
}

function balanced(value: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
  }
  return depth <= 0 && quote === null;
}

const CARGO_TABLE = /^(?:target\..+\.)?((?:workspace\.)?(?:dev-|build-)?dependencies)(?:\.(.+))?$/;

function readCargo(text: string): DependencyRead {
  const entries = tomlEntries(text);
  if (typeof entries === 'string') return { ok: false, error: entries };
  const out = new Map<string, Dependency>();
  for (const { table, key, value } of entries) {
    const match = CARGO_TABLE.exec(table);
    if (match === null) continue;
    const section = match[1] as string;
    const inline = match[2];
    if (inline !== undefined) {
      // [dependencies.serde] then `version = "1"`: the table names the crate.
      const name = unquote(inline);
      const id = `${section}\u0000${name}`;
      const current = out.get(id) ?? { section, name, version: '' };
      out.set(id, key === 'version' ? { ...current, version: unquote(value) } : current);
      continue;
    }
    const version = value.startsWith('{') ? (/version\s*=\s*("[^"]*"|'[^']*')/.exec(value)?.[1] ?? '') : value;
    out.set(`${section}\u0000${key}`, { section, name: key, version: unquote(version) });
  }
  return { ok: true, dependencies: [...out.values()] };
}

function readPyproject(text: string): DependencyRead {
  const entries = tomlEntries(text);
  if (typeof entries === 'string') return { ok: false, error: entries };
  const out: Dependency[] = [];
  for (const { table, key, value } of entries) {
    if (table === 'project' && key === 'dependencies') {
      for (const requirement of tomlStrings(value)) out.push({ section: 'project', name: pythonName(requirement), version: requirement });
    } else if (table === 'project.optional-dependencies' || table === 'dependency-groups') {
      for (const requirement of tomlStrings(value)) out.push({ section: `${table}.${key}`, name: pythonName(requirement), version: requirement });
    } else if (/^tool\.poetry\.(?:group\.[^.]+\.)?(?:dev-)?dependencies$/.test(table) && key.toLowerCase() !== 'python') {
      out.push({ section: table, name: pythonName(key), version: unquote(value) });
    }
  }
  return { ok: true, dependencies: out };
}

/* ------------------------------------------------------------ line formats */

function readGoMod(text: string): DependencyRead {
  const out: Dependency[] = [];
  let block = false;
  for (const raw of text.split(/\r?\n/)) {
    const indirect = /\/\/\s*indirect\b/.test(raw);
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line === '') continue;
    if (block) {
      if (line === ')') {
        block = false;
        continue;
      }
      const [name, version] = line.split(/\s+/);
      if (name !== undefined) out.push({ section: indirect ? 'require (indirect)' : 'require', name, version: version ?? '' });
      continue;
    }
    if (/^require\s*\($/.test(line)) {
      block = true;
      continue;
    }
    const single = /^require\s+(\S+)\s+(\S+)/.exec(line);
    if (single !== null) out.push({ section: indirect ? 'require (indirect)' : 'require', name: single[1] as string, version: single[2] as string });
  }
  if (block) return { ok: false, error: 'a require block is never closed' };
  return { ok: true, dependencies: out };
}

function readRequirements(text: string): DependencyRead {
  const out: Dependency[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line === '' || line.startsWith('-')) continue;
    out.push({ section: 'requirements', name: pythonName(line), version: line });
  }
  return { ok: true, dependencies: out };
}

function readNuget(text: string): DependencyRead {
  const out: Dependency[] = [];
  const element = /<(PackageReference|PackageVersion)\b([^>]*?)\/?>/g;
  for (let match = element.exec(text); match !== null; match = element.exec(text)) {
    const attributes = match[2] as string;
    const name = /\bInclude\s*=\s*"([^"]*)"/.exec(attributes)?.[1] ?? /\bUpdate\s*=\s*"([^"]*)"/.exec(attributes)?.[1];
    if (name === undefined) continue;
    const version = /\bVersion\s*=\s*"([^"]*)"/.exec(attributes)?.[1] ?? '';
    out.push({ section: match[1] as string, name, version });
  }
  return { ok: true, dependencies: out };
}

function readGemfile(text: string): DependencyRead {
  const out: Dependency[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*gem\s+(["'])([^"']+)\1\s*(?:,\s*(["'])([^"']*)\3)?/.exec(raw);
    if (match !== null) out.push({ section: 'gem', name: match[2] as string, version: match[4] ?? '' });
  }
  return { ok: true, dependencies: out };
}

/** Reads the dependencies a manifest declares, and the entries of its install-script policy where its format has one. */
export function readManifest(ecosystem: Ecosystem, text: string): ManifestRead {
  if (ecosystem === 'npm') return readNpm(text);
  const read = readDependencies(ecosystem, text);
  return read.ok ? { ...read, installScripts: [] } : read;
}

function readDependencies(ecosystem: Exclude<Ecosystem, 'npm'>, text: string): DependencyRead {
  switch (ecosystem) {
    case 'cargo':
      return readCargo(text);
    case 'go':
      return readGoMod(text);
    case 'python':
      return readPyproject(text);
    case 'pip':
      return readRequirements(text);
    case 'nuget':
      return readNuget(text);
    case 'bundler':
      return readGemfile(text);
  }
}

/** One entry of a section, by what it says: a dependency's version, or a policy's verdict. */
interface Entry<V> {
  readonly section: string;
  readonly name: string;
  readonly value: V;
}

/** The entries added or said differently, in the order written, then those removed. */
function moved<V>(old: readonly Entry<V>[], now: readonly Entry<V>[]): { section: string; name: string; before: V | null; after: V | null }[] {
  const key = (entry: Entry<V>): string => `${entry.section}\u0000${entry.name}`;
  const was = new Map(old.map((entry) => [key(entry), entry]));
  const is = new Map(now.map((entry) => [key(entry), entry]));
  const out: { section: string; name: string; before: V | null; after: V | null }[] = [];
  for (const [id, entry] of is) {
    const previous = was.get(id);
    if (previous === undefined || previous.value !== entry.value) {
      out.push({ section: entry.section, name: entry.name, before: previous?.value ?? null, after: entry.value });
    }
  }
  for (const [id, entry] of was) {
    if (!is.has(id)) out.push({ section: entry.section, name: entry.name, before: entry.value, after: null });
  }
  return out;
}

/**
 * What changed between two versions of one manifest: its dependencies, and
 * the entries of its install-script policy. `null` text is a file that does
 * not exist on that side. Returns the error instead when either side cannot
 * be read.
 */
export function diffManifest(
  file: string,
  ecosystem: Ecosystem,
  before: string | null,
  after: string | null,
): { readonly changes: readonly DependencyChange[]; readonly installScripts: readonly InstallScriptChange[] } | { readonly error: string } {
  const read = (text: string | null, side: string): Pick<ManifestRead & { ok: true }, 'dependencies' | 'installScripts'> | string => {
    if (text === null) return { dependencies: [], installScripts: [] };
    const result = readManifest(ecosystem, text);
    return result.ok ? result : `${file} (${side}): ${result.error}`;
  };
  const old = read(before, 'before');
  if (typeof old === 'string') return { error: old };
  const now = read(after, 'after');
  if (typeof now === 'string') return { error: now };
  const versions = (side: typeof old): Entry<string>[] => side.dependencies.map((d) => ({ section: d.section, name: d.name, value: d.version }));
  const verdicts = (side: typeof old): Entry<InstallScriptVerdict>[] => side.installScripts.map((e) => ({ section: e.section, name: e.name, value: e.verdict }));
  return {
    changes: moved(versions(old), versions(now)).map((change) => ({ file, ecosystem, ...change })),
    installScripts: moved(verdicts(old), verdicts(now)).map((change) => ({ file, ecosystem, ...change })),
  };
}
