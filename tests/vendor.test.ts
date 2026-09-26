import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The vendored spec-core modules are copies, byte for byte, of what spec-core
 * measured (ADR-0010). A file edited here, or one added beside them, is code
 * nobody measured under spec-core's name.
 */

const VENDOR = fileURLToPath(new URL('../src/vendor/spec-core/', import.meta.url));

interface Manifest {
  readonly source: string;
  readonly commit: string | null;
  readonly modules: Readonly<Record<string, { readonly files: Readonly<Record<string, string>> }>>;
}

const manifest = JSON.parse(readFileSync(join(VENDOR, 'VENDOR.json'), 'utf8')) as Manifest;

function listed(module: string): string[] {
  return Object.keys(manifest.modules[module]?.files ?? {}).sort();
}

/** Every file under a directory, as paths relative to it with `/`. */
function filesUnder(directory: string, prefix = ''): string[] {
  return readdirSync(directory).flatMap((name) =>
    statSync(join(directory, name)).isDirectory() ? filesUnder(join(directory, name), `${prefix}${name}/`) : [`${prefix}${name}`],
  );
}

describe('the vendored spec-core', () => {
  it('names where it came from and lists modules', () => {
    expect(manifest.source).toBe('https://github.com/DescentVTT/spec-core');
    expect(Object.keys(manifest.modules).length).toBeGreaterThan(0);
  });

  it('has every file at the hash the manifest records', () => {
    const mismatched: string[] = [];
    for (const [module, { files }] of Object.entries(manifest.modules)) {
      for (const [file, recorded] of Object.entries(files)) {
        expect(recorded, `${module}/${file}`).toMatch(/^sha256-[0-9a-f]{64}$/);
        const actual = `sha256-${createHash('sha256').update(readFileSync(join(VENDOR, module, file))).digest('hex')}`;
        if (actual !== recorded) mismatched.push(`${module}/${file}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('holds no file in a vendored module that the manifest does not list', () => {
    for (const module of Object.keys(manifest.modules)) {
      expect(filesUnder(join(VENDOR, module)).sort(), module).toEqual(listed(module));
    }
  });

  it('holds no module the manifest does not list, beside its README, the manifest and the licence', () => {
    const entries = readdirSync(VENDOR).sort();
    const directories = entries.filter((name) => statSync(join(VENDOR, name)).isDirectory());
    expect(directories).toEqual(Object.keys(manifest.modules).sort());
    expect(entries.filter((name) => !directories.includes(name))).toEqual(['LICENSE', 'README.md', 'VENDOR.json']);
  });
});
