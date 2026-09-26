import { describe, expect, it } from 'vitest';

import { DEFAULT_MANIFESTS } from '../../src/config.js';
import { diffManifest, ecosystemOf, manifestMatcher, pythonName, readManifest, type Dependency, type Ecosystem } from '../../src/manifests.js';

function read(ecosystem: Ecosystem, text: string): Dependency[] {
  const result = readManifest(ecosystem, text);
  if (!result.ok) throw new Error(result.error);
  return [...result.dependencies];
}

function names(ecosystem: Ecosystem, text: string): string[] {
  return read(ecosystem, text).map((d) => `${d.section} ${d.name} ${d.version}`);
}

function error(ecosystem: Ecosystem, text: string): string {
  const result = readManifest(ecosystem, text);
  if (result.ok) throw new Error('read an unreadable manifest');
  return result.error;
}

describe('which files are manifests', () => {
  it.each([
    ['package.json', 'npm'],
    ['packages/web/package.json', 'npm'],
    ['Cargo.toml', 'cargo'],
    ['crates/a/Cargo.toml', 'cargo'],
    ['go.mod', 'go'],
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'pip'],
    ['requirements-dev.txt', 'pip'],
    ['deps/requirements.test.txt', 'pip'],
    ['Directory.Packages.props', 'nuget'],
    ['src/App/App.csproj', 'nuget'],
    ['Lib.fsproj', 'nuget'],
    ['Old.vbproj', 'nuget'],
    ['Gemfile', 'bundler'],
  ])('%s is %s', (path, ecosystem) => {
    expect(ecosystemOf(path)).toBe(ecosystem);
  });

  it.each(['package-lock.json', 'package.json.bak', 'Cargo.lock', 'go.sum', 'requirements.in', 'dev-requirements.txt', 'Gemfile.lock', 'App.csproj.user', 'README.md', 'package.json/x'])(
    '%s is not a manifest',
    (path) => {
      expect(ecosystemOf(path)).toBeNull();
    },
  );

  it('matches the configured names at any depth, and nothing else', () => {
    const isManifest = manifestMatcher(DEFAULT_MANIFESTS);
    for (const path of ['package.json', 'a/b/package.json', 'requirements-dev.txt', 'x/requirements.txt', 'src/App.csproj', 'Gemfile', 'go.mod']) {
      expect(isManifest(path), path).toBe(true);
    }
    for (const path of ['package-lock.json', 'src/package.jsonc', 'Gemfile.lock', 'requirements.in', 'App.vbprojx', 'gemfile']) {
      expect(isManifest(path), path).toBe(false);
    }
  });

  it('skips a configured name it cannot read, keeping the rest', () => {
    const isManifest = manifestMatcher(['[x', 'package.json']);
    expect(isManifest('package.json')).toBe(true);
    expect(isManifest('[x')).toBe(false);
    expect(manifestMatcher([])('package.json')).toBe(false);
  });
});

describe('npm', () => {
  it('reads the four dependency sections and nothing else', () => {
    const text = JSON.stringify({
      name: 'x',
      version: '1.0.0',
      scripts: { test: 'vitest' },
      dependencies: { a: '^1.0.0' },
      devDependencies: { b: '~2.0.0', c: 'workspace:*' },
      optionalDependencies: { d: '3' },
      peerDependencies: { e: '>=4' },
      bundleDependencies: ['a'],
      engines: { node: '>=22' },
    });
    expect(names('npm', text)).toEqual([
      'dependencies a ^1.0.0',
      'devDependencies b ~2.0.0',
      'devDependencies c workspace:*',
      'optionalDependencies d 3',
      'peerDependencies e >=4',
    ]);
  });

  it('reads a manifest with no dependencies as none', () => {
    expect(names('npm', '{"name":"x"}')).toEqual([]);
  });

  it('writes a version that is not a string as it reads', () => {
    expect(names('npm', '{"dependencies":{"a":1}}')).toEqual(['dependencies a 1']);
  });

  it('refuses what it cannot read', () => {
    expect(error('npm', '{"dependencies":')).toBe('not valid JSON');
    expect(error('npm', '[]')).toBe('not a JSON object');
    expect(error('npm', 'null')).toBe('not a JSON object');
    expect(error('npm', '{"devDependencies":["a"]}')).toBe('"devDependencies" is not an object');
    expect(error('npm', '{"dependencies":"a"}')).toBe('"dependencies" is not an object');
    expect(error('npm', '{"peerDependencies":null}')).toBe('"peerDependencies" is not an object');
  });
});

describe('Cargo', () => {
  const CARGO = [
    '[package]',
    'name = "x"',
    'version = "0.1.0" # the crate, not a dependency',
    '',
    '[dependencies]',
    'serde = "1.0" # a comment',
    'tokio = { version = "1.38", features = ["full"] }',
    "rand = { version = '0.8' }",
    'local = { path = "../local" }',
    '"quoted-name" = "2"',
    '',
    '[dependencies.regex]',
    'version = "1.10"',
    'features = ["std"]',
    '',
    '[dependencies . log]',
    'default-features = false',
    '',
    '[dev-dependencies]',
    'proptest = "1"',
    '',
    '[build-dependencies]',
    'cc = "1.0"',
    '',
    "[target.'cfg(windows)'.dependencies]",
    'winapi = "0.3"',
    '',
    '[target."cfg(unix)".dependencies.nix]',
    'version = "0.29"',
    '',
    '[workspace.dependencies]',
    'anyhow = "1"',
    '',
    '[features]',
    'default = ["std"]',
    '',
    '[[bin]]',
    'name = "tool"',
  ].join('\n');

  it('reads plain, inline-table and dotted-table dependencies in every section', () => {
    expect(names('cargo', CARGO)).toEqual([
      'dependencies serde 1.0',
      'dependencies tokio 1.38',
      'dependencies rand 0.8',
      'dependencies local ',
      'dependencies quoted-name 2',
      'dependencies regex 1.10',
      'dependencies log ',
      'dev-dependencies proptest 1',
      'build-dependencies cc 1.0',
      'dependencies winapi 0.3',
      'dependencies nix 0.29',
      'workspace.dependencies anyhow 1',
    ]);
  });

  it('keeps a # inside a string, and reads a comment after it as a comment', () => {
    expect(names('cargo', '[dependencies]\na = { git = "https://x/#frag", version = "1" } # note\n')).toEqual(['dependencies a 1']);
    expect(names('cargo', "[dependencies]\nb = '1#2'\n")).toEqual(['dependencies b 1#2']);
    expect(names('cargo', '[dependencies]\nc = "a\\"#b"\n')).toEqual(['dependencies c a\\"#b']);
  });

  it('reads CRLF manifests, and arrays spread over lines', () => {
    expect(names('cargo', '[dependencies]\r\nserde = "1"\r\n[features]\r\nall = [\r\n  "a", # one\r\n  "b",\r\n]\r\n')).toEqual(['dependencies serde 1']);
  });

  it('refuses an array that never closes', () => {
    expect(error('cargo', '[features]\nall = [\n  "a",\n')).toBe('the array for "all" is never closed');
  });

  it('does not read a key before any table, or a line with no key', () => {
    expect(names('cargo', 'serde = "1"\n[dependencies]\n= "2"\njust text\n')).toEqual([]);
  });
});

describe('go.mod', () => {
  it('reads require blocks and single requires, marking the indirect ones', () => {
    const text = [
      'module example.com/x',
      '',
      'go 1.22',
      '',
      'require (',
      '\tgithub.com/a/b v1.2.3',
      '\tgolang.org/x/text v0.14.0 // indirect',
      '\t// a comment line',
      ')',
      '',
      'require github.com/c/d v0.1.0',
      'require github.com/e/f v2.0.0 // indirect',
      '',
      'replace (',
      '\tgithub.com/a/b v1.2.3 => ../b',
      ')',
      'replace github.com/c/d => github.com/c/e v1.0.0',
      'exclude github.com/g/h v1.0.0',
    ].join('\n');
    expect(names('go', text)).toEqual([
      'require github.com/a/b v1.2.3',
      'require (indirect) golang.org/x/text v0.14.0',
      'require github.com/c/d v0.1.0',
      'require (indirect) github.com/e/f v2.0.0',
    ]);
  });

  it('reads a block opened without a space, and a module without a version', () => {
    expect(names('go', 'require(\n\texample.com/a\n)\n')).toEqual(['require example.com/a ']);
  });

  it('refuses a require block that never closes', () => {
    expect(error('go', 'require (\n\tgithub.com/a/b v1\n')).toBe('a require block is never closed');
  });
});

describe('requirements files', () => {
  it('reads requirements, skipping comments, options and blank lines', () => {
    const text = [
      '# the app',
      'requests>=2.31  # http',
      'Django_Rest.Framework==3.15',
      '',
      '-r base.txt',
      '--index-url https://pypi.example/simple',
      '-e ./local',
      'numpy ; python_version >= "3.10"',
      'pkg @ https://example.com/pkg.whl#sha256=abc',
      '   ',
    ].join('\n');
    expect(names('pip', text)).toEqual([
      'requirements requests requests>=2.31',
      'requirements django-rest-framework Django_Rest.Framework==3.15',
      'requirements numpy numpy ; python_version >= "3.10"',
      'requirements pkg pkg @ https://example.com/pkg.whl#sha256=abc',
    ]);
  });

  it('normalises names as PEP 503 does', () => {
    expect(pythonName('Foo_Bar.baz>=1')).toBe('foo-bar-baz');
    expect(pythonName('  a--b__c[extra]==1')).toBe('a-b-c');
    expect(pythonName('zope.interface')).toBe('zope-interface');
    // Something that starts with no name is normalised whole, so two
    // spellings of one path still compare equal between the sides of a diff.
    expect(pythonName(' ./Local ')).toBe('-/local');
    expect(pythonName('./local')).toBe(pythonName('./LOCAL'));
  });
});

describe('pyproject.toml', () => {
  it('reads PEP 621 dependencies, optional dependencies and dependency groups', () => {
    const text = [
      '[project]',
      'name = "x"',
      'dependencies = [',
      '  "requests>=2",',
      "  'Click==8.1', # the CLI",
      ']',
      '',
      '[project.optional-dependencies]',
      'test = ["pytest>=8", "hypothesis"]',
      '',
      '[dependency-groups]',
      'dev = ["ruff", {include-group = "test"}]',
      'test = ["coverage"]',
      '',
      '[tool.ruff]',
      'select = ["E"]',
    ].join('\n');
    expect(names('python', text)).toEqual([
      'project requests requests>=2',
      "project click Click==8.1",
      'project.optional-dependencies.test pytest pytest>=8',
      'project.optional-dependencies.test hypothesis hypothesis',
      'dependency-groups.dev ruff ruff',
      'dependency-groups.test coverage coverage',
    ]);
  });

  it('does not read a group an entry includes as a dependency', () => {
    // {include-group = "test"} names another group, not a package called "test".
    const text = '[dependency-groups]\nall = [{ include-group = "lint" }, "mypy", { include-group = "docs" }]\n';
    expect(names('python', text)).toEqual(['dependency-groups.all mypy mypy']);
  });

  it('reads Poetry dependencies and groups, and not the Python version', () => {
    const text = [
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'Requests = "^2.31"',
      '',
      '[tool.poetry.dev-dependencies]',
      'black = "24"',
      '',
      '[tool.poetry.group.test.dependencies]',
      'pytest = { version = "^8" }',
      '',
      '[tool.poetry.scripts]',
      'x = "x:main"',
    ].join('\n');
    expect(names('python', text)).toEqual([
      'tool.poetry.dependencies requests ^2.31',
      'tool.poetry.dev-dependencies black 24',
      'tool.poetry.group.test.dependencies pytest { version = "^8" }',
    ]);
  });

  it('refuses a dependency list that never closes', () => {
    expect(error('python', '[project]\ndependencies = [\n  "a",\n')).toBe('the array for "dependencies" is never closed');
  });
});

describe('NuGet', () => {
  it('reads PackageReference and PackageVersion, by Include or Update', () => {
    const text = [
      '<Project Sdk="Microsoft.NET.Sdk">',
      '  <ItemGroup>',
      '    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />',
      '    <PackageReference Include="Serilog">',
      '      <Version>3.1.1</Version>',
      '    </PackageReference>',
      '    <PackageReference Update="xunit" Version="2.9.0"/>',
      '    <PackageVersion Include="Polly" Version="8.4.0" />',
      '    <PackageReference Version="1.0" />',
      '    <ProjectReference Include="../Lib/Lib.csproj" />',
      '    <PackageReferences Include="Not.A.Package" Version="1" />',
      '    <PackageReference Include="Pinned" VersionOverride="2.0" />',
      '  </ItemGroup>',
      '</Project>',
    ].join('\n');
    expect(names('nuget', text)).toEqual([
      'PackageReference Newtonsoft.Json 13.0.3',
      'PackageReference Serilog ',
      'PackageReference xunit 2.9.0',
      'PackageVersion Polly 8.4.0',
      'PackageReference Pinned ',
    ]);
  });
});

describe('Gemfile', () => {
  it('reads gems with and without a version', () => {
    const text = [
      "source 'https://rubygems.org'",
      "gem 'rails', '~> 7.1'",
      'gem "pg"',
      "  gem 'puma', '>= 5.0', '< 7'",
      "gem 'bootsnap', require: false",
      "# gem 'commented-out'",
      'group :test do',
      "  gem 'rspec'",
      'end',
      "gemspec",
    ].join('\n');
    expect(names('bundler', text)).toEqual(['gem rails ~> 7.1', 'gem pg ', 'gem puma >= 5.0', 'gem bootsnap ', 'gem rspec ']);
  });
});

describe('the edges of each reader', () => {
  it('names a requirements file only by its whole name', () => {
    expect(ecosystemOf('requirements.txt.bak')).toBeNull();
  });

  it('refuses npm JSON that is not an object', () => {
    expect(error('npm', '3')).toBe('not a JSON object');
    expect(error('npm', '"x"')).toBe('not a JSON object');
  });

  it('reads TOML tables and keys however they are spaced or indented', () => {
    const text = ['  [dependencies]', '  serde = "1"', '[dependencies. log]', 'version = "0.4"', '[dependencies .regex]', 'version = "1"', '[dependencies]', 'tokio = {version="1.38"}', 'rand = { version ="0.8" }', 'axa = "2"'].join('\n');
    expect(names('cargo', text)).toEqual(['dependencies serde 1', 'dependencies log 0.4', 'dependencies regex 1', 'dependencies tokio 1.38', 'dependencies rand 0.8', 'dependencies axa 2']);
  });

  it('reads a table only by its whole name', () => {
    const text = ['[dependencies-old]', 'a = "1"', '[package.metadata.dependencies]', 'b = "1"', '[package]', '[dependencies] = 1', 'c = "1"'].join('\n');
    expect(names('cargo', text)).toEqual([]);
  });

  it('takes quotes off only a value that opens and closes with the same one', () => {
    expect(names('cargo', '[dependencies]\nempty = ""\nodd = "\nplain = 1.0.1\n')).toEqual(['dependencies empty ', 'dependencies odd "', 'dependencies plain 1.0.1']);
  });

  it('reads a value that is not an array as one line, even when it never closes', () => {
    expect(names('cargo', '[dependencies]\na = "1\nb = "2"\n')).toEqual(['dependencies a "1', 'dependencies b 2']);
  });

  it('reads brackets and backslashes inside strings as text, as TOML does', () => {
    // A bracket in a string does not open an array, an escaped quote does not
    // close a basic string, and a literal string has no escapes at all.
    const text = ['[features]', 'a = ["x["]', "b = ['y[']", 'c = ["q\\"]"]', "d = ['C:\\']", '[dependencies]', "e = '1\\' # note", 'serde = "1"'].join('\n');
    expect(names('cargo', text)).toEqual(['dependencies e 1\\', 'dependencies serde 1']);
  });

  it('refuses an array that closes and then opens a string', () => {
    expect(error('cargo', '[features]\nf = ["a"] "\n[dependencies]\nserde = "1"\n')).toBe('the array for "f" is never closed');
  });

  it('reads Python requirement strings with escapes, over lines, and unterminated', () => {
    const text = ['[project]', 'dependencies = ["a\\"]", "b",', '  "c",', ']', '[project.optional-dependencies]', 'x = "d'].join('\n');
    expect(names('python', text)).toEqual(['project a a"]', 'project b b', 'project c c', 'project.optional-dependencies.x d d']);
  });

  it('reads a backslash in a single-quoted requirement as a character, not an escape', () => {
    expect(names('python', "[project]\ndependencies = ['a\\', 'b']\n")).toEqual(['project a a\\', 'project b b']);
  });

  it('reads a target table spaced around its dots', () => {
    expect(names('cargo', "[target.'cfg(unix)'. dependencies]\nnix = \"0.29\"\n")).toEqual(['dependencies nix 0.29']);
  });

  it('reads require only at the start of a line, and a one-line parenthesis as no block', () => {
    expect(names('go', 'replace github.com/me/require v1.0.0 => ../require\n')).toEqual([]);
    expect(readManifest('go', 'require (github.com/a/b v1.0.0)\n').ok).toBe(true);
  });

  it('reads project dependencies only from [project], and Poetry tables only by their whole name', () => {
    const text = ['[tool.hatch]', 'dependencies = ["not-a-dep"]', '[other.tool.poetry.dependencies]', 'x = "1"', '[tool.poetry.dependencies.requests]', 'version = "^2"'].join('\n');
    expect(names('python', text)).toEqual([]);
  });

  it('reads go.mod requires however they are spaced, and // indirect with no space', () => {
    const text = ['require (', '\tgithub.com/a/b  v1.2.3', '\tgithub.com/c/d v1.0.0 //indirect', ')', 'require  github.com/e/f   v2.0.0'].join('\n');
    expect(names('go', text)).toEqual(['require github.com/a/b v1.2.3', 'require (indirect) github.com/c/d v1.0.0', 'require github.com/e/f v2.0.0']);
  });

  it('reads NuGet attributes with space around their equals signs', () => {
    expect(names('nuget', '<PackageReference Include = "A" Version = "1.0" />\n<PackageVersion Update = "B" Version= "2.0"/>')).toEqual([
      'PackageReference A 1.0',
      'PackageVersion B 2.0',
    ]);
  });

  it('reads gems however they are spaced', () => {
    expect(names('bundler', "gem  'rails','~> 7.1'\ngem 'pg',\t'1.5'")).toEqual(['gem rails ~> 7.1', 'gem pg 1.5']);
  });
});

describe('what a round changed', () => {
  const before = JSON.stringify({ dependencies: { a: '1', b: '2', moved: '1' }, devDependencies: { c: '3' } });
  const after = JSON.stringify({ dependencies: { a: '1', b: '2.1', d: '4' }, devDependencies: { moved: '1' } });

  it('reports what was added, removed, changed or moved between sections, and not what stayed', () => {
    const result = diffManifest('package.json', 'npm', before, after);
    expect(result).toEqual({
      changes: [
        { file: 'package.json', ecosystem: 'npm', section: 'dependencies', name: 'b', before: '2', after: '2.1' },
        { file: 'package.json', ecosystem: 'npm', section: 'dependencies', name: 'd', before: null, after: '4' },
        { file: 'package.json', ecosystem: 'npm', section: 'devDependencies', name: 'moved', before: null, after: '1' },
        { file: 'package.json', ecosystem: 'npm', section: 'dependencies', name: 'moved', before: '1', after: null },
        { file: 'package.json', ecosystem: 'npm', section: 'devDependencies', name: 'c', before: '3', after: null },
      ],
    });
  });

  it('reads a new manifest as every dependency added, and a deleted one as every dependency removed', () => {
    expect(diffManifest('go.mod', 'go', null, 'require x v1\n')).toEqual({
      changes: [{ file: 'go.mod', ecosystem: 'go', section: 'require', name: 'x', before: null, after: 'v1' }],
    });
    expect(diffManifest('Gemfile', 'bundler', "gem 'y'\n", null)).toEqual({
      changes: [{ file: 'Gemfile', ecosystem: 'bundler', section: 'gem', name: 'y', before: '', after: null }],
    });
    expect(diffManifest('Gemfile', 'bundler', null, null)).toEqual({ changes: [] });
  });

  it('reports nothing for a manifest that changed around its dependencies', () => {
    const one = '{"name":"x","dependencies":{"a":"1"}}';
    const two = '{"name":"y","version":"2.0.0","dependencies":{"a":"1"}}';
    expect(diffManifest('package.json', 'npm', one, two)).toEqual({ changes: [] });
  });

  it('refuses to guess when either side cannot be read, and says which', () => {
    expect(diffManifest('package.json', 'npm', '{', after)).toEqual({ error: 'package.json (before): not valid JSON' });
    expect(diffManifest('package.json', 'npm', before, '[]')).toEqual({ error: 'package.json (after): not a JSON object' });
    expect(diffManifest('go.mod', 'go', null, 'require (\n')).toEqual({ error: 'go.mod (after): a require block is never closed' });
  });
});
