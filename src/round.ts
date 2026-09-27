/**
 * A round, measured: the operations the command line and the MCP server
 * share. Each gathers what a pure module needs - from git, the disk and the
 * siblings - and hands it over; the decisions are made in `context.ts`,
 * `audit.ts`, `guard.ts` and `rulings.ts`.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { audit, type ArchiveReason, type AssertionOutcome, type AuditReport } from './audit.js';
import { sameId } from './branch.js';
import {
  enabledPlugin,
  holdsGuard,
  loadsPlugin,
  registersServer,
  SPEC_BRIEF_CONFIGS,
  type BaseSource,
  type ClaudeCodeWiring,
  type ClaudeSettings,
  type PluginState,
} from './configure.js';
import { readRules, renderContext, type CitedDocument, type ContextPacket, type Rules } from './context.js';
import type { DocumentReader } from './document.js';
import { readJsonObject, readText, repositoryPath, stateDirectory, writeAtomic } from './fs.js';
import { blameLine, changes, mergeBase, remoteDefault, revision, show, verifyCommit } from './git.js';
import { decide, type Decision, type VerifiedRuling } from './guard.js';
import { diffManifest, ecosystemOf, manifestMatcher, type DependencyChange } from './manifests.js';
import {
  addRulingRow,
  nextId,
  readRulings,
  renderMemo,
  renderRow,
  type EscalationOption,
  type EscalationRequest,
  type RulingRow,
} from './rulings.js';
import type { BriefRow, Finding } from './types.js';
import { compileGlob } from './vendor/spec-core/pattern/index.js';
import { dirname, isRelativeReference, resolveInside, splitReference } from './vendor/spec-core/path/index.js';
import { SiblingError } from './siblings.js';
import { UsageError, type CliIO, type Workspace } from './workspace.js';

/* -------------------------------------------------------------------- base */

export type Base =
  | { readonly kind: 'resolved'; readonly ref: string; readonly source: BaseSource; readonly sha: string; readonly mergeBase: string; readonly head: string }
  | { readonly kind: 'unresolved'; readonly reason: string };

/** What the round is measured from: the flag, the configuration, then the remote's default branch. */
export async function resolveBase(workspace: Workspace, flag: string | undefined): Promise<Base> {
  const source: BaseSource = flag !== undefined ? 'flag' : workspace.config.base !== null ? 'config' : 'remote';
  const ref = flag ?? workspace.config.base ?? (await remoteDefault(workspace.root));
  if (ref === null) {
    return { kind: 'unresolved', reason: 'no base is named and the remote has no default branch; pass --base <ref> or set "base"' };
  }
  const sha = await revision(ref, workspace.root);
  const head = await revision('HEAD', workspace.root);
  if (sha === null || head === null) return { kind: 'unresolved', reason: `"${ref}" names no commit` };
  const common = await mergeBase(sha, head, workspace.root);
  if (common === null) return { kind: 'unresolved', reason: `"${ref}" and HEAD share no history` };
  return { kind: 'resolved', ref, source, sha, mergeBase: common, head };
}

/* ----------------------------------------------------------------- rulings */

export interface RulingCheck {
  readonly rows: readonly RulingRow[];
  readonly verified: readonly VerifiedRuling[];
  readonly unverified: readonly { readonly id: string; readonly reason: string }[];
  readonly problems: readonly Finding[];
}

/**
 * The brief's rulings, each checked against its signature: the commit that
 * last changed its row must be signed by a principal the base branch's
 * allowed-signers file lists (ADR-0006).
 */
export async function checkRulings(workspace: Workspace, brief: BriefRow, text: string, reader: DocumentReader, base: Base): Promise<RulingCheck> {
  const { rulings: rows, problems } = readRulings(reader.sectionTables(text, workspace.config.rulings.section).tables);
  const findings: Finding[] = problems.map((problem) => ({
    rule: 'ruling-unreadable',
    severity: 'warning',
    message: problem.message,
    hint: 'a ruling row is | id | `paths` | allow or deny | note |',
    file: brief.file,
    line: problem.line,
  }));
  const allows = rows.filter((row) => row.decision === 'allow');
  if (allows.length === 0) return { rows, verified: [], unverified: [], problems: findings };
  if (base.kind === 'unresolved') {
    return { rows, verified: [], unverified: allows.map((row) => ({ id: row.id, reason: `no base to read the allowed signers from: ${base.reason}` })), problems: findings };
  }
  const signers = await show(base.sha, workspace.config.rulings.allowedSigners, workspace.root);
  if (signers === null) {
    const reason = `${base.ref} has no ${workspace.config.rulings.allowedSigners}, so no signature can count`;
    return { rows, verified: [], unverified: allows.map((row) => ({ id: row.id, reason })), problems: findings };
  }
  const directory = await stateDirectory(workspace.commonDir, 'signers');
  const file = join(directory, `${createHash('sha256').update(signers).digest('hex').slice(0, 16)}`);
  await writeAtomic(file, signers);
  const verified: VerifiedRuling[] = [];
  const unverified: { id: string; reason: string }[] = [];
  for (const row of allows) {
    // The row's line is a line of the text on disk, so it is blamed there: at
    // HEAD the same number can be another line, one a signed commit wrote,
    // and an uncommitted row would borrow that commit's signature.
    const commit = await blameLine(null, brief.file, row.line, workspace.root);
    if (commit === null || /^0+$/.test(commit)) {
      unverified.push({ id: row.id, reason: 'its row is not committed' });
      continue;
    }
    const signature = await verifyCommit(commit, file, workspace.root);
    if (signature.good && signature.principal !== null) verified.push({ id: row.id, paths: row.paths, signer: signature.principal });
    else unverified.push({ id: row.id, reason: `commit ${commit.slice(0, 12)} last changed its row, and ${signature.detail || 'it is not signed'}` });
  }
  return { rows, verified, unverified, problems: findings };
}

/* ------------------------------------------------------------------- guard */

export async function briefText(workspace: Workspace, brief: BriefRow): Promise<string> {
  const text = await readText(join(workspace.root, brief.file));
  if (text === null) throw new UsageError(`${brief.file} cannot be read`);
  return text;
}

/** Decides paths against the brief, with the rulings verified against the base `baseFlag` names, or the configured one. */
export async function checkPaths(
  workspace: Workspace,
  brief: BriefRow | null,
  noBrief: string | undefined,
  given: readonly string[],
  cwd: string,
  reader: DocumentReader,
  baseFlag: string | undefined,
): Promise<Decision[]> {
  let rulings: readonly VerifiedRuling[] = [];
  const resolved = given.map((path) => ({ given: path, path: repositoryPath(path, workspace.root, cwd) }));
  if (brief !== null) {
    // Rulings cost a blame and a signature check each, so they are read only
    // when a write reaches a protected file.
    const first = resolved.map(({ path, given: g }) =>
      decide({ path, given: g, brief, noBrief, rulings: [], outOfScope: workspace.config.outOfScope }),
    );
    if (first.some((decision) => decision.reason === 'protected')) {
      const base = await resolveBase(workspace, baseFlag);
      rulings = (await checkRulings(workspace, brief, await briefText(workspace, brief), reader, base)).verified;
    } else {
      return first;
    }
  }
  return resolved.map(({ path, given: g }) => decide({ path, given: g, brief, noBrief, rulings, outOfScope: workspace.config.outOfScope }));
}

/* ----------------------------------------------------------------- context */

function scopeBases(patterns: readonly string[]): string[] {
  const bases = new Set<string>();
  for (const pattern of patterns) {
    try {
      for (const base of compileGlob(pattern, { dialect: 'path', caseSensitive: true }).bases) bases.add(base === '' ? '.' : base);
    } catch {
      // spec-brief lint reports a pattern it cannot read; the rules for the rest still count.
    }
  }
  return [...bases].sort();
}

async function rulesFor(workspace: Workspace, brief: BriefRow): Promise<Rules> {
  const paths = scopeBases(brief.affectedFiles);
  if (paths.length === 0) return [];
  try {
    const answer = await workspace.siblings.json('spec-guard', ['query', ...paths, '--json']);
    return 'absent' in answer ? { unavailable: answer.absent } : readRules(answer);
  } catch (error) {
    // spec-guard printed no JSON: what it said instead is the reason, and
    // the rest of the packet stands without the rules.
    if (error instanceof SiblingError) return { unavailable: error.message };
    throw error;
  }
}

async function citedDocuments(workspace: Workspace, brief: BriefRow, text: string, reader: DocumentReader): Promise<CitedDocument[]> {
  const seen = new Set<string>();
  const out: CitedDocument[] = [];
  for (const citation of reader.citations(text)) {
    if (!isRelativeReference(citation.target)) continue;
    let target = splitReference(citation.target).path;
    try {
      target = decodeURIComponent(target);
    } catch {
      // A destination that is not valid percent-encoding is read as written.
    }
    const path = resolveInside(dirname(brief.file), target);
    if (path === null || path === '' || path === brief.file || seen.has(path)) continue;
    seen.add(path);
    const document = /\.(?:md|markdown|mdx|txt)$/i.test(path);
    // A link to code or a directory that exists is not a document to include,
    // and must not be reported as a link that resolves to nothing.
    if (!document && existsSync(join(workspace.root, path))) continue;
    const content = document ? await readText(join(workspace.root, path)) : null;
    const meta = content === null ? { title: null, status: null } : reader.titleAndStatus(content);
    out.push({ path, title: meta.title, status: meta.status, text: content });
  }
  return out;
}

export async function buildContext(
  workspace: Workspace,
  brief: BriefRow,
  briefs: readonly BriefRow[],
  reader: DocumentReader,
  baseFlag: string | undefined,
): Promise<ContextPacket> {
  const text = await briefText(workspace, brief);
  const base = await resolveBase(workspace, baseFlag);
  const [rules, cited, rulings] = await Promise.all([
    rulesFor(workspace, brief),
    citedDocuments(workspace, brief, text, reader),
    checkRulings(workspace, brief, text, reader, base),
  ]);
  return renderContext({
    brief,
    briefText: text,
    dependencies: brief.dependsOn.map(
      (id) =>
        // spec-brief reports a dependency as its front matter spells it, `7` for brief 007.
        briefs.find((candidate) => sameId(candidate.id, id)) ?? {
          ...brief,
          id,
          title: '(no such brief)',
          file: '',
          phase: 'live',
          status: 'unknown',
        },
    ),
    cited,
    rules,
    rulings: rulings.verified,
    branch: workspace.branch,
    base: base.kind === 'resolved' ? base.ref : null,
    budget: workspace.config.context.budget,
  });
}

/* ------------------------------------------------------------------- audit */

async function dependencyChanges(workspace: Workspace, base: Base): Promise<{ changes: DependencyChange[]; unread: string[] }> {
  if (base.kind === 'unresolved') return { changes: [], unread: [] };
  const isManifest = manifestMatcher(workspace.config.dependencies.manifests);
  const out: DependencyChange[] = [];
  const unread: string[] = [];
  for (const change of await changes(base.mergeBase, base.head, workspace.root)) {
    if (!isManifest(change.path) && !(change.from !== undefined && isManifest(change.from))) continue;
    const ecosystem = ecosystemOf(change.path);
    if (ecosystem === null) {
      unread.push(change.path);
      continue;
    }
    const before = change.status === 'A' ? null : await show(base.mergeBase, change.from ?? change.path, workspace.root);
    const after = change.status === 'D' ? null : await show(base.head, change.path, workspace.root);
    const diff = diffManifest(change.path, ecosystem, before, after);
    if ('error' in diff) unread.push(change.path);
    else out.push(...diff.changes);
  }
  return { changes: out, unread };
}

/** Whether spec-brief loads this package's plugin, as its configuration at the root says. */
export async function specBriefPlugin(root: string): Promise<PluginState> {
  const file = SPEC_BRIEF_CONFIGS.find((name) => existsSync(join(root, name)));
  if (file === undefined) return { kind: 'unconfigured' };
  const config = await readJsonObject(join(root, file));
  if (config === null || config === 'unreadable') return { kind: 'unreadable', file };
  return { kind: loadsPlugin(config) ? 'loaded' : 'not-loaded', file };
}

/**
 * Claude Code's settings files that can turn a plugin on or hold a hook,
 * lowest precedence first: the user's, the project's, and the person's own
 * for the project. The user's is in `CLAUDE_CONFIG_DIR` when that is set,
 * otherwise in `.claude` under the home directory Claude Code uses,
 * `USERPROFILE` on Windows and `HOME` elsewhere; with neither it is not read.
 * Managed settings and `--settings` are not files a project can see.
 */
export function claudeSettingsFiles(root: string, env: CliIO['env'], platform: NodeJS.Platform = process.platform): { file: string; path: string }[] {
  const home = (platform === 'win32' ? env['USERPROFILE'] : env['HOME']) || undefined;
  const configDir = env['CLAUDE_CONFIG_DIR'] || (home === undefined ? undefined : join(home, '.claude'));
  const user = configDir === undefined ? null : join(configDir, 'settings.json');
  return [
    ...(user === null ? [] : [{ file: user, path: user }]),
    { file: '.claude/settings.json', path: join(root, '.claude', 'settings.json') },
    { file: '.claude/settings.local.json', path: join(root, '.claude', 'settings.local.json') },
  ];
}

/** The settings files Claude Code reads here, as read; one that is missing or cannot be read as JSON holds nothing. */
export async function claudeSettings(root: string, env: CliIO['env']): Promise<ClaudeSettings[]> {
  return Promise.all(claudeSettingsFiles(root, env).map(async ({ file, path }) => ({ file, settings: await readJsonObject(path) })));
}

/** Whether the plugin, init's entries, both or neither wire Claude Code to the harness here. */
export async function claudeCodeWiring(root: string, env: CliIO['env']): Promise<ClaudeCodeWiring> {
  const sources = await claudeSettings(root, env);
  return {
    plugin: enabledPlugin(sources),
    hooks: sources.filter(({ settings }) => holdsGuard(settings)).map(({ file }) => file),
    server: registersServer(await readJsonObject(join(root, '.mcp.json'))),
  };
}

async function archiveReasons(workspace: Workspace, brief: BriefRow, base: Base): Promise<{ blocking: ArchiveReason[]; warnings: ArchiveReason[] } | { unavailable: string }> {
  const args = ['archive', brief.id, '--dry-run', '--format', 'json', '--no-color'];
  if (base.kind === 'resolved') args.push('--base', base.ref);
  const answer = await workspace.siblings.json('spec-brief', args);
  if ('absent' in answer) return { unavailable: answer.absent };
  if (answer.code === 2) return { unavailable: 'spec-brief could not plan the archive' };
  const plan = (answer.document as { plan?: { blocking?: ArchiveReason[]; warnings?: ArchiveReason[] } }).plan;
  return { blocking: plan?.blocking ?? [], warnings: plan?.warnings ?? [] };
}

async function briefAssertions(workspace: Workspace, brief: BriefRow, text: string, reader: DocumentReader): Promise<AssertionOutcome[] | { unavailable: string }> {
  const answer = await workspace.siblings.json('spec-guard', [brief.file, '--ignore-status', '--json']);
  if ('absent' in answer) return { unavailable: answer.absent };
  if (answer.code === 2) return { unavailable: 'spec-guard could not run the brief\'s assertions' };
  const report = answer.document as { results?: { ok: boolean; description: string; message: string; spec?: { file: string; line: number } }[] };
  return (report.results ?? [])
    .filter((result) => result.spec === undefined || result.spec.file.replace(/\\/g, '/') === brief.file)
    .map((result) => {
      const line = result.spec?.line ?? 0;
      return { ok: result.ok, description: result.description, message: result.message, line, section: reader.sectionAt(text, line), enclosing: reader.sectionsAt(text, line) };
    });
}

export interface AuditResult {
  readonly brief: BriefRow;
  readonly base: Base;
  readonly report: AuditReport;
  readonly dependencies: readonly DependencyChange[];
}

export async function runAudit(workspace: Workspace, brief: BriefRow, reader: DocumentReader, baseFlag: string | undefined): Promise<AuditResult> {
  const base = await resolveBase(workspace, baseFlag);
  const text = await briefText(workspace, brief);
  const [dependencies, archive, assertions, rulings, plugin] = await Promise.all([
    dependencyChanges(workspace, base),
    archiveReasons(workspace, brief, base),
    briefAssertions(workspace, brief, text, reader),
    checkRulings(workspace, brief, text, reader, base),
    specBriefPlugin(workspace.root),
  ]);
  const unmeasured =
    base.kind === 'unresolved' ? base.reason : base.mergeBase === base.head ? `${base.ref} and HEAD are the same commit: there is nothing to measure` : null;
  const report = audit({
    brief,
    unmeasured,
    dependencies,
    archive,
    assertions,
    premiseSections: workspace.config.assertions.premises,
    unverifiedRulings: rulings.unverified,
    verifiedRulings: rulings.verified,
    pluginLoaded: plugin.kind === 'loaded',
  });
  return {
    brief,
    base,
    dependencies: dependencies.changes,
    report: { findings: [...rulings.problems, ...report.findings], counts: tally([...rulings.problems, ...report.findings]) },
  };
}

function tally(findings: readonly Finding[]): AuditReport['counts'] {
  const counts = { error: 0, warning: 0, note: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/* -------------------------------------------------------------- escalation */

async function escalationDirectory(workspace: Workspace): Promise<string> {
  return stateDirectory(workspace.commonDir, 'escalations');
}

export async function listEscalations(workspace: Workspace): Promise<EscalationRequest[]> {
  const directory = await escalationDirectory(workspace);
  const out: EscalationRequest[] = [];
  for (const name of (await readdir(directory)).filter((n) => n.endsWith('.json')).sort()) {
    try {
      out.push(JSON.parse(await readFile(join(directory, name), 'utf8')) as EscalationRequest);
    } catch {
      // A request that cannot be read is skipped; listing it would list nothing true.
    }
  }
  return out;
}

export async function raiseEscalation(
  workspace: Workspace,
  brief: BriefRow,
  request: { paths: readonly string[]; reason: string; options: readonly EscalationOption[]; recommendation: string | null },
): Promise<{ request: EscalationRequest; memo: string }> {
  const existing = await listEscalations(workspace);
  const id = nextId('E', brief.id, existing.map((e) => e.id));
  const full: EscalationRequest = {
    id,
    brief: brief.id,
    briefFile: brief.file,
    paths: request.paths,
    reason: request.reason,
    options: request.options,
    recommendation: request.recommendation,
    created: new Date().toISOString(),
    branch: workspace.branch,
    head: await revision('HEAD', workspace.root),
  };
  await writeAtomic(join(await escalationDirectory(workspace), `${id}.json`), `${JSON.stringify(full, null, 2)}\n`);
  return { request: full, memo: renderMemo(full) };
}

/** Writes a person's ruling into the brief and retires the request. Never commits: the signature is the person's. */
export async function recordRuling(
  workspace: Workspace,
  escalationId: string,
  decision: 'allow' | 'deny',
  note: string,
  reader: DocumentReader,
): Promise<{ id: string; file: string; row: string }> {
  const request = (await listEscalations(workspace)).find((candidate) => candidate.id === escalationId.toUpperCase() || candidate.id === escalationId);
  if (request === undefined) throw new UsageError(`no escalation "${escalationId}" is waiting; spec-harness escalate --list shows those that are`);
  const path = join(workspace.root, request.briefFile);
  const text = await readText(path);
  if (text === null) throw new UsageError(`${request.briefFile} cannot be read`);
  const where = reader.sectionTables(text, workspace.config.rulings.section);
  const taken = readRulings(where.tables).rulings.map((row) => row.id);
  const id = nextId('R', request.brief, taken);
  const row = renderRow(id, request.paths, decision, note);
  await writeAtomic(path, addRulingRow(text, workspace.config.rulings.section, row, where));
  await rm(join(await escalationDirectory(workspace), `${request.id}.json`), { force: true });
  return { id, file: request.briefFile, row };
}
