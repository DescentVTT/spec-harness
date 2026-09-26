/**
 * The oldest release of each sibling this harness runs, and an installed
 * sibling measured against it.
 *
 * An older sibling is not run. It would answer, and the answer would lack what
 * this release relies on: spec-brief before 0.2.0 has no `waive` hook, so its
 * archive refuses a protected file a signed ruling allows. It is reported with
 * the minimum instead, as a missing sibling is reported (ADR-0002, ADR-0011).
 *
 * package.json says the same minimums to npm as `peerDependencies`; a test
 * holds the two together.
 */

import type { SiblingName } from './config.js';

export const MINIMUM_VERSIONS: Readonly<Record<SiblingName, string>> = {
  // The plugin `waive` hook, through which spec-brief's archive accepts a
  // protected file that a signed ruling allows.
  'spec-brief': '0.2.0',
  // An archived brief read as a record, as init configures it, where an older
  // release reads it as retired and what depends on it as a stale premise.
  'spec-graph': '0.9.0',
  // Scopes read with the spec-core globs the harness reads them with, and an
  // archived brief's assertions withheld rather than run.
  'spec-guard': '0.12.0',
};

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: boolean;
}

/** A semver version, or `null`. Build metadata is accepted and ignored, as precedence ignores it. */
export function parseVersion(text: string): Version | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(text);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] !== undefined };
}

/**
 * Whether `installed` is `minimum` or later by semver precedence. A minimum is
 * a release, never a prerelease, so a prerelease of the minimum comes before
 * it and a prerelease of anything later comes after it.
 */
export function meets(installed: Version, minimum: Version): boolean {
  const order = [installed.major - minimum.major, installed.minor - minimum.minor, installed.patch - minimum.patch].find((difference) => difference !== 0) ?? 0;
  return order > 0 || (order === 0 && !installed.prerelease);
}

export type VersionCheck =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly version: string | null; readonly reason: string };

/**
 * The `version` an installed sibling's package.json declares, against the
 * minimum. A version that cannot be read cannot be shown to meet it, and is
 * refused as an old one is.
 */
export function checkVersion(name: SiblingName, declared: unknown): VersionCheck {
  const minimum = MINIMUM_VERSIONS[name];
  const needs = `spec-harness needs ${minimum} or later: npm install --save-dev @descent-vtt/${name}@latest`;
  if (typeof declared !== 'string') return { ok: false, version: null, reason: `the ${name} installed here declares no version; ${needs}` };
  const parsed = parseVersion(declared);
  if (parsed === null) return { ok: false, version: declared, reason: `the ${name} installed here declares "${declared}", which is not a version; ${needs}` };
  if (meets(parsed, parseVersion(minimum) as Version)) return { ok: true, version: declared };
  return { ok: false, version: declared, reason: `${name} ${declared} is installed here; ${needs}` };
}
