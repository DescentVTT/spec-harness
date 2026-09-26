import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ConfigError, DEFAULT_CONFIG } from '../../src/config.js';
import { loadConfig, readText, realSpelling, repositoryPath, stateDirectory, writeAtomic } from '../../src/fs.js';
import { blameLine, changes, GitError, mergeBase, revision, show, stagedChanges, workTreeRoot } from '../../src/git.js';
import { runCommand, withWorktree } from '../../src/sandbox.js';
import { createSiblings, locate, runSibling, SiblingError } from '../../src/siblings.js';
import { cleanup, ignoresCase, repository, ROOT, temp } from './helpers.js';

afterAll(cleanup);

describe('paths as the filesystem spells them', () => {
  it('resolves a path that does not exist yet through the nearest ancestor that does', () => {
    const root = temp();
    mkdirSync(join(root, 'src'));
    expect(realSpelling(join(root, 'src', 'new', 'file.ts'))).toBe(join(root, 'src', 'new', 'file.ts'));
    expect(realSpelling(root)).toBe(root);
  });

  it('corrects the case of what exists, on a filesystem that ignores case', () => {
    const root = temp();
    mkdirSync(join(root, 'Src', 'DB'), { recursive: true });
    writeFileSync(join(root, 'Src', 'DB', 'Schema.ts'), '');
    if (!ignoresCase(root)) return; // Here SRC and Src are different directories; there is nothing to correct.
    expect(realSpelling(join(root, 'SRC', 'db', 'SCHEMA.TS'))).toBe(join(root, 'Src', 'DB', 'Schema.ts'));
    // The part that does not exist keeps the spelling it was given.
    expect(realSpelling(join(root, 'src', 'db', 'New.ts'))).toBe(join(root, 'Src', 'DB', 'New.ts'));
  });

  it('names a path relative to the repository, or null outside it', () => {
    const root = temp();
    mkdirSync(join(root, 'src'));
    expect(repositoryPath('src/a.ts', root, root)).toBe('src/a.ts');
    expect(repositoryPath('a.ts', root, join(root, 'src'))).toBe('src/a.ts');
    expect(repositoryPath(join(root, 'src', 'a.ts'), root, '/')).toBe('src/a.ts');
    expect(repositoryPath('.', root, root)).toBe('');
    expect(repositoryPath('../x.ts', root, root)).toBeNull();
    expect(repositoryPath(join(root, '..'), root, root)).toBeNull();
    expect(repositoryPath(temp(), root, root)).toBeNull();
  });

  it('reads a name that starts with two dots as inside the repository', () => {
    // Only a ".." segment climbs out; "..env" is a file at the root, and an
    // answer of "outside" would let every write to it through.
    const root = temp();
    expect(repositoryPath('..env', root, root)).toBe('..env');
    expect(repositoryPath('..hidden/x.ts', root, root)).toBe('..hidden/x.ts');
  });
});

describe('state and files', () => {
  it('keeps state under the git common directory, creating it on demand', async () => {
    const common = temp();
    const directory = await stateDirectory(common, 'escalations');
    expect(directory).toBe(join(common, 'spec-harness', 'escalations'));
    expect(existsSync(directory)).toBe(true);
  });

  it('writes a file whole, creating its directory, and leaves no temporary file', async () => {
    const root = temp();
    const file = join(root, 'a', 'b', 'c.txt');
    await writeAtomic(file, 'one');
    await writeAtomic(file, 'two');
    expect(readFileSync(file, 'utf8')).toBe('two');
    expect(readdirSync(join(root, 'a', 'b'))).toEqual(['c.txt']);
    expect(await readText(file)).toBe('two');
    expect(await readText(join(root, 'missing.txt'))).toBeNull();
  });

  it('loads the configuration, the defaults without one, and refuses one that is not JSON', async () => {
    const root = temp();
    expect(await loadConfig(root)).toEqual({ config: DEFAULT_CONFIG, file: null });
    writeFileSync(join(root, '.spec-harness.json'), '{"outOfScope":"deny"}');
    const loaded = await loadConfig(root);
    expect(loaded.config.outOfScope).toBe('deny');
    expect(loaded.file).toBe(join(root, '.spec-harness.json'));
    writeFileSync(join(root, '.spec-harness.json'), '{');
    await expect(loadConfig(root)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('git', () => {
  it('answers null for what does not exist, and throws for a diff it cannot take', async () => {
    const repo = repository({ 'a.txt': 'a\n' });
    const outside = temp();
    expect(await workTreeRoot(outside)).toBeNull();
    expect(await revision('no-such-ref', repo.root)).toBeNull();
    expect(await show('HEAD', 'missing.txt', repo.root)).toBeNull();
    expect(await show('HEAD', 'a.txt', repo.root)).toBe('a\n');
    expect(await blameLine('HEAD', 'a.txt', 9, repo.root)).toBeNull();
    expect(await blameLine('HEAD', 'a.txt', 1, repo.root)).toBe(repo.git('rev-parse', 'HEAD'));
    expect(await mergeBase('HEAD', 'no-such-ref', repo.root)).toBeNull();
    await expect(changes('no-such-ref', 'HEAD', repo.root)).rejects.toBeInstanceOf(GitError);
    await expect(stagedChanges(outside)).rejects.toBeInstanceOf(GitError);
  });

  it('blames the working tree, where a line nobody committed belongs to no commit', async () => {
    const repo = repository({ 'a.txt': 'one\ntwo\n' });
    const committed = repo.git('rev-parse', 'HEAD');
    repo.write('a.txt', 'zero\none\ntwo\n');
    expect(await blameLine(null, 'a.txt', 1, repo.root)).toMatch(/^0+$/);
    expect(await blameLine(null, 'a.txt', 2, repo.root)).toBe(committed);
    // At HEAD the same number is another line.
    expect(await blameLine('HEAD', 'a.txt', 1, repo.root)).toBe(committed);
  });
});

describe('the sandbox', () => {
  it('runs a command line through the shell, output and errors together', async () => {
    const root = temp();
    const run = await runCommand('node -e "console.log(1); console.error(2); process.exit(3)"', root, 30);
    expect(run.exitCode).toBe(3);
    expect(run.output.replace(/\r/g, '').split('\n').filter(Boolean).sort()).toEqual(['1', '2']);
  });

  it('stops a command at its timeout, and answers null', async () => {
    const started = Date.now();
    const run = await runCommand('node -e "setTimeout(() => {}, 60000)"', temp(), 1);
    expect(run.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it('removes its worktree after the job, and after a job that throws', async () => {
    const repo = repository({ 'a.txt': 'a\n' });
    let seen = '';
    const answer = await withWorktree(repo.root, 'HEAD', async (directory) => {
      seen = directory;
      expect(readFileSync(join(directory, 'a.txt'), 'utf8')).toBe('a\n');
      return 42;
    });
    expect(answer).toBe(42);
    expect(existsSync(seen)).toBe(false);
    await expect(
      withWorktree(repo.root, 'HEAD', async (directory) => {
        seen = directory;
        throw new Error('the job failed');
      }),
    ).rejects.toThrow('the job failed');
    expect(existsSync(seen)).toBe(false);
    expect(repo.git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);
    await expect(withWorktree(repo.root, 'no-such-ref', async () => 1)).rejects.toThrow('git worktree add failed');
  });
});

describe('finding the siblings', () => {
  it('finds a sibling where the repository installed it, and runs it with this Node', () => {
    const root = temp();
    cpSync(join(ROOT, 'node_modules', '@descent-vtt', 'spec-brief'), join(root, 'node_modules', '@descent-vtt', 'spec-brief'), { recursive: true });
    expect(locate('spec-brief', root, DEFAULT_CONFIG)).toEqual({
      kind: 'found',
      command: [process.execPath, join(root, 'node_modules', '@descent-vtt', 'spec-brief', 'bin', 'spec-brief.js')],
    });
    expect(locate('spec-guard', root, DEFAULT_CONFIG).kind).toBe('absent');
  });

  it('prefers the configured command to an installed one', () => {
    const config = { ...DEFAULT_CONFIG, tools: { ...DEFAULT_CONFIG.tools, 'spec-brief': ['node', 'x.js'] } };
    expect(locate('spec-brief', ROOT, config)).toEqual({ kind: 'found', command: ['node', 'x.js'] });
  });

  it('runs "node" as this Node, and passes the exit code through', async () => {
    const run = await runSibling(['node', '-e', 'console.log(process.execPath); process.exit(4)'], [], temp());
    expect(run.code).toBe(4);
    expect(run.stdout.trim()).toBe(process.execPath);
  });

  it('answers "absent" for JSON from a sibling that is not there', async () => {
    const siblings = createSiblings(temp(), DEFAULT_CONFIG);
    expect(await siblings.json('spec-guard', ['query'])).toEqual({
      absent: 'spec-guard is not installed here: npm install --save-dev @descent-vtt/spec-guard, or name its command under "tools" in .spec-harness.json',
    });
    await expect(siblings.briefs()).rejects.toBeInstanceOf(SiblingError);
  });
});
