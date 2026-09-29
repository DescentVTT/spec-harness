import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pluginDrift, releaseOf } from '../scripts/release.js';
import { ConfigError, parseConfig, SIBLINGS } from '../src/config.js';
import { GUARD_HOOK, mcpServer, mergeClaudeSettings, mergeMcp, PROJECT_DIR, PROJECT_DIR_OR_HERE } from '../src/configure.js';
import { scanMarkdown } from '../src/vendor/spec-core/markdown/index.js';
import { CLAUDE_CODE_MINIMUM, MINIMUM_VERSIONS } from '../src/versions.js';

/**
 * Claims the repository makes about itself, checked rather than trusted. This
 * suite is not the unit suite, so it may read the disk and ask git.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const text = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const json = (path: string): Record<string, unknown> => JSON.parse(text(path)) as Record<string, unknown>;

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** The harness's own source: everything in src/ but the vendored spec-core copies. */
const sources = [...walk('src')].filter((path) => path.endsWith('.ts') && !path.startsWith('src/vendor/'));

function importsOf(path: string): string[] {
  const source = text(path);
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)'([^']+)'/gm)].map((match) => match[1] as string);
}

describe('dependencies', () => {
  it('has no runtime dependency', () => {
    const pkg = json('package.json');
    expect(pkg['dependencies'] ?? {}).toEqual({});
    expect(pkg['optionalDependencies']).toBeUndefined();
    expect(pkg['bundleDependencies'] ?? pkg['bundledDependencies']).toBeUndefined();
  });

  it('asks npm for the siblings at the minimums the code holds them to, spec-brief alone required', () => {
    const pkg = json('package.json');
    expect(pkg['peerDependencies']).toEqual(Object.fromEntries(SIBLINGS.map((name) => [`@descent-vtt/${name}`, `>=${MINIMUM_VERSIONS[name]}`])));
    // A missing spec-graph or spec-guard is reported, never required (ADR-0002).
    expect(pkg['peerDependenciesMeta']).toEqual({ '@descent-vtt/spec-graph': { optional: true }, '@descent-vtt/spec-guard': { optional: true } });
  });

  it('imports nothing but its own modules and Node\'s', () => {
    expect(sources.length).toBeGreaterThan(20);
    const outside = sources.flatMap((path) => importsOf(path).filter((specifier) => !specifier.startsWith('./') && !specifier.startsWith('node:')).map((s) => `${path}: ${s}`));
    expect(outside).toEqual([]);
  });

  it('never imports a sibling tool, which it runs through its command line', () => {
    const everywhere = [...walk('src'), ...walk('tests')].filter((path) => /\.(?:ts|js|mjs)$/.test(path));
    const offenders = everywhere.filter((path) => importsOf(path).some((specifier) => specifier.includes('@descent-vtt/')));
    expect(offenders).toEqual([]);
  });

  it('reaches the vendored spec-core copies only through their index modules', () => {
    const deep = sources.flatMap((path) =>
      importsOf(path)
        .filter((specifier) => specifier.includes('vendor/spec-core/') && !/vendor\/spec-core\/[a-z]+\/index\.js$/.test(specifier))
        .map((specifier) => `${path}: ${specifier}`),
    );
    expect(deep).toEqual([]);
  });
});

describe('no shell', () => {
  it('starts git and the siblings with an argument vector, never through a shell', () => {
    for (const path of ['src/siblings.ts', 'src/git.ts', 'src/host.ts']) {
      const source = text(path);
      expect(source, path).not.toMatch(/shell:\s*true/);
      // exec and spawn with shell: true read a line as shell syntax; RegExp#exec is not a process.
      expect(source, path).not.toMatch(/(?<![.\w])(?:exec|execSync|spawn|spawnSync)\(/);
      expect(source, path).toMatch(/\bexecFile\(/);
    }
  });
});

describe('the tree', () => {
  /**
   * Every file the repository holds or is about to: tracked, or untracked and
   * not ignored, so node_modules, dist, coverage and reports are left out by
   * the .gitignore that leaves them out of commits.
   */
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\u0000')
    .filter((path) => path !== '' && existsSync(join(ROOT, path)));

  it('has LF line endings and no other control character', () => {
    for (const expected of ['README.md', 'src/cli.ts', 'tests/source.test.ts', 'bin/spec-harness.js', 'hooks/hooks.json', '.gitattributes']) {
      expect(files, expected).toContain(expected);
    }
    for (const ignored of ['node_modules/', 'dist/', 'coverage/', 'reports/']) {
      expect(files.filter((path) => path.startsWith(ignored)), ignored).toEqual([]);
    }
    const offenders = files.filter((path) => {
      const content = readFileSync(join(ROOT, path), 'utf8');
      for (let i = 0; i < content.length; i += 1) {
        const code = content.charCodeAt(i);
        if ((code < 32 && code !== 10) || code === 127) return true;
      }
      return false;
    });
    expect(offenders).toEqual([]);
  });
});

describe('the skills', () => {
  const names = readdirSync(join(ROOT, 'skills')).sort();

  it('are the four workflows, under 30,000 characters together (ADR-0009)', () => {
    expect(names).toEqual(['close-round', 'draft-brief', 'run-round', 'split-goal']);
    const total = names.reduce((sum, name) => sum + text(`skills/${name}/SKILL.md`).length, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(30_000);
  });

  it('each name themselves and say when to use them in their front matter', () => {
    for (const name of names) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(text(`skills/${name}/SKILL.md`))?.[1];
      expect(front, name).toBeDefined();
      const fields = Object.fromEntries((front as string).split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
      expect(fields['name'], name).toBe(name);
      expect(fields['description']?.length ?? 0, name).toBeGreaterThan(40);
    }
  });
});

describe('the plugin', () => {
  const version = json('package.json')['version'];

  it('names itself spec-harness, at the package\'s version', () => {
    const plugin = json('.claude-plugin/plugin.json');
    expect(plugin['name']).toBe('spec-harness');
    expect(plugin['version']).toBe(version);
    const marketplace = json('.claude-plugin/marketplace.json') as { plugins: { name: string; source: string; version: string }[] };
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({ name: 'spec-harness', source: './', version });
  });

  it('runs exactly the hooks init installs, before and after every writing tool', () => {
    const hooks = json('hooks/hooks.json') as { hooks: Record<string, { matcher: string; hooks: Record<string, unknown>[] }[]> };
    expect(hooks).toEqual(mergeClaudeSettings({}));
    expect(Object.keys(hooks.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse']);
    for (const groups of Object.values(hooks.hooks)) {
      expect(groups).toHaveLength(1);
      expect(groups[0]?.matcher).toBe('Edit|Write|MultiEdit|NotebookEdit');
      expect(groups[0]?.hooks).toEqual([GUARD_HOOK]);
    }
  });

  it('registers the MCP server as init does, naming the project as a plugin names it', () => {
    expect(json('.mcp.json')).toEqual({ mcpServers: { 'spec-harness': mcpServer(PROJECT_DIR) } });
    // A project's own .mcp.json needs a default where the plugin's does not; nothing else differs.
    expect(JSON.stringify(mergeMcp({})).split(PROJECT_DIR_OR_HERE).join(PROJECT_DIR)).toBe(JSON.stringify(json('.mcp.json')));
  });
});

describe('the release', () => {
  const version = json('package.json')['version'] as string;

  it('has notes in the changelog for the version package.json names, so the version cannot be tagged without them', () => {
    expect(releaseOf(`v${version}`, version, text('CHANGELOG.md'))).toMatchObject({ version });
  });

  it('carries the package version in both plugin manifests', () => {
    expect(pluginDrift(version, json('.claude-plugin/plugin.json'), json('.claude-plugin/marketplace.json'))).toBeNull();
  });
});

describe('the documents the package ships', () => {
  it('link only to files it ships, or by absolute URL, so that a link works in node_modules and on npmjs.com', () => {
    const files = json('package.json')['files'] as string[];
    // `/README.md` is the root's README: npm reads a name with no slash at any
    // depth, and `README.md` packed spec-core's vendored README beside it.
    const ships = (path: string): boolean => files.some((entry) => path === entry.replace(/^\//, '') || path.startsWith(`${entry}/`));
    const documents = ['README.md', 'CHANGELOG.md', ...[...walk('skills')].filter((path) => path.endsWith('.md'))];
    expect(documents.every(ships)).toBe(true);
    expect(files).toContain('/README.md');
    expect(ships('src/vendor/spec-core/README.md')).toBe(false);
    const dead: string[] = [];
    for (const document of documents) {
      // Read as a renderer reads it: a link written out in a code span, as the
      // changelog does to show one, is text there and never followed.
      for (const { target } of scanMarkdown(text(document)).links) {
        if (/^(?:[a-z][a-z+.-]*:|#)/i.test(target)) continue;
        const path = posix.join(posix.dirname(document), target.split('#')[0] as string);
        if (!ships(path) || !existsSync(join(ROOT, path))) dead.push(`${document}: ${target}`);
      }
    }
    expect(dead).toEqual([]);
  });
});

describe('the README', () => {
  it('states the minimum version of each sibling where it says what to install', () => {
    const install = text('README.md').split('## A round')[0] as string;
    for (const name of SIBLINGS) expect(install, name).toContain(`${name} ${MINIMUM_VERSIONS[name]}`);
  });

  it('states the Claude Code release the hooks need where it says what to install, as the plugin does (ADR-0012)', () => {
    // The first release whose changelog runs a hook's `args`, the exec form the guard is written in, and the one doctor checks.
    const claudeCode = `Claude Code ${CLAUDE_CODE_MINIMUM} or later`;
    expect(text('README.md').split('## A round')[0]).toContain(claudeCode);
    expect(json('.claude-plugin/plugin.json')['description']).toContain(claudeCode);
  });

  /** The keys parseConfig accepts, read from its own refusals so that a key added there is a key checked here. */
  function keysAt(raw: (key: string) => unknown): string[] {
    try {
      parseConfig(raw('zzz-not-a-key'));
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      return ((error as Error).message.split('; the keys are ')[1] ?? '').split(', ');
    }
    throw new Error('parseConfig accepted an unknown key');
  }

  it('documents every configuration key parseConfig accepts', () => {
    const readme = text('README.md');
    const table = readme.slice(readme.indexOf('## Configuration'), readme.indexOf('**Exit codes:**'));
    const top = keysAt((key) => ({ [key]: 1 })).filter((key) => key !== '$schema');
    expect(top).toContain('rulings');
    const documented: string[] = [];
    for (const key of top) {
      if (['rulings', 'dependencies', 'context', 'assertions', 'probes'].includes(key)) {
        for (const nested of keysAt((unknown) => ({ [key]: { [unknown]: 1 } }))) documented.push(`${key}.${nested}`);
      } else {
        documented.push(key);
      }
    }
    expect(documented.length).toBeGreaterThanOrEqual(11);
    expect(documented.filter((key) => !table.includes(`\`${key}\``))).toEqual([]);
  });
});

describe('the core mutation sweep', () => {
  it('mutates exactly the pure functions of the edge modules it names', () => {
    // Read as text: the configuration is a module Stryker loads, not one this suite type-checks.
    const config = text('stryker.core.config.mjs');
    const ranges = [...config.matchAll(/'(src\/[a-z]+\.ts:\d+-\d+)': '([A-Za-z]+)'/g)].map((match) => [match[1] as string, match[2] as string] as const);
    expect(ranges.map(([, name]) => name).sort()).toEqual(['parseOptions']);
    expect(config).toContain('...Object.keys(PURE_RANGES)');
    for (const [range, name] of ranges) {
      const match = /^(src\/[a-z]+\.ts):(\d+)-(\d+)$/.exec(range);
      expect(match, range).not.toBeNull();
      const [, file, first, last] = match as RegExpExecArray;
      const lines = text(file as string).split('\n');
      expect(lines[Number(first) - 1], range).toMatch(new RegExp(`^export function ${name}\\(`));
      expect(lines[Number(last) - 1], range).toBe('}');
      expect(lines.slice(Number(first), Number(last) - 1).some((line) => line === '}'), range).toBe(false);
    }
  });

  it('mutates only modules that reach no disk, process or git', () => {
    const config = text('stryker.core.config.mjs');
    const modules = [...config.matchAll(/^\s*'(src\/[a-z]+\.ts)',$/gm)].map((match) => match[1] as string);
    expect(modules.length).toBeGreaterThanOrEqual(12);
    const edges = ['./fs.js', './git.js', './siblings.js', './sandbox.js', './round.js', './workspace.js', './commands.js', './cli.js', './server.js', './setup.js'];
    const offenders = modules.filter((path) =>
      importsOf(path).some((specifier) => /^node:(?:fs|fs\/promises|child_process|os|process)$/.test(specifier) || edges.includes(specifier)),
    );
    expect(offenders).toEqual([]);
  });

  it('holds the unit suite to its promise: no disk, no process', () => {
    const unit = [...walk('tests/unit')].filter((path) => path.endsWith('.ts'));
    expect(unit.length).toBeGreaterThan(10);
    const offenders = unit.filter((path) =>
      importsOf(path).some((specifier) => /^node:(?:fs|fs\/promises|child_process|os)$/.test(specifier) || specifier.includes('integration/')),
    );
    expect(offenders).toEqual([]);
  });
});
