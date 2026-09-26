import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ConfigError, parseConfig } from '../src/config.js';
import { HOOK_COMMAND, mergeMcp } from '../src/setup.js';

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
    expect(pkg['peerDependencies']).toBeUndefined();
    expect(pkg['optionalDependencies']).toBeUndefined();
    expect(pkg['bundleDependencies'] ?? pkg['bundledDependencies']).toBeUndefined();
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
    for (const path of ['src/siblings.ts', 'src/git.ts']) {
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

  it('runs exactly the hook command init installs, before and after every writing tool', () => {
    const hooks = json('hooks/hooks.json') as { hooks: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]> };
    expect(Object.keys(hooks.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse']);
    for (const groups of Object.values(hooks.hooks)) {
      expect(groups).toHaveLength(1);
      expect(groups[0]?.matcher).toBe('Edit|Write|MultiEdit|NotebookEdit');
      expect(groups[0]?.hooks.map((hook) => [hook.type, hook.command])).toEqual([['command', HOOK_COMMAND]]);
    }
  });

  it('registers the MCP server as init does', () => {
    expect(json('.mcp.json')).toEqual(mergeMcp({}));
    expect(Object.keys((json('.mcp.json') as { mcpServers: object }).mcpServers)).toEqual(['spec-harness']);
  });
});

describe('the README', () => {
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
    expect(ranges.map(([, name]) => name).sort()).toEqual(['mergeClaudeSettings', 'mergeMcp', 'mergeSpecGraph', 'parseOptions']);
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
