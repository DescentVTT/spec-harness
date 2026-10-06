/**
 * The siblings the suite runs, each at the oldest release this package says
 * it runs, for CI's `test (minimum siblings)` job (ADR-0011). The lockfile
 * holds each sibling's newest release, which is what a user installs; that
 * job installs these over them and runs the suite again, so a minimum stays
 * true or a test says why it is not.
 *
 *   node scripts/minimum-siblings.ts              the specs, for npm install --no-save
 *   node scripts/minimum-siblings.ts --installed  exit 1 unless node_modules holds exactly those
 *
 * The minimums are MINIMUM_VERSIONS in src/versions.ts, read as that file
 * stands, so neither this script nor the workflow names a version. Exits 1
 * when a sibling the suite runs has no minimum or none is a devDependency,
 * and 2 on bad arguments.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SCOPE = '@descent-vtt/';

export interface Minimum {
  /** The package, `@descent-vtt/spec-brief`. */
  readonly name: string;
  readonly version: string;
}

/**
 * Each sibling among `devDependencies` with its minimum, or why there is
 * nothing to install. Those are the siblings the suite runs for real; one it
 * only stands in for is in no `node_modules` to replace. A sibling without a
 * minimum would be tested at whatever npm chose, and none at all would leave
 * the job running the newest and calling them the oldest.
 */
export function minimumsOf(devDependencies: Readonly<Record<string, string>>, minimums: Readonly<Record<string, string>>): Minimum[] | string {
  const names = Object.keys(devDependencies)
    .filter((name) => name.startsWith(SCOPE))
    .sort();
  if (names.length === 0) return `package.json has no ${SCOPE}* devDependency, so there is no sibling to test at its minimum`;
  const unknown = names.filter((name) => minimums[name.slice(SCOPE.length)] === undefined);
  if (unknown.length > 0) return `MINIMUM_VERSIONS in src/versions.ts has no minimum for ${unknown.join(', ')}`;
  return names.map((name) => ({ name, version: minimums[name.slice(SCOPE.length)] as string }));
}

/**
 * Where what is installed is not the minimum, one line each. `installed`
 * gives the version a package's own package.json declares, or `null` where
 * it cannot be read.
 */
export function notAtMinimum(wanted: readonly Minimum[], installed: (name: string) => string | null): string[] {
  return wanted.flatMap(({ name, version }) => {
    const found = installed(name);
    if (found === version) return [];
    return [`${name} is ${found === null ? 'not installed' : `installed at ${found}`}, where its minimum is ${version}`];
  });
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--installed')) {
    console.error('usage: node scripts/minimum-siblings.ts [--installed]');
    return 2;
  }
  // By URL, not by a static import: Node runs this file with its types
  // stripped, and resolves no `.js` specifier to the `.ts` beside it.
  const { MINIMUM_VERSIONS } = (await import(new URL('../src/versions.ts', import.meta.url).href)) as typeof import('../src/versions.js');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies?: Record<string, string> };
  const wanted = minimumsOf(manifest.devDependencies ?? {}, MINIMUM_VERSIONS);
  if (typeof wanted === 'string') {
    console.error(wanted);
    return 1;
  }
  if (argv.length === 0) {
    process.stdout.write(`${wanted.map(({ name, version }) => `${name}@${version}`).join(' ')}\n`);
    return 0;
  }
  const wrong = notAtMinimum(wanted, (name) => {
    try {
      const declared = (JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')) as { version?: unknown }).version;
      return typeof declared === 'string' ? declared : null;
    } catch {
      return null;
    }
  });
  for (const line of wrong) console.error(line);
  if (wrong.length === 0) process.stdout.write(`${wanted.map(({ name, version }) => `${name} ${version}`).join(', ')}: the minimums, as installed\n`);
  return wrong.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
