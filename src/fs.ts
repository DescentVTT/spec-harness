/**
 * The edge where the harness meets the disk: the configuration, the state
 * directory outside the work tree, and paths as the filesystem spells them.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { ConfigError, CONFIG_FILE, DEFAULT_CONFIG, parseConfig, type HarnessConfig } from './config.js';

/** What stands at a path, links followed, or `null` where nothing does: a link to nothing is nothing. */
function standing(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Reads `.spec-harness.json` at the root, or the defaults when there is none.
 *
 * Only a file is read. A named pipe under the file's name was read without
 * end, by every command and by the hook before every write; and Node's words
 * for a directory, EISDIR, are not the harness's. What does not load is
 * thrown with the path it stands at, which the hook lets a write reach
 * (ADR-0005).
 */
export async function loadConfig(root: string): Promise<{ config: HarnessConfig; file: string | null }> {
  const file = join(root, CONFIG_FILE);
  const there = standing(file);
  if (there === null) return { config: DEFAULT_CONFIG, file: null };
  if (!there.isFile()) throw new ConfigError(`${CONFIG_FILE} is ${there.isDirectory() ? 'a directory' : 'neither a file nor a directory'}, not a configuration file`, file);
  let raw: unknown;
  try {
    // A Buffer parses as its text, so the encoding is equivalent to its mutant.
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`, file);
  }
  try {
    return { config: parseConfig(raw), file };
  } catch (error) {
    // parseConfig throws nothing but its own refusal, whose words are kept.
    throw new ConfigError((error as Error).message, file);
  }
}

/**
 * The real path of a file that stands at `path` under that name alone: a
 * file, not a link to one, and with no other name, since a write to a file
 * with two names writes both. `null` for anything else, and for nothing.
 */
function soleFile(path: string): string | null {
  try {
    const entry = lstatSync(path);
    return entry.isFile() && entry.nlink === 1 ? realpathSync.native(path) : null;
  } catch {
    // Nothing at the path, or nothing the account may look at. Its callers
    // compare the answer with a real path, which neither `null` nor what an
    // empty block answers is, so that mutant is equivalent.
    return null;
  }
}

/**
 * Whether every path of a write names `file` and nothing else: a file that
 * stands under that name alone, which the path names as the hook resolves a
 * path to decide it ({@link realSpelling}), and as the filesystem resolves
 * it to write, which on Linux and macOS follows a link before a `..` where
 * the hook reads the `..` first. A path that only reads like it, a link to
 * it, a second name of it, and a file of another work tree are none of
 * these. `cwd` is what a relative path is read from, its words kept as
 * written.
 */
export function writesOnly(paths: readonly string[], file: string, cwd: string): boolean {
  // Where the file is none, no path's real spelling is `null`, so no path
  // names it.
  const own = soleFile(file);
  return paths.every((given) => {
    const path = isAbsolute(given) ? given : `${cwd}${sep}${given}`;
    return soleFile(path) === own && realSpelling(path) === own;
  });
}

/**
 * A path where the harness keeps its state that holds something else: said
 * in a line, exit 2, where Node's ENOTDIR and a stack sent a person looking
 * for a defect (spec-core ADR-0005).
 */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}

/**
 * The real spelling of a path: links resolved and, on a filesystem that
 * ignores case, the case the directory entries have. A path that does not
 * exist yet is resolved through its nearest existing ancestor.
 *
 * This is what stops `SRC/db/schema.ts` from walking past a protection on
 * `src/db/schema.ts` on Windows or macOS, where both name one file.
 */
export function realSpelling(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      // join leaves a real path as it is, and reads a segment's leading
      // separator as the one between it and the last.
      return join(realpathSync.native(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      // Only a root that does not exist fails at the top, a drive Windows
      // does not have; everywhere else the loop ends in the try.
      if (parent === current) return resolve(path);
      missing.push(current.slice(parent.length));
      current = parent;
    }
  }
}

/**
 * Whether `directory` is the one git names as the top of a work tree: the
 * two spelled alike once the filesystem has spelled the directory, links
 * and short names resolved, as git spells a top. A spelling that differs is
 * read as another directory: what git said from the one is then not taken
 * for what it would say from the other.
 */
export function isTop(directory: string, top: string): boolean {
  return realSpelling(directory).split(sep).join('/') === top;
}

/**
 * The repository's main work tree, where git keeps the repository as that
 * work tree's `.git`, as `git init` and `git clone` do and every linked
 * worktree's common directory then is: `null` for a common directory of any
 * other name, a bare repository's, a submodule's under its superproject's
 * `modules`, or one kept apart with `--separate-git-dir`. Read from the
 * name, with no process: it says only where an install is looked for.
 */
export function mainWorkTree(commonDir: string): string | null {
  return basename(commonDir) === '.git' ? dirname(commonDir) : null;
}

/** Whether a `.git` stands in `directory`, a repository's or the file that names one, as at the top of a work tree. */
export function holdsGit(directory: string): boolean {
  return existsSync(join(directory, '.git'));
}

/**
 * A path as the repository names it - relative to the root, POSIX-separated,
 * real spelling - or `null` when it lies outside the root.
 */
export function repositoryPath(given: string, root: string, cwd: string): string | null {
  const absolute = isAbsolute(given) ? given : resolve(cwd, given);
  const real = realSpelling(absolute);
  const realRoot = realSpelling(root);
  const rel = relative(realRoot, real);
  // `..env` at the root is inside it; only a `..` segment climbs out.
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

/**
 * The top of every work tree of the repository whose common directory is
 * `common`, `top` among them, read with no process: the main work tree,
 * whose `.git` the common directory is, and each linked worktree, by the
 * `gitdir` file git keeps for it under the common directory's `worktrees`,
 * which names the worktree's `.git` (gitrepository-layout(5)), absolute or
 * from its own directory. `null` where they cannot all be named: a common
 * directory of any other name, whose main work tree only its configuration
 * names, and an entry under `worktrees` that cannot be read.
 */
export function workTrees(top: string, common: string): string[] | null {
  const main = mainWorkTree(common);
  if (main === null) return null;
  const kept = join(common, 'worktrees');
  let names: string[];
  try {
    names = readdirSync(kept);
  } catch (error) {
    // No such directory is no linked worktree.
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [top, main] : null;
  }
  const linked = names.map((name) => textOf(join(kept, name, 'gitdir')));
  if (linked.includes(null)) return null;
  // The line's end stands in the last name, the worktree's `.git`, which
  // dirname takes away with it.
  return [top, main, ...names.map((name, at) => dirname(resolve(kept, name, linked[at]!)))];
}

/**
 * Whether every path lies outside every work tree of the repository whose
 * top and common directory are given: such a path is no file of the
 * repository's, so no brief of its decides it, whatever is wrong with the
 * brief or the configuration (ADR-0005). Where the work trees cannot all
 * be named, a path is not known to be outside them, and this is `false`.
 */
export function outsideEvery(paths: readonly string[], top: string, common: string, cwd: string): boolean {
  // A path in the work tree that was opened, as nearly every write's is,
  // is told with nothing of git's directory read; read anyway, `top` is
  // among the work trees, so the mutant without this test is equivalent.
  if (paths.some((path) => repositoryPath(path, top, cwd) !== null)) return false;
  const trees = workTrees(top, common);
  return trees !== null && paths.every((path) => trees.every((tree) => repositoryPath(path, tree, cwd) === null));
}

/**
 * The harness's own directory under the git common directory, created on
 * demand (ADR-0003). Where something that is no directory stands at its path,
 * or at one between it and git's, Node refuses to make it, with ENOTDIR or
 * EEXIST, and the harness says which path holds what.
 */
export async function stateDirectory(commonDir: string, ...parts: string[]): Promise<string> {
  const directory = join(commonDir, 'spec-harness', ...parts);
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== 'ENOTDIR' && code !== 'EEXIST') throw error;
    // mkdir refuses for this alone, so one of the steps is there and is no
    // directory, and every step before it is one.
    const steps = ['spec-harness', ...parts].map((_, at, all) => join(commonDir, ...all.slice(0, at + 1)));
    const there = steps.find((step) => !standing(step)!.isDirectory())!;
    throw new StateError(`${there} is not a directory, where spec-harness keeps its state in one: move it away, and run the command again`);
  }
  return directory;
}

/**
 * A work tree and its git directories as the files git keeps name them, read
 * with no process: the nearest directory at or above `root` that holds a
 * `.git`; the git directory, that `.git` or the one a `.git` file names
 * (`gitdir: <path>`, relative to the file's directory); and the common
 * directory, the one that git directory's `commondir` file names, relative
 * to it, or the git directory itself (gitrepository-layout(5)). `exact` is
 * whether git, asked, would name the same work tree: not where
 * `GIT_DIR` or `GIT_WORK_TREE` sends it elsewhere, and not where the
 * repository's configuration names a `worktree`, which `core.worktree`
 * moves it to (git-config(1)), or keeps one of its own for a worktree.
 * `null` where no directory up to the top of the filesystem holds one, or
 * a `.git` file names none.
 */
export function gitDirectories(root: string, env: Readonly<Record<string, string | undefined>>): { readonly top: string; readonly common: string; readonly exact: boolean } | null {
  let top = realSpelling(root);
  let found: Stats | null = null;
  for (;;) {
    found = standing(join(top, '.git'));
    if (found !== null) break;
    const parent = dirname(top);
    if (parent === top) return null;
    top = parent;
  }
  const dotGit = join(top, '.git');
  let gitDir = dotGit;
  if (found.isFile()) {
    // The path is the rest of the line: `.` stops at a line's end, a
    // carriage return among them, so the mutant that drops `$` is
    // equivalent; and a Buffer is read as its text, so is the encoding's.
    const named = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1];
    if (named === undefined) return null;
    gitDir = resolve(top, named);
  }
  const commondir = textOf(join(gitDir, 'commondir'));
  const common = commondir === null ? gitDir : resolve(gitDir, commondir.trim());
  const moved = env['GIT_DIR'] !== undefined || env['GIT_WORK_TREE'] !== undefined;
  // No configuration holds no key, as a text without one does: the mutant
  // of the empty text is equivalent.
  const elsewhere = /^\s*worktree\s*=/im.test(textOf(join(common, 'config')) ?? '') || existsSync(join(gitDir, 'config.worktree'));
  return { top, common, exact: !moved && !elsewhere };
}

/** A file's text, or `null` where it cannot be read. */
function textOf(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * How long a call's decisions are kept for a run after the write that does
 * not come: a call refused by the person, one that failed, one stopped
 * (ADR-0002). A day, since a call waits on a person's prompt for as long as
 * the person is away, and an entry removed too soon costs only that call's
 * answer being decided again.
 */
export const CALL_LIFE_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps what a run before a write decided, under the common directory, for
 * the run after it, and removes what no run after a write read in a day.
 * Nothing here may change the answer before the write: whatever fails is
 * passed over, and the run after the write then decides as it did.
 */
export async function keepCall(commonDir: string, name: string, text: string, now: number = Date.now()): Promise<void> {
  try {
    const directory = await stateDirectory(commonDir, 'calls');
    await writeAtomic(join(directory, name), text);
    // A file another run takes away before it is removed here ends the
    // pruning in the catch below, where `force` would pass over it, and what
    // is left is pruned by a later run: the mutants of `force` are
    // equivalent.
    for (const entry of await readdir(directory)) {
      const file = join(directory, entry);
      if (now - (await stat(file)).mtimeMs > CALL_LIFE_MS) await rm(file, { force: true });
    }
  } catch {
    // A full disk, a directory another run removed: the call is decided again after the write.
  }
}

/** What was kept for a call, taken away as it is read; `null` where nothing was. */
export async function takeCall(commonDir: string, name: string): Promise<string | null> {
  const file = join(commonDir, 'spec-harness', 'calls', name);
  try {
    const text = await readFile(file, 'utf8');
    // Taken away by another run since it was read, the mutants of `force`
    // decide the call again, which answers as the text read does: they are
    // equivalent.
    await rm(file, { force: true });
    return text;
  } catch {
    return null;
  }
}

/** Writes a file whole or not at all: a temporary file renamed over the target. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  // utf8 is writeFile's own default, so naming it is equivalent to its mutant.
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, file);
}

/**
 * A JSON object from a file: `null` when there is no file, `'unreadable'`
 * when it holds anything else. Only a file is read: a named pipe where a
 * settings file is expected was read without end, and neither doctor nor
 * init came back. What is neither a file nor a directory holds no JSON
 * object, as a directory holds none.
 */
export async function readJsonObject(file: string): Promise<Record<string, unknown> | null | 'unreadable'> {
  const there = standing(file);
  if (there === null) return null;
  if (!there.isFile()) return 'unreadable';
  try {
    // A Buffer parses as its text, so the encoding is equivalent to its mutant.
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/** Whether a path names a directory that is there; one that cannot be read names none. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    // Each caller reads the answer with `!`, so the mutant that answers
    // nothing here is equivalent.
    return false;
  }
}

export async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}
