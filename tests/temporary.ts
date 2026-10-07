/**
 * A temporary directory of the run's own, and the end of what stopped runs
 * left behind.
 *
 * The integration suite makes a repository for nearly every test, and the
 * sandbox it tests makes worktrees, all in the system's temporary directory.
 * Each test file removes what it made when it ends. A sandbox test that
 * fails with its worktree in use leaves the worktree, and a run that is
 * ended - a terminal closed, a run an agent stops - removes nothing, and
 * nothing ever came back for either: on one workstation 998 directories had
 * gathered by 2026-10-07, 874 of the tests' and 124 of the sandbox's
 * (ADR-0010 has what was measured).
 *
 * So a run works in one directory, named with the suite's prefix, and every
 * process the run starts is told that it is the temporary directory: the
 * tests, the sandbox under test, and git and node under those. The run
 * removes it when it ends, with whatever a failed test left in it. A run that
 * is ended leaves that one directory, and a later run removes it once a day
 * has passed.
 *
 * Only the suite's own prefix is removed, only directly in the system's
 * temporary directory, and only a day after anything was last added to the
 * directory or taken from it: no run lasts a day, so none is using it. The
 * sandbox's prefix is not the suite's to remove: a person's `spec-harness
 * probe` makes directories with it on the same machine.
 */

import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What every directory the suite makes in a temporary directory starts with. */
export const PREFIX = 'spec-harness-test-';

const DAY = 24 * 60 * 60 * 1000;

/** What `os.tmpdir()`, git and a shell read for the temporary directory, on Windows and elsewhere. */
export const VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const;

/**
 * The directories in `root` that a run of the suite made and no run has used
 * for a day, by `now`. A link is not a directory here, wherever it leads, and
 * nothing below `root`'s own entries is read.
 */
export function staleIn(root: string, now: number): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PREFIX))
    .map((entry) => join(root, entry.name))
    .filter((directory) => {
      try {
        // When an entry was last added to it or taken from it, which a run
        // does to its own directory for as long as it lasts.
        return now - statSync(directory).mtimeMs > DAY;
      } catch {
        // Another run's sweep removed it first.
        return false;
      }
    })
    .sort();
}

/** Makes the run's directory in `root`, and names it in `env` as the temporary directory. */
export function claim(root: string, env: NodeJS.ProcessEnv): string {
  const own = mkdtempSync(join(root, PREFIX));
  for (const name of VARIABLES) env[name] = own;
  return own;
}

/** Vitest runs this once, before the first test file, and what it returns once the last has ended. */
export default function setup(): () => void {
  // Native, which expands a Windows short name as git does (helpers.ts).
  const root = realpathSync.native(tmpdir());
  const stale = staleIn(root, Date.now());
  if (stale.length > 0) process.stderr.write(`spec-harness tests: removing ${stale.length} directories that runs stopped more than a day ago left in ${root}\n`);
  for (const directory of stale) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // Something still holds it, or another run is removing it: the next run tries again.
    }
  }
  const own = claim(root, process.env);
  return () => {
    try {
      rmSync(own, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (error) {
      // A virus scanner on Windows can hold a file past every retry. The
      // directory has the suite's prefix, so a later run removes it.
      process.stderr.write(`spec-harness tests: could not remove ${own}: ${(error as Error).message}\n`);
    }
  };
}
