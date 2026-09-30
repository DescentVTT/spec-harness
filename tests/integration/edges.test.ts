import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ConfigError, DEFAULT_CONFIG } from '../../src/config.js';
import { loadConfig, readJsonObject, readText, realSpelling, repositoryPath, stateDirectory, writeAtomic } from '../../src/fs.js';
import { addWorktree, blameLine, changes, GitError, mergeBase, revision, show, stagedChanges, workTreeRoot } from '../../src/git.js';
import { runCommand, withWorktree } from '../../src/sandbox.js';
import { createSiblings, locate, runSibling, SiblingError } from '../../src/siblings.js';
import { brief, BRIEF_FILE, cleanup, cli, ignoresCase, install, installFake, parsed, repository, ROOT, temp } from './helpers.js';

afterAll(cleanup);

describe('paths as the filesystem spells them', () => {
  it('resolves a path that does not exist yet through the nearest ancestor that does', () => {
    const root = temp();
    mkdirSync(join(root, 'src'));
    expect(realSpelling(join(root, 'src', 'new', 'file.ts'))).toBe(join(root, 'src', 'new', 'file.ts'));
    expect(realSpelling(root)).toBe(root);
  });

  it('resolves a link on the way to a path that does not exist yet', () => {
    const root = temp();
    mkdirSync(join(root, 'target'));
    // A junction on Windows, which needs no privilege; a symbolic link elsewhere.
    symlinkSync(join(root, 'target'), join(root, 'link'), 'junction');
    expect(realSpelling(join(root, 'link', 'new', 'file.ts'))).toBe(join(realpathSync.native(join(root, 'target')), 'new', 'file.ts'));
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

  it('reads a JSON object, no file as none, and anything else as unreadable', async () => {
    const root = temp();
    expect(await readJsonObject(join(root, 'missing.json'))).toBeNull();
    const cases: [string, unknown][] = [['{"a":1}', { a: 1 }], ['null', 'unreadable'], ['5', 'unreadable'], ['[]', 'unreadable'], ['{', 'unreadable']];
    for (const [content, expected] of cases) {
      writeFileSync(join(root, 'x.json'), content);
      expect(await readJsonObject(join(root, 'x.json')), content).toEqual(expected);
    }
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

  it('says which git command failed, and what git said, on one line', async () => {
    const repo = repository({ 'a.txt': 'a\n' });
    const failure = async (work: Promise<unknown>): Promise<Error> => work.then(() => new Error('it did not fail'), (error: Error) => error);
    const diff = await failure(changes('no-such-ref', 'HEAD', repo.root));
    expect(diff.name).toBe('GitError');
    expect(diff.message).toMatch(/^git diff no-such-ref HEAD failed: \S/);
    const staged = await failure(stagedChanges(temp()));
    expect(staged.message).toMatch(/^git diff --cached failed: \S/);
    const added = await failure(addWorktree(join(temp(), 'wt'), 'no-such-ref', repo.root));
    expect(added.message).toMatch(/^git worktree add failed: \S/);
    for (const error of [diff, staged, added]) expect(error.message.endsWith('\n')).toBe(false);
  });

  it('keeps the harness\'s state where every worktree of the repository shares it (ADR-0003)', async () => {
    const repo = repository({ [BRIEF_FILE]: brief({ protected: ['src/db/**'] }) });
    const linked = join(temp(), 'linked');
    repo.git('worktree', 'add', '-q', '-b', 'brief/001-rotate', linked);
    expect((await cli(['escalate', '--path', 'src/db/x.ts', '--reason', 'r'], linked)).code).toBe(1);
    const listed = parsed<{ waiting: { id: string }[] }>(await cli(['escalate', '--list', '--format', 'json'], repo.root));
    expect(listed.waiting.map((request) => request.id)).toEqual(['E-001-1']);
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
    install(root, 'spec-brief');
    const found = locate('spec-brief', root, DEFAULT_CONFIG);
    expect(found).toMatchObject({
      kind: 'found',
      command: [process.execPath, join(root, 'node_modules', '@descent-vtt', 'spec-brief', 'bin', 'spec-brief.js')],
    });
    expect(found.kind === 'found' ? found.version : null).toBe(JSON.parse(readFileSync(join(root, 'node_modules', '@descent-vtt', 'spec-brief', 'package.json'), 'utf8')).version);
    expect(locate('spec-guard', root, DEFAULT_CONFIG).kind).toBe('absent');
  });

  it('reads the installed version, and runs a sibling at its minimum or later', () => {
    const root = temp();
    const bin = installFake(root, 'spec-guard', JSON.stringify({ name: '@descent-vtt/spec-guard', version: '0.12.0' }));
    expect(locate('spec-guard', root, DEFAULT_CONFIG)).toEqual({ kind: 'found', command: [process.execPath, bin], version: '0.12.0' });
    installFake(root, 'spec-graph', JSON.stringify({ version: '1.0.0-rc.1' }));
    expect(locate('spec-graph', root, DEFAULT_CONFIG)).toMatchObject({ kind: 'found', version: '1.0.0-rc.1' });
  });

  it('never runs a sibling older than its minimum, and names the minimum', () => {
    const root = temp();
    installFake(root, 'spec-guard', JSON.stringify({ version: '0.11.0' }));
    const reason = 'spec-guard 0.11.0 is installed here; spec-harness needs 0.12.0 or later: npm install --save-dev @descent-vtt/spec-guard@latest';
    expect(locate('spec-guard', root, DEFAULT_CONFIG)).toEqual({ kind: 'outdated', version: '0.11.0', reason });
  });

  it('counts a version it cannot read as outdated: no package.json, not JSON, or no version in it', () => {
    for (const manifest of [null, '{ "version": ', 'null', '{}', '{ "version": 12 }', '{ "version": "next" }']) {
      const root = temp();
      installFake(root, 'spec-brief', manifest);
      const sibling = locate('spec-brief', root, DEFAULT_CONFIG);
      expect(sibling.kind, String(manifest)).toBe('outdated');
      expect(sibling.kind === 'outdated' ? sibling.reason : '', String(manifest)).toContain('spec-harness needs 0.2.0 or later');
    }
  });

  it('prefers the configured command to an installed one, and leaves its version to the configuration', () => {
    const config = { ...DEFAULT_CONFIG, tools: { ...DEFAULT_CONFIG.tools, 'spec-brief': ['node', 'x.js'] } };
    expect(locate('spec-brief', ROOT, config)).toEqual({ kind: 'found', command: ['node', 'x.js'], version: null });
    const root = temp();
    installFake(root, 'spec-brief', JSON.stringify({ version: '0.1.0' }));
    expect(locate('spec-brief', root, config)).toEqual({ kind: 'found', command: ['node', 'x.js'], version: null });
  });

  it('answers an outdated sibling as it answers an absent one, with the reason', async () => {
    const root = temp();
    installFake(root, 'spec-brief', JSON.stringify({ version: '0.1.0' }));
    installFake(root, 'spec-guard', JSON.stringify({ version: '0.11.0' }));
    const siblings = createSiblings(root, DEFAULT_CONFIG);
    expect(await siblings.json('spec-guard', ['query'])).toEqual({
      absent: 'spec-guard 0.11.0 is installed here; spec-harness needs 0.12.0 or later: npm install --save-dev @descent-vtt/spec-guard@latest',
    });
    await expect(siblings.briefs()).rejects.toThrow('spec-brief 0.1.0 is installed here; spec-harness needs 0.2.0 or later');
  });

  it('runs "node" as this Node, and passes the exit code through', async () => {
    const run = await runSibling(['node', '-e', 'console.log(process.execPath); process.exit(4)'], [], temp());
    expect(run.code).toBe(4);
    expect(run.stdout.trim()).toBe(process.execPath);
  });

  it('runs "node" as this Node even where PATH finds none', async () => {
    const path = process.env['PATH'];
    process.env['PATH'] = temp();
    try {
      expect((await runSibling(['node', '-e', 'process.stdout.write("ran")'], [], temp())).stdout).toBe('ran');
    } finally {
      process.env['PATH'] = path;
    }
  });

  it('runs a sibling with colour off and the rest of the environment as it is', async () => {
    process.env['SPEC_HARNESS_TEST_KEPT'] = 'kept';
    try {
      const run = await runSibling(['node', '-e', 'process.stdout.write(JSON.stringify([process.env.NO_COLOR, process.env.FORCE_COLOR, process.env.SPEC_HARNESS_TEST_KEPT]))'], [], temp());
      expect(JSON.parse(run.stdout)).toEqual(['1', '0', 'kept']);
    } finally {
      delete process.env['SPEC_HARNESS_TEST_KEPT'];
    }
  });

  it('answers a sibling stopped at its time limit, or one that cannot start, with -1 and what went wrong', async () => {
    expect((await runSibling(['node', '-e', 'setTimeout(() => {}, 20000)'], [], temp(), 200)).code).toBe(-1);
    expect(await runSibling(['no-such-program-for-spec-harness'], [], temp())).toEqual({
      code: -1,
      stdout: '',
      stderr: 'cannot start "no-such-program-for-spec-harness": name the tool\'s script, such as ["node", "node_modules/@descent-vtt/<tool>/bin/<tool>.js"]',
    });
  });

  it('answers "absent" for JSON from a sibling that is not there', async () => {
    const siblings = createSiblings(temp(), DEFAULT_CONFIG);
    expect(await siblings.json('spec-guard', ['query'])).toEqual({
      absent: 'spec-guard is not installed here: npm install --save-dev @descent-vtt/spec-guard, or name its command under "tools" in .spec-harness.json',
    });
    await expect(siblings.briefs()).rejects.toBeInstanceOf(SiblingError);
    await expect(siblings.briefs()).rejects.toMatchObject({ name: 'SiblingError' });
  });
});
