/**
 * The edge where the harness meets spec-brief, spec-graph and spec-guard.
 *
 * Through their command lines and their versioned JSON, never by importing
 * their packages: each is released, pinned and dropped on its own, and none
 * becomes a dependency of this one (spec-core ADR-0005, ADR-0002 here).
 *
 * A sibling is found as the repository installed it -
 * `node_modules/@descent-vtt/<name>/bin/<name>.js`, run with this Node - or
 * as `.spec-harness.json` names it. One that is not there is `absent`, and
 * what needed it says so; nothing it would have checked is reported clean.
 * One installed below this release's minimum is `outdated`, and is reported
 * the same way rather than run (versions.ts).
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseBriefList, SiblingOutputError } from './briefs.js';
import type { HarnessConfig, SiblingName } from './config.js';
import { isFile } from './fs.js';
import { ANSWER_MS, stoppedAtLimit, WORK_MS } from './git.js';
import type { BriefRow } from './types.js';
import { checkVersion } from './versions.js';

export interface SiblingRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Sibling =
  /**
   * `version` is `null` for a command `.spec-harness.json` names, whose
   * version is not checked. `elsewhere` is the directory whose install it
   * is, where that is not the work tree's own.
   */
  | { readonly kind: 'found'; readonly command: readonly string[]; readonly version: string | null; readonly elsewhere?: string }
  | { readonly kind: 'absent'; readonly reason: string }
  /** Installed, at a version below the minimum or one that cannot be read, which is `null`. */
  | { readonly kind: 'outdated'; readonly reason: string; readonly version: string | null; readonly elsewhere?: string };

/**
 * Where a sibling is, or why it cannot be run. It is looked for in `root`'s
 * install, then in each of `installs` in turn, and the first that has it
 * decides, at this release's floor: a work tree with an install of its own
 * runs it, outdated or not, and one with none is checked with the
 * project's, as git's hook and Claude Code's are where a linked worktree has
 * none (ADR-0005).
 */
// A name a mutant puts on the default list is a directory relative to where
// the run is, which holds no install: equivalent, here and below.
export function locate(name: SiblingName, root: string, config: HarnessConfig, installs: readonly string[] = []): Sibling {
  // A command the configuration names is run as named: which package it runs,
  // and so which version, is the configuration's to say.
  const configured = config.tools[name];
  if (configured !== null) return { kind: 'found', command: configured, version: null };
  for (const place of [root, ...installs]) {
    const directory = join(place, 'node_modules', '@descent-vtt', name);
    const bin = join(directory, 'bin', `${name}.js`);
    if (!existsSync(bin)) continue;
    const check = checkVersion(name, declaredVersion(join(directory, 'package.json')));
    const where = place === root ? {} : { elsewhere: place };
    if (!check.ok) return { kind: 'outdated', reason: check.reason, version: check.version, ...where };
    return { kind: 'found', command: [process.execPath, bin], version: check.version, ...where };
  }
  return {
    kind: 'absent',
    reason: `${name} is not installed here: npm install --save-dev @descent-vtt/${name}, or name its command under "tools" in .spec-harness.json`,
  };
}

/** The `version` a package.json declares, or `undefined` when there is no such file or it is not JSON. */
export function declaredVersion(file: string): unknown {
  // Only a file is read: a named pipe under the name was read without end,
  // and before any sibling ran (ADR-0002).
  if (!isFile(file)) return undefined;
  // A manifest that holds null throws on the read, and any other value that
  // is not an object has no version, so the catch answers for both. Falling
  // out of it answers undefined as well, and a Buffer parses as its text:
  // the empty catch and the encoding are equivalent to their mutants.
  try {
    const manifest: { version?: unknown } = JSON.parse(readFileSync(file, 'utf8'));
    return manifest.version;
  } catch {
    return undefined;
  }
}

/**
 * Runs a sibling with arguments, in the repository root.
 *
 * Never through a shell: an argument is a path or a brief id, and a shell
 * would read it as syntax. `node` as a command's first word is this Node, so
 * `["node", "path/to/bin.js"]` works on every host; a Windows `.cmd` shim such
 * as `npx` cannot be started without a shell, and the error says to name the
 * script instead.
 *
 * A sibling that does not answer within `limit` is stopped, and rejected as
 * a `SiblingError` that names it: what it was asked waits on it, the hook
 * before a write among them, which then holds the write (ADR-0002).
 */
export function runSibling(name: string, command: readonly string[], args: readonly string[], root: string, limit = WORK_MS): Promise<SiblingRun> {
  const [first, ...rest] = command;
  const program = first === 'node' ? process.execPath : (first as string);
  return new Promise((resolve, reject) => {
    execFile(
      program,
      [...rest, ...args],
      {
        cwd: root,
        maxBuffer: 256 * 1024 * 1024,
        encoding: 'utf8',
        // Keeps a console window from opening on Windows; the sweep runs on
        // Linux, where the mutant is equivalent.
        windowsHide: true,
        timeout: limit,
        shell: false,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      },
      (error, stdout, stderr) => {
        if (stoppedAtLimit(error)) {
          reject(new SiblingError(`${name} did not answer within ${limit / 1000} seconds, and was stopped`));
          return;
        }
        const failure = error as (Error & { code?: unknown }) | null;
        if (failure !== null && failure.code === 'ENOENT') {
          resolve({
            code: -1,
            stdout: '',
            stderr: `cannot start "${first}": name the tool's script, such as ["node", "node_modules/@descent-vtt/<tool>/bin/<tool>.js"]`,
          });
          return;
        }
        const code = failure === null ? 0 : typeof failure.code === 'number' ? failure.code : -1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

export class SiblingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiblingError';
  }
}

function parseJson(name: string, run: SiblingRun): unknown {
  try {
    return JSON.parse(run.stdout);
  } catch {
    const said = (run.stderr.trim() || run.stdout.trim()).split('\n').slice(0, 3).join(' ');
    throw new SiblingError(`${name} exited ${run.code} without JSON${said ? `: ${said}` : ''}`);
  }
}

export interface Siblings {
  readonly root: string;
  locate(name: SiblingName): Sibling;
  /**
   * Every brief, live and archived. Exit 2 from spec-brief is an error here
   * too, and so is a spec-brief that does not answer within `limit`, the
   * time a question is given unless a caller gives another.
   */
  briefs(limit?: number): Promise<BriefRow[]>;
  /** A sibling's JSON output for a command line, with its exit code and what it said on stderr; `absent` says why it cannot be run, missing or outdated. */
  json(name: SiblingName, args: readonly string[]): Promise<{ readonly code: number; readonly document: unknown; readonly stderr: string } | { readonly absent: string }>;
}

/** The siblings of the work tree at `root`, looked for in its install and then in each of `installs` (locate). */
export function createSiblings(root: string, config: HarnessConfig, installs: readonly string[] = []): Siblings {
  const found = (name: SiblingName): readonly string[] => {
    const sibling = locate(name, root, config, installs);
    if (sibling.kind !== 'found') throw new SiblingError(sibling.reason);
    return sibling.command;
  };
  return {
    root,
    locate: (name) => locate(name, root, config, installs),
    async briefs(limit = ANSWER_MS) {
      const run = await runSibling('spec-brief', found('spec-brief'), ['list', '--archived', '--format', 'json', '--no-color'], root, limit);
      if (run.code === 2) {
        throw new SiblingError(`spec-brief could not list the briefs: ${run.stderr.trim().split('\n')[0] || 'exit 2'}`);
      }
      try {
        return parseBriefList(parseJson('spec-brief', run));
      } catch (error) {
        // parseJson throws a SiblingError, which this would copy, and
        // parseBriefList nothing but its own: the check is equivalent to its
        // mutant, and keeps any other error the stack trace it needs.
        if (error instanceof SiblingOutputError) throw new SiblingError(error.message);
        throw error;
      }
    },
    async json(name, args) {
      const sibling = locate(name, root, config, installs);
      if (sibling.kind !== 'found') return { absent: sibling.reason };
      const run = await runSibling(name, sibling.command, args, root);
      return { code: run.code, document: parseJson(name, run), stderr: run.stderr };
    },
  };
}
