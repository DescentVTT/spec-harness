import { chmodSync, copyFileSync, linkSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { claudeVersion } from '../../src/host.js';
import { cleanup, temp, write } from './helpers.js';

afterAll(cleanup);

/** npm's shim for a bin with no `#!` line, as Claude Code's `bin/claude.exe` is, in the words npm's cmd-shim writes. */
const NPM_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
  '',
].join('\r\n');

/** npm's shim for a bin Node runs, as Claude Code's `cli.js` was. */
const NPM_NODE_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  '',
].join('\r\n');

/** pnpm's, from its global bin directory into its store. */
const STORE = 'global\\5\\.pnpm\\@anthropic-ai+claude-code@2.1.285\\node_modules\\@anthropic-ai\\claude-code';
const PNPM_SHIM = [
  '@SETLOCAL',
  '@IF EXIST "%~dp0\\node.exe" (',
  `  "%~dp0\\node.exe"  "%~dp0\\${STORE}\\cli.js" %*`,
  ') ELSE (',
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  `  node  "%~dp0\\${STORE}\\cli.js" %*`,
  ')',
  '',
].join('\r\n');

/** Windows as Node finds a program there, whatever this host is. */
const windows = (directory: string): Record<string, string> => ({ PATH: directory, PATHEXT: '.COM;.EXE;.BAT;.CMD' });

/** A directory on PATH holding `claude.cmd`, and a package.json under it, as an install leaves them. */
function installed(shim: string, files: Readonly<Record<string, string>> = {}): string {
  const directory = temp();
  write(directory, 'claude.cmd', shim);
  // npm writes a shell script and a PowerShell one beside the shim; Windows does not run either for "claude".
  write(directory, 'claude', '#!/bin/sh\necho 9.9.9\n');
  write(directory, 'claude.ps1', 'echo 9.9.9\n');
  for (const [path, content] of Object.entries(files)) write(directory, path, content);
  return directory;
}

const MANIFEST = 'node_modules/@anthropic-ai/claude-code/package.json';

describe('the release of the Claude Code a Windows shim runs', () => {
  it('is read from the package.json of the package npm\'s shim runs, which nothing starts', async () => {
    for (const shim of [NPM_SHIM, NPM_NODE_SHIM]) {
      const directory = installed(shim, { [MANIFEST]: '{ "name": "@anthropic-ai/claude-code", "version": "2.1.285" }\n' });
      expect(await claudeVersion(windows(directory), 'win32')).toEqual({ declared: '2.1.285', file: join(directory, ...MANIFEST.split('/')) });
    }
  });

  it('is read the same way through pnpm\'s shim, and through a path that leaves the shim\'s directory', async () => {
    const pnpm = installed(PNPM_SHIM, { [`${STORE.split('\\').join('/')}/package.json`]: '{ "version": "2.1.200" }' });
    expect(await claudeVersion(windows(pnpm), 'win32')).toEqual({ declared: '2.1.200', file: join(pnpm, ...STORE.split('\\'), 'package.json') });
    const outside = temp();
    const bin = join(outside, 'bin');
    write(bin, 'claude.cmd', '@"%~dp0\\..\\lib\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
    write(outside, `lib/${MANIFEST}`, '{ "version": "2.1.139" }');
    expect(await claudeVersion(windows(bin), 'win32')).toEqual({ declared: '2.1.139', file: join(outside, 'lib', ...MANIFEST.split('/')) });
  });

  it('is a version as the package declares it, for the check to judge', async () => {
    const directory = installed(NPM_SHIM, { [MANIFEST]: '{ "version": "next" }' });
    expect(await claudeVersion(windows(directory), 'win32')).toEqual({ declared: 'next', file: join(directory, ...MANIFEST.split('/')) });
  });

  it('cannot be told from a shim that runs no Claude Code package, or one whose package.json gives no version', async () => {
    const cannot = (directory: string, shim = 'claude.cmd'): { missing: string } => ({
      missing: `claude on PATH is ${join(directory, shim)}, a script that cannot be started without a shell, which spec-harness does not use, and it names no @anthropic-ai/claude-code package whose package.json gives a version`,
    });
    // A script that prints a release, which only a shell would run.
    const echo = installed('@echo 2.1.200 (Claude Code)\r\n');
    expect(await claudeVersion(windows(echo), 'win32')).toEqual(cannot(echo));
    // Another package, in Claude Code's scope or wrapping it: its version is its own.
    for (const other of ['@anthropic-ai\\claude-code-wrapper', '@anthropic-ai\\sdk', 'claude-code']) {
      const path = `node_modules/${other.split('\\').join('/')}/package.json`;
      const wrapper = installed(`@"%~dp0\\node_modules\\${other}\\bin\\claude.exe" %*\r\n`, { [path]: '{ "version": "2.1.300" }' });
      expect(await claudeVersion(windows(wrapper), 'win32')).toEqual(cannot(wrapper));
    }
    // An absolute path is not read, nor read as though it were one from the shim's directory.
    const absolute = installed('@"C:\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*\r\n', { [MANIFEST]: '{ "version": "2.1.300" }' });
    expect(await claudeVersion(windows(absolute), 'win32')).toEqual(cannot(absolute));
    for (const manifest of [null, 'not json', '["2.1.300"]', '{ "version": 2 }', '{ "name": "@anthropic-ai/claude-code" }']) {
      const directory = installed(NPM_SHIM, manifest === null ? {} : { [MANIFEST]: manifest });
      expect(await claudeVersion(windows(directory), 'win32'), String(manifest)).toEqual(cannot(directory));
    }
    // A batch file is read the same way, and runs nothing either.
    const batch = temp();
    write(batch, 'claude.bat', '@echo 2.1.200 (Claude Code)\r\n');
    expect(await claudeVersion(windows(batch), 'win32')).toEqual(cannot(batch, 'claude.bat'));
  });

  it('is looked for under Windows\' own extensions, in their order, without PATHEXT, and under PATHEXT\'s with it', async () => {
    const directory = installed(NPM_SHIM, { [MANIFEST]: '{ "version": "2.1.285" }' });
    const read = { declared: '2.1.285', file: join(directory, ...MANIFEST.split('/')) };
    // .COM, .EXE, .BAT, then .CMD: the shim, never the shell script npm writes beside it.
    expect(await claudeVersion({ PATH: directory }, 'win32')).toEqual(read);
    // Windows spells the variable Path as often as PATH.
    expect(await claudeVersion({ Path: directory }, 'win32')).toEqual(read);
    // An empty entry in PATHEXT is no extension: the shell script is not a program Windows runs.
    expect(await claudeVersion({ PATH: directory, PATHEXT: ';.CMD' }, 'win32')).toEqual(read);
    // PATHEXT's own list, not Windows' default: with .CMD alone, a claude.exe beside the shim is not found.
    write(directory, 'claude.exe', 'not a program\n');
    expect(await claudeVersion({ PATH: directory, PATHEXT: '.CMD' }, 'win32')).toEqual(read);
  });

  it('takes a program before the shim beside it where PATHEXT is not set, a .com before an .exe', async () => {
    // Neither file is a program, so the one that was tried is named in what failed.
    const directory = installed(NPM_SHIM, { [MANIFEST]: '{ "version": "2.1.285" }' });
    const said = async (): Promise<string> => {
      const answer = await claudeVersion({ PATH: directory }, 'win32');
      return 'missing' in answer ? answer.missing : JSON.stringify(answer);
    };
    write(directory, 'claude.exe', 'not a program\n');
    expect(await said()).toContain(`${join(directory, 'claude.exe')} --version failed: `);
    write(directory, 'claude.com', 'not a program\n');
    expect(await said()).toContain(`${join(directory, 'claude.com')} --version failed: `);
  });

  it('reads a shim by its own extension, in a directory whose name ends as a program\'s does', async () => {
    const directory = join(temp(), 'tools.com');
    write(directory, 'claude.cmd', NPM_SHIM);
    write(directory, MANIFEST, '{ "version": "2.1.285" }');
    expect(await claudeVersion(windows(directory), 'win32')).toEqual({ declared: '2.1.285', file: join(directory, ...MANIFEST.split('/')) });
  });

  it('asks a claude.exe without a shell, from a directory whose name a shell would split', async () => {
    const directory = join(temp(), 'Claude Code');
    write(directory, 'README', 'a directory with a space in its name\n');
    try {
      linkSync(process.execPath, join(directory, 'claude.exe'));
    } catch {
      copyFileSync(process.execPath, join(directory, 'claude.exe'));
    }
    const answer = await claudeVersion(windows(directory), 'win32');
    expect('output' in answer ? answer.output.trim() : answer).toBe(process.version);
  });

  it('says what failed, in its first line, when claude.exe does not answer', async () => {
    const directory = temp();
    const file = join(directory, 'claude.exe');
    write(directory, 'claude.exe', '#!/bin/sh\necho second line >&2\nexit 3\n');
    chmodSync(file, 0o755);
    const answer = await claudeVersion(windows(directory), 'win32');
    const said = 'missing' in answer ? answer.missing : '';
    expect(said.startsWith(`${file} --version failed: `), said).toBe(true);
    expect(said.slice(`${file} --version failed: `.length)).toMatch(/^\S[^\n]{3,}$/);
    expect(said).not.toContain('second line');
  });

  it('is asked of a claude.exe, as the native installer puts one, before a shim beside it', async () => {
    // This Node under the name claude.exe: it answers --version with its own.
    const directory = installed(NPM_SHIM, { [MANIFEST]: '{ "version": "2.1.285" }' });
    try {
      linkSync(process.execPath, join(directory, 'claude.exe'));
    } catch {
      copyFileSync(process.execPath, join(directory, 'claude.exe'));
    }
    const answer = await claudeVersion(windows(directory), 'win32');
    // The line it prints ends in CRLF on Windows.
    expect('output' in answer ? answer.output.trim() : answer).toBe(process.version);
  });
});
