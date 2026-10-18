/**
 * The edge where the harness meets git.
 *
 * Reads, except for two things ADR-0003 allows and bounds: a temporary
 * worktree, added and always removed by the sandbox, and nothing else. Every
 * call is an argument vector, never a shell string, so a path or a ref cannot
 * become a command.
 */

import { execFile } from 'node:child_process';

import type { FileChange, LocalBranch } from './types.js';

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

/** A work tree as one start of git names it: its top, and the git directory its worktrees share. */
export interface WorkTree {
  readonly root: string;
  readonly commonDir: string;
}

/**
 * The top of the work tree holding `cwd` and the common directory, asked of
 * git in one start where {@link workTreeRoot} and {@link commonDirectory}
 * are two: `null` outside a work tree, and `'unread'` where the one answer
 * cannot be taken for the two, which are then to be asked for as they were.
 *
 * Measured with git 2.43 and 2.55, rev-parse answers the two in the order
 * they stand on its line, a line each, and prints nothing where the first
 * fails. Its manual says of that only that `--show-toplevel` reports an
 * error where there is no working tree (git-rev-parse(1), Options for
 * Files, as git 2.55.0 has it, read 2026-10-14), so nothing is read on
 * trust. Two lines that are each what `trim` would leave, from a git that
 * did not fail, are the two answers. Nothing printed, by a git that
 * failed, is the first question failing, the one {@link workTreeRoot}
 * asks: `cwd` is in no work tree. Anything else is not read: a path that
 * holds a line break is more lines than two, and so is what a git before
 * 2.31 would print, to which `--path-format=absolute` is a flag to hand
 * back (the same manual, Options for Filtering; the option is new in the
 * release notes of 2.31.0). No such git was measured.
 *
 * `--path-format` reaches only what follows it on the line (Options for
 * Files), so the top is printed as it is where it is asked for alone. The
 * common directory is asked for from `cwd` here, and from the top by
 * {@link commonDirectory}: the same directory only where `cwd` is the top.
 */
export async function workTree(cwd: string): Promise<WorkTree | 'unread' | null> {
  const run = await git(['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir'], cwd);
  if (run.stdout === '') return run.code === 0 ? 'unread' : null;
  const lines = run.stdout.split('\n');
  if (run.code !== 0 || lines.length !== 3 || lines[2] !== '') return 'unread';
  const root = lines[0]!;
  const commonDir = lines[1]!;
  if (root === '' || commonDir === '' || root.trim() !== root || commonDir.trim() !== commonDir) return 'unread';
  return { root, commonDir };
}

/**
 * Where git runs the hook `name` from, absolute: `core.hooksPath` read as git
 * reads it - relative to the work tree, absolute, or under `~` - and a linked
 * worktree's shared hooks. `null` when git cannot say, before 2.31.
 */
export async function hookPath(name: string, cwd: string): Promise<string | null> {
  return value(['rev-parse', '--path-format=absolute', '--git-path', `hooks/${name}`], cwd);
}

const HEADS = 'refs/heads/';

/**
 * The checked-out branch's name, or `null` on a detached head: what HEAD
 * points at, with `refs/heads/` taken off and nothing else. `--short` gives
 * the shortest name git reads as that ref and no other, which is another
 * name where a tag, or a ref under `refs/`, has the branch's: measured with
 * git 2.55, on `claude/brief-042-x` beside the tag `claude/brief-042-x` it
 * answers `heads/claude/brief-042-x`, which no template reads, and the
 * brief went unnamed (ADR-0005). A HEAD that points outside `refs/heads/`,
 * as `git symbolic-ref HEAD refs/tags/x` leaves it, is named as git status
 * names it, the ref whole.
 */
export async function currentBranch(cwd: string): Promise<string | null> {
  const ref = await value(['symbolic-ref', '--quiet', 'HEAD'], cwd);
  return ref !== null && ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref;
}

/**
 * The remote's default branch as a local ref, such as `origin/main`, or
 * `null`. This is a ref the harness hands git and spec-brief as the base, so
 * it is the short name git reads as that ref and no other: beside a local
 * branch or a tag named `origin/main`, measured with git 2.55, it is
 * `remotes/origin/main`, where `origin/main` would be read as the branch or
 * the tag (gitrevisions(7), the order a ref name is read in).
 */
export async function remoteDefault(cwd: string): Promise<string | null> {
  return value(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd);
}

/**
 * Every local branch. The two are one name but where a tag, or a ref under
 * `refs/`, has the branch's: `main` beside the tag `main` is the ref
 * `heads/main`. A ref name holds no control character
 * (git-check-ref-format(1)), so a tab parts the two.
 */
export async function localBranches(cwd: string): Promise<LocalBranch[]> {
  const listed = await value(['for-each-ref', '--format=%(refname:lstrip=2)%09%(refname:short)', HEADS], cwd);
  // for-each-ref fails only where git itself does, outside a repository,
  // where init never runs: the null check is there for the type.
  if (listed === null || listed === '') return [];
  return listed.split('\n').map((line) => {
    const parts = line.split('\t');
    return { name: parts[0]!, ref: parts[1]! };
  });
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
    const letter = code.charAt(0);
    const status = letter as FileChange['status'];
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
  const detail = text.trim().split('\n')[0]!;
  // git exits 0 only for a signature by a listed principal, which it names:
  // either condition alone is equivalent to both, and both trust neither.
  return run.code === 0 && principal !== undefined ? { good: true, principal, detail } : { good: false, principal: null, detail };
}

export async function addWorktree(path: string, rev: string, cwd: string): Promise<void> {
  const run = await git(['worktree', 'add', '--detach', '--force', path, rev], cwd);
  if (run.code !== 0) throw new GitError(`git worktree add failed: ${run.stderr.trim()}`);
}

/**
 * Has git remove the worktree at `path`, and no other, with its record of it,
 * and answers whether git did. Git deletes what it can of the worktree's
 * directory and forgets the worktree even when it cannot delete it all. It
 * refuses a worktree whose directory has lost its `.git` file, and removes
 * its record of one whose directory is gone, found by the path it was added
 * at: `git worktree prune` would also forget every other worktree git has
 * lost track of, the person's among them.
 */
export async function removeWorktree(path: string, cwd: string): Promise<boolean> {
  // The sandbox asks again when this answers false, and git, asked again
  // about a worktree it has forgotten, changes nothing: the mutant that
  // always answers false is equivalent.
  return (await git(['worktree', 'remove', '--force', path], cwd)).code === 0;
}
