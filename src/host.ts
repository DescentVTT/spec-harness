/**
 * The edge where the harness meets a program that is neither git nor a
 * sibling: Claude Code, asked which release it is.
 *
 * Found on `PATH` and started without a shell, as every program the harness
 * runs is (ADR-0002). On Windows a program is an `.exe` or a `.com`; a
 * `claude.cmd` shim, as npm installs one, can be started only by a shell, so
 * it is named rather than run, and its release cannot be told.
 */

import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import type { ClaudeCodeAnswer } from './versions.js';

/** What Windows runs for a name with no extension, in order; the first two alone without a shell. */
const WINDOWS_EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD'];

/** The file `name` names on `PATH` as the environment gives it, or `null`. */
export function onPath(name: string, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform): string | null {
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

/** `claude --version`, as the Claude Code on `PATH` answers it, or why it cannot. */
export async function claudeVersion(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform): Promise<ClaudeCodeAnswer> {
  const file = onPath('claude', env, platform);
  if (file === null) return { missing: 'no claude is on PATH' };
  if (platform === 'win32' && !/\.(?:exe|com)$/i.test(file)) {
    return { missing: `claude on PATH is ${file}, a script that cannot be started without a shell, which spec-harness does not use` };
  }
  return new Promise((resolve) => {
    execFile(file, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15_000, shell: false }, (error, stdout) => {
      if (error !== null) resolve({ missing: `${file} --version failed: ${error.message.split('\n')[0] ?? ''}` });
      else resolve({ output: stdout });
    });
  });
}
