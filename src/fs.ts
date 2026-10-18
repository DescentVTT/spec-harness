/**
 * The edge where the harness meets the disk: the configuration, the state
 * directory outside the work tree, and paths as the filesystem spells them.
 */

import { existsSync, readFileSync, realpathSync, statSync, type Stats } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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
 * for a directory, EISDIR, are not the harness's.
 */
export async function loadConfig(root: string): Promise<{ config: HarnessConfig; file: string | null }> {
  const file = join(root, CONFIG_FILE);
  const there = standing(file);
  if (there === null) return { config: DEFAULT_CONFIG, file: null };
  if (!there.isFile()) throw new ConfigError(`${CONFIG_FILE} is ${there.isDirectory() ? 'a directory' : 'neither a file nor a directory'}, not a configuration file`);
  let raw: unknown;
  try {
    // A Buffer parses as its text, so the encoding is equivalent to its mutant.
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  return { config: parseConfig(raw), file };
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
    const named = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1];
    if (named === undefined) return null;
    gitDir = resolve(top, named.trim());
  }
  const commondir = textOf(join(gitDir, 'commondir'));
  const common = commondir === null ? gitDir : resolve(gitDir, commondir.trim());
  const moved = env['GIT_DIR'] !== undefined || env['GIT_WORK_TREE'] !== undefined;
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
