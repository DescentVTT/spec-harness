import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { claim, PREFIX, staleIn, VARIABLES } from '../temporary.js';

/**
 * What the suite removes of earlier runs, and where a run works
 * (tests/temporary.ts). Every root here is made up, inside this run's own
 * directory: the logic is never pointed at the system's temporary directory.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const made: string[] = [];
afterAll(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

/** A made-up temporary directory, empty. */
function root(): string {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  made.push(directory);
  return directory;
}

/** A directory in `parent` as a run of the suite leaves one: a repository's files in it. */
function left(parent: string, name: string): string {
  const directory = join(parent, name);
  mkdirSync(join(directory, '.git'), { recursive: true });
  writeFileSync(join(directory, 'a.txt'), 'a\n');
  return directory;
}

/** When something was last added to `directory` or taken from it. */
const changed = (directory: string): number => statSync(directory).mtimeMs;

describe('what a stopped run of the suite left in a temporary directory', () => {
  it('is a directory with the suite\'s prefix that nothing was added to or taken from for more than a day', () => {
    const temporary = root();
    const first = left(temporary, `${PREFIX}aaaaaa`);
    const second = left(temporary, `${PREFIX}bbbbbb`);
    const last = Math.max(changed(first), changed(second));
    expect(staleIn(temporary, last)).toEqual([]);
    expect(staleIn(temporary, last + DAY - MINUTE)).toEqual([]);
    expect(staleIn(temporary, last + DAY + MINUTE)).toEqual([first, second]);
  });

  it('is not one a run is still using, however long ago it was made', () => {
    const temporary = root();
    const directory = left(temporary, `${PREFIX}aaaaaa`);
    const longAgo = new Date(Date.now() - 3 * DAY);
    utimesSync(directory, longAgo, longAgo);
    expect(staleIn(temporary, Date.now())).toEqual([directory]);
    // A run adds a repository to its directory for every test.
    mkdirSync(join(directory, `${PREFIX}cccccc`));
    expect(staleIn(temporary, Date.now())).toEqual([]);
  });

  it.each([
    // The sandbox's own, which a person's `probe` makes on the same machine.
    ['a directory with the sandbox\'s prefix', (temporary: string) => left(temporary, 'spec-harness-AbC123')],
    ['a directory of another name', (temporary: string) => left(temporary, 'other-spec-harness-test-aaaaaa')],
    ['a file with the suite\'s prefix', (temporary: string) => writeFileSync(join(temporary, `${PREFIX}aaaaaa`), '')],
    [
      'a link with the suite\'s prefix, to a directory elsewhere',
      (temporary: string) => {
        const elsewhere = left(root(), 'kept');
        // A junction on Windows, which needs no privilege; a symbolic link elsewhere.
        symlinkSync(elsewhere, join(temporary, `${PREFIX}aaaaaa`), 'junction');
      },
    ],
    ['a directory with the suite\'s prefix inside another', (temporary: string) => left(join(temporary, 'elsewhere'), `${PREFIX}aaaaaa`)],
  ])('is never %s, however old', (_, make) => {
    const temporary = root();
    make(temporary);
    expect(staleIn(temporary, Date.now() + 365 * DAY)).toEqual([]);
  });
});

describe('the directory a run of the suite works in', () => {
  it('is made in the temporary directory it is given, with the suite\'s prefix, and named to what the run starts as the temporary directory', () => {
    const temporary = root();
    const env: NodeJS.ProcessEnv = { TEMP: 'elsewhere' };
    const own = claim(temporary, env);
    expect(dirname(own)).toBe(temporary);
    expect(basename(own).startsWith(PREFIX)).toBe(true);
    expect(existsSync(own)).toBe(true);
    expect(VARIABLES.map((name) => env[name])).toEqual([own, own, own]);
    // What a process started with that environment takes for the temporary
    // directory, which is where the sandbox makes its worktrees.
    const child = spawnSync(process.execPath, ['-p', 'require("node:os").tmpdir()'], { env: { ...process.env, ...env }, encoding: 'utf8' });
    expect(child.stdout.trim()).toBe(own);
  });

  it('is its own each run, and the next run\'s to remove once a day has passed, as a stopped run leaves it', () => {
    const temporary = root();
    const first = claim(temporary, {});
    const second = claim(temporary, {});
    expect(second).not.toBe(first);
    const last = Math.max(changed(first), changed(second));
    expect(staleIn(temporary, last + MINUTE)).toEqual([]);
    expect(staleIn(temporary, last + DAY + MINUTE)).toEqual([first, second].sort());
  });
});
