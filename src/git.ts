/**
 * The edge where the harness meets git.
 *
 * Reads, except for two things ADR-0003 allows and bounds: a temporary
 * worktree, added and always removed by the sandbox, and nothing else. Every
 * call is an argument vector, never a shell string, so a path or a ref cannot
 * become a command.
 */

import { execFile } from 'node:child_process';

import type { FileChange } from './types.js';

export interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs git and answers whatever it answered; a missing git is a code of -1. */
export function git(args: readonly string[], cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    // windowsHide only keeps a console window from flashing up on Windows,
    // and the sweep runs on Linux, where its mutant is equivalent.
    execFile('git', [...args], { cwd, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      // Every caller tells 0 from any other code, never one failure from
      // another, so which code a failure gets is equivalent to its mutants.
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1;
      resolve({ code, stdout, stderr });
    });
  });
}

async function value(args: readonly string[], cwd: string): Promise<string | null> {
  const run = await git(args, cwd);
  return run.code === 0 ? run.stdout.trim() : null;
}

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/** The top of the work tree holding `cwd`, POSIX-separated, or `null` outside one. */
export async function workTreeRoot(cwd: string): Promise<string | null> {
  return value(['rev-parse', '--show-toplevel'], cwd);
}

/** The git directory every worktree of this repository shares. */
export async function commonDirectory(cwd: string): Promise<string | null> {
  return value(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
}

/**
 * Where git runs the hook `name` from, absolute: `core.hooksPath` read as git
 * reads it - relative to the work tree, absolute, or under `~` - and a linked
 * worktree's shared hooks. `null` when git cannot say, before 2.31.
 */
export async function hookPath(name: string, cwd: string): Promise<string | null> {
  return value(['rev-parse', '--path-format=absolute', '--git-path', `hooks/${name}`], cwd);
}

/** The checked-out branch's short name, or `null` on a detached head. */
export async function currentBranch(cwd: string): Promise<string | null> {
  return value(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
}

/** The remote's default branch as a local ref, such as `origin/main`, or `null`. */
export async function remoteDefault(cwd: string): Promise<string | null> {
  return value(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd);
}

/** Every local branch, by its short name. */
export async function localBranches(cwd: string): Promise<string[]> {
  const listed = await value(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], cwd);
  // for-each-ref fails only where git itself does, outside a repository,
  // where init never runs: the null check is there for the type.
  return listed === null || listed === '' ? [] : listed.split('\n');
}

export async function revision(ref: string, cwd: string): Promise<string | null> {
  return value(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
}

export async function mergeBase(a: string, b: string, cwd: string): Promise<string | null> {
  return value(['merge-base', a, b], cwd);
}

/** Parses `git diff --name-status -z` output. */
export function parseNameStatus(output: string): FileChange[] {
  const fields = output.split('\0');
  const out: FileChange[] = [];
  for (let i = 0; i < fields.length; ) {
    const code = fields[i] as string;
    if (code === '') {
      i += 1;
      continue;
    }
    const status = code.charAt(0) as FileChange['status'];
    if (status === 'R' || status === 'C') {
      out.push({ status, from: fields[i + 1] ?? '', path: fields[i + 2] ?? '' });
      i += 3;
    } else {
      out.push({ status, path: fields[i + 1] ?? '' });
      i += 2;
    }
  }
  return out;
}

/** The files changed from one revision to another, renames found. */
export async function changes(from: string, to: string, cwd: string): Promise<FileChange[]> {
  const run = await git(['diff', '--name-status', '-z', '--find-renames', '--no-color', from, to, '--'], cwd);
  if (run.code !== 0) throw new GitError(`git diff ${from} ${to} failed: ${run.stderr.trim()}`);
  return parseNameStatus(run.stdout);
}

/** The files a commit would change: what is staged. */
export async function stagedChanges(cwd: string): Promise<FileChange[]> {
  const run = await git(['diff', '--cached', '--name-status', '-z', '--find-renames', '--no-color', '--'], cwd);
  if (run.code !== 0) throw new GitError(`git diff --cached failed: ${run.stderr.trim()}`);
  return parseNameStatus(run.stdout);
}

/** A file's content at a revision, or `null` when it does not exist there. */
export async function show(ref: string, path: string, cwd: string): Promise<string | null> {
  const run = await git(['show', `${ref}:${path}`], cwd);
  return run.code === 0 ? run.stdout : null;
}

/** Whether a commit id from {@link blameLine} is the all-zero one of a line nobody committed. */
export function isUncommitted(sha: string): boolean {
  return /^0+$/.test(sha);
}

/**
 * The commit that last changed one line of a file, as of a revision, or of
 * the working tree when `ref` is `null` - where a line nobody committed yet
 * belongs to the all-zero commit.
 */
export async function blameLine(ref: string | null, path: string, line: number, cwd: string): Promise<string | null> {
  const run = await git(['blame', '--porcelain', '-L', `${line},${line}`, ...(ref === null ? [] : [ref]), '--', path], cwd);
  // A blame that fails prints nothing on stdout, which names no commit. Its
  // output opens with the commit, so the anchor is equivalent to its mutant.
  const sha = /^([0-9a-f]{40,64}) /.exec(run.stdout)?.[1];
  return sha ?? null;
}

/** A good signature names its allowed signer's principal; any other names none. */
export type Signature =
  | { readonly good: true; readonly principal: string; readonly detail: string }
  | { readonly good: false; readonly principal: null; readonly detail: string };

/**
 * Whether a commit carries a good SSH signature by a principal in the given
 * allowed-signers file. The file is passed in, never read from the commit's
 * own tree: a round cannot vouch for itself (ADR-0006).
 */
export async function verifyCommit(sha: string, allowedSignersFile: string, cwd: string): Promise<Signature> {
  const run = await git(
    ['-c', `gpg.ssh.allowedSignersFile=${allowedSignersFile}`, '-c', 'gpg.format=ssh', 'verify-commit', '--raw', sha],
    cwd,
  );
  const text = `${run.stderr}\n${run.stdout}`;
  const principal = /Good "git" signature for (\S+)/.exec(text)?.[1];
  // git writes the check to stderr, so the trim changes the first line only
  // for output on stdout alone, which verify-commit does not print; and split
  // always answers a first part.
  const detail = text.trim().split('\n')[0] as string;
  // git exits 0 only for a signature by a listed principal, which it names:
  // either condition alone is equivalent to both, and both trust neither.
  return run.code === 0 && principal !== undefined ? { good: true, principal, detail } : { good: false, principal: null, detail };
}

export async function addWorktree(path: string, rev: string, cwd: string): Promise<void> {
  const run = await git(['worktree', 'add', '--detach', '--force', path, rev], cwd);
  if (run.code !== 0) throw new GitError(`git worktree add failed: ${run.stderr.trim()}`);
}

/**
 * Forgets the worktree at `path`, and no other, once its directory is
 * deleted. Git refuses to remove a worktree whose directory has lost its
 * `.git` file, and removes its record of one whose directory is gone, found by
 * the path it was added at: `git worktree prune` would also forget every other
 * worktree git has lost track of, the person's among them.
 */
export async function removeWorktree(path: string, cwd: string): Promise<void> {
  await git(['worktree', 'remove', '--force', path], cwd);
}
