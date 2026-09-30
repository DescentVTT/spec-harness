/**
 * The spec-brief plugin: signed rulings, read where spec-brief decides.
 *
 * spec-brief's archive refuses a round that changed a file its brief protects.
 * When a person has ruled that the round may change it, and signed the ruling
 * (ADR-0006), the refusal is lifted - but spec-brief does not read signatures,
 * and should not: the tool that defines a format ships the check for it
 * (spec-brief ADR-0007). So the check ships here, and spec-brief asks it
 * through its plugin `waive` hook, once its configuration loads the plugin,
 * as `spec-harness init` writes it:
 *
 * ```json
 * { "plugins": ["@descent-vtt/spec-harness/spec-brief-plugin"] }
 * ```
 *
 * It waives a `protected-file` refusal for a path a verified `allow` ruling
 * names, and nothing else. A ruling that does not verify waives nothing.
 */

import { loadConfig } from './fs.js';
import { commonDirectory, currentBranch } from './git.js';
import { rulingFor } from './guard.js';
import { createReader } from './reader.js';
import { checkRulings, resolveBase } from './round.js';
import { createSiblings } from './siblings.js';
import type { Workspace } from './workspace.js';

export interface WaiveContext {
  readonly root: string;
  /** spec-brief passes a `null` id for a brief it could not name; its file still identifies it. */
  readonly brief: { readonly id: string | null; readonly file: string; readonly text: string };
  readonly findings: readonly { readonly rule: string; readonly path?: string | undefined; readonly paths?: readonly string[] | undefined }[];
  readonly base: string | null;
  readonly commit: string | null;
}

export interface Waiver {
  readonly rule: string;
  readonly path: string;
  readonly reason: string;
}

/**
 * Paths a finding names, in either of the shapes spec-brief reports them. A
 * finding with neither names none, and a path no ruling names is waived for
 * none, so the empty list is equivalent to its mutant.
 */
function pathsOf(finding: WaiveContext['findings'][number]): string[] {
  if (finding.path !== undefined) return [finding.path];
  return [...(finding.paths ?? [])];
}

export async function waive(context: WaiveContext): Promise<Waiver[]> {
  const protectedPaths = context.findings.filter((finding) => finding.rule === 'protected-file').flatMap(pathsOf);
  // Asking git about nothing waives nothing: this saves the asking, and its
  // mutant is equivalent.
  if (protectedPaths.length === 0) return [];
  const { config } = await loadConfig(context.root);
  const workspace: Workspace = {
    root: context.root,
    // spec-brief runs in a work tree, where git always names the common
    // directory; the fallback is there for the type.
    commonDir: (await commonDirectory(context.root)) ?? `${context.root}/.git`,
    config,
    siblings: createSiblings(context.root, config),
    branch: await currentBranch(context.root),
    cwd: context.root,
  };
  const base = await resolveBase(workspace, context.base ?? undefined);
  const { verified } = await checkRulings(workspace, { file: context.brief.file }, context.brief.text, createReader(), base);
  const waivers: Waiver[] = [];
  for (const path of protectedPaths) {
    const ruling = rulingFor(verified, path);
    if (ruling !== undefined) {
      waivers.push({ rule: 'protected-file', path, reason: `ruling ${ruling.id}, signed by ${ruling.signer}, allows it` });
    }
  }
  return waivers;
}

/** The plugin, as spec-brief loads it: a function of its options returning `{ name, rules, waive }`. */
export default function specHarnessPlugin(): { name: string; rules: readonly never[]; waive: typeof waive } {
  return { name: 'spec-harness', rules: [], waive };
}
