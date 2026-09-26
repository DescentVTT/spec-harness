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
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseBriefList, SiblingOutputError } from './briefs.js';
import type { HarnessConfig, SiblingName } from './config.js';
import type { BriefRow } from './types.js';

export interface SiblingRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Sibling = { readonly kind: 'found'; readonly command: readonly string[] } | { readonly kind: 'absent'; readonly reason: string };

/** Where a sibling is, or why it is not. */
export function locate(name: SiblingName, root: string, config: HarnessConfig): Sibling {
  const configured = config.tools[name];
  if (configured !== null) return { kind: 'found', command: configured };
  const bin = join(root, 'node_modules', '@descent-vtt', name, 'bin', `${name}.js`);
  if (existsSync(bin)) return { kind: 'found', command: [process.execPath, bin] };
  return {
    kind: 'absent',
    reason: `${name} is not installed here: npm install --save-dev @descent-vtt/${name}, or name its command under "tools" in .spec-harness.json`,
  };
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
  /** A sibling's JSON output for a command line, with its exit code. */
  json(name: SiblingName, args: readonly string[]): Promise<{ readonly code: number; readonly document: unknown } | { readonly absent: string }>;
}

export function createSiblings(root: string, config: HarnessConfig): Siblings {
  const found = (name: SiblingName): readonly string[] => {
    const sibling = locate(name, root, config);
    if (sibling.kind === 'absent') throw new SiblingError(sibling.reason);
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
      if (sibling.kind === 'absent') return { absent: sibling.reason };
      const run = await runSibling(sibling.command, args, root);
      return { code: run.code, document: parseJson(name, run) };
    },
  };
}
