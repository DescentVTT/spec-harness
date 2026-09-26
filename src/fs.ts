/**
 * The edge where the harness meets the disk: the configuration, the state
 * directory outside the work tree, and paths as the filesystem spells them.
 */

import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { ConfigError, CONFIG_FILE, DEFAULT_CONFIG, parseConfig, type HarnessConfig } from './config.js';

/** Reads `.spec-harness.json` at the root, or the defaults when there is none. */
export async function loadConfig(root: string): Promise<{ config: HarnessConfig; file: string | null }> {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return { config: DEFAULT_CONFIG, file: null };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  return { config: parseConfig(raw), file };
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
      const real = realpathSync.native(current);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.push(current.slice(parent.length).replace(/^[\\/]+/, ''));
      current = parent;
    }
  }
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
  if (rel === '') return '';
  // `..env` at the root is inside it; only a `..` segment climbs out.
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

/** The harness's own directory under the git common directory, created on demand (ADR-0003). */
export async function stateDirectory(commonDir: string, ...parts: string[]): Promise<string> {
  const directory = join(commonDir, 'spec-harness', ...parts);
  await mkdir(directory, { recursive: true });
  return directory;
}

/** Writes a file whole or not at all: a temporary file renamed over the target. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, file);
}

export async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}
