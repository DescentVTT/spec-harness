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
import type { BriefRow } from './types.js';
import { checkVersion } from './versions.js';

export interface SiblingRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Sibling =
  /** `version` is `null` for a command `.spec-harness.json` names, whose version is not checked. */
  | { readonly kind: 'found'; readonly command: readonly string[]; readonly version: string | null }
  | { readonly kind: 'absent'; readonly reason: string }
  /** Installed, at a version below the minimum or one that cannot be read, which is `null`. */
  | { readonly kind: 'outdated'; readonly reason: string; readonly version: string | null };

/** Where a sibling is, or why it cannot be run. */
export function locate(name: SiblingName, root: string, config: HarnessConfig): Sibling {
  // A command the configuration names is run as named: which package it runs,
  // and so which version, is the configuration's to say.
  const configured = config.tools[name];
  if (configured !== null) return { kind: 'found', command: configured, version: null };
  const directory = join(root, 'node_modules', '@descent-vtt', name);
  const bin = join(directory, 'bin', `${name}.js`);
  if (!existsSync(bin)) {
    return {
      kind: 'absent',
      reason: `${name} is not installed here: npm install --save-dev @descent-vtt/${name}, or name its command under "tools" in .spec-harness.json`,
    };
  }
  const check = checkVersion(name, declaredVersion(join(directory, 'package.json')));
  if (!check.ok) return { kind: 'outdated', reason: check.reason, version: check.version };
  return { kind: 'found', command: [process.execPath, bin], version: check.version };
}

/** The `version` a package.json declares, or `undefined` when there is no such file or it is not JSON. */
function declaredVersion(file: string): unknown {
  try {
    const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof manifest === 'object' && manifest !== null ? (manifest as { version?: unknown }).version : undefined;
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
 */
export function runSibling(command: readonly string[], args: readonly string[], root: string, timeoutMs = 600_000): Promise<SiblingRun> {
  const [first, ...rest] = command;
  const program = first === 'node' ? process.execPath : (first as string);
  return new Promise((resolve) => {
    execFile(
      program,
      [...rest, ...args],
      {
        cwd: root,
        maxBuffer: 256 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        shell: false,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      },
      (error, stdout, stderr) => {
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
  /** Every brief, live and archived. Exit 2 from spec-brief is an error here too. */
  briefs(): Promise<BriefRow[]>;
  /** A sibling's JSON output for a command line, with its exit code; `absent` says why it cannot be run, missing or outdated. */
  json(name: SiblingName, args: readonly string[]): Promise<{ readonly code: number; readonly document: unknown } | { readonly absent: string }>;
}

export function createSiblings(root: string, config: HarnessConfig): Siblings {
  const found = (name: SiblingName): readonly string[] => {
    const sibling = locate(name, root, config);
    if (sibling.kind !== 'found') throw new SiblingError(sibling.reason);
    return sibling.command;
  };
  return {
    root,
    locate: (name) => locate(name, root, config),
    async briefs() {
      const run = await runSibling(found('spec-brief'), ['list', '--archived', '--format', 'json', '--no-color'], root);
      if (run.code === 2) {
        throw new SiblingError(`spec-brief could not list the briefs: ${run.stderr.trim().split('\n')[0] ?? 'exit 2'}`);
      }
      try {
        return parseBriefList(parseJson('spec-brief', run));
      } catch (error) {
        if (error instanceof SiblingOutputError) throw new SiblingError(error.message);
        throw error;
      }
    },
    async json(name, args) {
      const sibling = locate(name, root, config);
      if (sibling.kind !== 'found') return { absent: sibling.reason };
      const run = await runSibling(sibling.command, args, root);
      return { code: run.code, document: parseJson(name, run) };
    },
  };
}
