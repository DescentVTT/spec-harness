/**
 * The edge where the harness meets a program that is neither git nor a
 * sibling: Claude Code, asked which release it is.
 *
 * Found on `PATH` and started without a shell, as every program the harness
 * runs is (ADR-0002). On Windows a program is an `.exe` or a `.com`. A
 * `claude.cmd` shim, as npm installs Claude Code, can be started only by a
 * shell - Node refuses a `.cmd` without one since the fix for CVE-2024-27980 -
 * so it is read rather than run: the package it runs declares the release.
 */

import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { readText } from './fs.js';
import { declaredVersion } from './siblings.js';
import type { ClaudeCodeAnswer } from './versions.js';

/** What Windows runs for a name with no extension, in order; the first two alone without a shell. */
const WINDOWS_EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD'];

/**
 * A path a shim runs, from the shim's own directory. npm's cmd-shim writes
 * `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"`, after
 * `SET dp0=%~dp0`; pnpm's writes `"%~dp0\..."`.
 */
const SHIM_TARGET = /"(?:%~dp0|%dp0%)\\([^"\r\n]*)"/g;

/**
 * Where npm and pnpm install Claude Code, as the segments of a path: only its
 * own package declares its release, where a package that wraps it declares
 * the wrapper's.
 */
const CLAUDE_CODE_PACKAGE = ['node_modules', '@anthropic-ai', 'claude-code'];

/** The file `name` names on `PATH` as the environment gives it, or `null`. */
export function onPath(name: string, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform): string | null {
  // With neither, any text names directories no test can have made; and an
  // empty entry is passed over rather than read as the working directory,
  // which a test cannot fill: both mutants are equivalent in the suite.
  const path = env['PATH'] ?? env['Path'] ?? '';
  const windows = platform === 'win32';
  const extensions = windows
    ? (env['PATHEXT'] ?? WINDOWS_EXTENSIONS.join(';')).split(';').filter((extension) => extension !== '')
    : [''];
  for (const directory of path.split(windows ? ';' : delimiter)) {
    if (directory === '') continue;
    for (const extension of extensions) {
      const file = join(directory, `${name}${extension.toLowerCase()}`);
      if (existsSync(file) && statSync(file).isFile()) return file;
    }
  }
  return null;
}

/** The directory of Claude Code's package that a shim runs, or `null` when it runs none. */
function shimPackage(file: string, text: string): string | null {
  for (const match of text.matchAll(SHIM_TARGET)) {
    const parts = (match[1] as string).split('\\');
    const at = parts.findIndex((_, start) => CLAUDE_CODE_PACKAGE.every((part, offset) => parts[start + offset] === part));
    if (at >= 0) return join(dirname(file), ...parts.slice(0, at + CLAUDE_CODE_PACKAGE.length));
  }
  return null;
}

/**
 * The release a Windows script on `PATH` runs, as the package.json of the
 * Claude Code package it names declares it; nothing is run. A script that
 * names no such package, or one whose package.json gives no version, cannot
 * tell.
 */
async function shimVersion(file: string): Promise<ClaudeCodeAnswer> {
  // A shim that cannot be read names no package, as an empty one does, so
  // what stands in for its text is equivalent whatever it is.
  const directory = shimPackage(file, (await readText(file)) ?? '');
  if (directory !== null) {
    const manifest = join(directory, 'package.json');
    const version = declaredVersion(manifest);
    if (typeof version === 'string') return { declared: version, file: manifest };
  }
  return {
    missing: `claude on PATH is ${file}, a script that cannot be started without a shell, which spec-harness does not use, and it names no @anthropic-ai/claude-code package whose package.json gives a version`,
  };
}

/** `claude --version`, as the Claude Code on `PATH` answers it, or why it cannot. */
export async function claudeVersion(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform): Promise<ClaudeCodeAnswer> {
  const file = onPath('claude', env, platform);
  if (file === null) return { missing: 'no claude is on PATH' };
  if (platform === 'win32' && !/\.(?:exe|com)$/i.test(file)) return shimVersion(file);
  // Of the options, only `shell: false` and the encoding change an answer a
  // test can see: `windowsHide` hides a console window, and the timeout
  // stops a claude that never answers, which a test would wait on for its
  // length, so their mutants are equivalent in the suite.
  return new Promise((resolve) => {
    const failed = (error: Error): void => resolve({ missing: `${file} --version failed: ${error.message.split('\n')[0] as string}` });
    try {
      execFile(file, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15_000, shell: false }, (error, stdout) => {
        if (error !== null) failed(error);
        else resolve({ output: stdout });
      });
    } catch (error) {
      // Windows refuses a file that is no program before any callback, as
      // spawn UNKNOWN, where Linux reports it to the callback: doctor says
      // so rather than stop. The sweep runs on Linux, so this line is the
      // Windows job's to hold.
      failed(error as Error);
    }
  });
}
