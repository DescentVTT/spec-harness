/**
 * `spec-harness mcp`: the round's questions, served over the Model Context
 * Protocol on stdio (ADR-0008). The protocol is spec-core's `jsonrpc` module;
 * this file is the five tools, the four prompts, and nothing else. Every
 * request reads the repository afresh: a brief edited a minute ago is the
 * brief the next answer uses.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findActive } from './briefs.js';
import { briefIdFromBranch } from './branch.js';
import { createReader } from './reader.js';
import { buildContext, checkPaths, raiseEscalation, runAudit } from './round.js';
import type { BriefRow } from './types.js';
import {
  createMcpServer,
  serveLines,
  toolError,
  unknownArguments,
  type JsonObject,
  type PromptDefinition,
  type ToolDefinition,
  type ToolOutcome,
} from './vendor/spec-core/jsonrpc/index.js';
import { describeActive, openWorkspace, version, type CliIO, type Options, type Workspace } from './workspace.js';

const reader = createReader();

export const INSTRUCTIONS =
  'spec-harness keeps a round of work inside the brief a person approved. ' +
  'Call start_round before working: it returns the brief, the scope you may write, what you must not touch, the rules in force and the documents the brief cites. ' +
  'Call check_path before writing a file you are unsure of. A protected file needs a ruling: call request_escalation and stop until a person rules. ' +
  'Call audit_round when the work is done, and fix what it reports; archiving is a person\'s decision. ' +
  'For the architecture rules themselves, spec-guard\'s own server answers get_architectural_rules.';

const briefProperty = { type: 'string', description: 'The brief id. Omit to use the brief the branch or SPEC_BRIEF names.' };
const baseProperty = {
  type: 'string',
  description: 'The branch the round is measured from, whose allowed signers a ruling is verified against. Omit to use the configured base.',
};

/** The `base` argument, or the tool error for one that is not a string. */
function baseOf(args: JsonObject): { base: string | undefined } | ToolOutcome {
  const base = args['base'];
  if (base !== undefined && typeof base !== 'string') return toolError('"base" must be a string.');
  return { base };
}

async function round(workspace: Workspace, env: CliIO['env'], id: unknown): Promise<{ brief: BriefRow; briefs: BriefRow[] } | ToolOutcome> {
  if (id !== undefined && typeof id !== 'string') return toolError('"brief" must be a string.');
  const briefs = await workspace.siblings.briefs();
  const fromBranch = workspace.branch === null ? null : briefIdFromBranch(workspace.config.branches, workspace.branch);
  const active = findActive(briefs, { flag: id, environment: env['SPEC_BRIEF'], branch: fromBranch });
  const { brief, note, problem } = describeActive(active);
  if (problem !== null) return toolError(problem);
  if (brief === null) return toolError(note ?? 'no brief is named');
  return { brief, briefs };
}

export function tools(workspace: Workspace, env: CliIO['env']): ToolDefinition[] {
  const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
  return [
    {
      descriptor: {
        name: 'start_round',
        title: 'Start a round',
        description:
          'Everything needed to start the round: the brief in full, the files it may write and must not change, signed rulings, the briefs it depends on, the architecture rules in force for its scope, and the documents it cites.',
        inputSchema: { type: 'object', properties: { brief: briefProperty, base: baseProperty }, additionalProperties: false },
        annotations: readOnly,
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, ['brief', 'base']);
        if (unknown) return unknown;
        const base = baseOf(args);
        if ('text' in base) return base;
        const found = await round(workspace, env, args['brief']);
        if ('text' in found) return found;
        const packet = await buildContext(workspace, found.brief, found.briefs, reader, base.base);
        return { text: packet.markdown, structured: { brief: found.brief.id, included: [...packet.included], omitted: [...packet.omitted], unresolved: [...packet.unresolved] } };
      },
    },
    {
      descriptor: {
        name: 'check_path',
        title: 'May the round write these files',
        description:
          'For each path: allowed (in scope, or covered by a signed ruling), outside the scope, or refused (protected by the brief). Works for files that do not exist yet.',
        inputSchema: {
          type: 'object',
          properties: {
            paths: { type: 'array', items: { type: 'string' }, description: 'Paths relative to the project root, or absolute inside it.' },
            brief: briefProperty,
            base: baseProperty,
          },
          required: ['paths'],
          additionalProperties: false,
        },
        annotations: readOnly,
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, ['paths', 'brief', 'base']);
        if (unknown) return unknown;
        const paths = args['paths'];
        if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string') || paths.length === 0) {
          return toolError('"paths" must be a non-empty array of strings.');
        }
        const base = baseOf(args);
        if ('text' in base) return base;
        const found = await round(workspace, env, args['brief']);
        if ('text' in found) return found;
        const decisions = await checkPaths(workspace, found.brief, undefined, paths as string[], workspace.root, reader, base.base);
        const text = decisions.map((d) => `${d.verdict}: ${d.message}${d.verdict === 'allow' ? '' : `. Next: ${d.hint}`}`).join('\n');
        return { text, structured: { decisions: decisions.map((d) => ({ ...d })) } };
      },
    },
    {
      descriptor: {
        name: 'request_escalation',
        title: 'Ask a person to rule',
        description:
          'When the round cannot be finished without changing something the brief protects, record the request and stop. A person reads the memo and rules; only a ruling they sign lets the change through.',
        inputSchema: {
          type: 'object',
          properties: {
            paths: { type: 'array', items: { type: 'string' }, description: 'The protected files the round needs to change.' },
            reason: { type: 'string', description: 'Why the round cannot be done without them.' },
            options: {
              type: 'array',
              items: { type: 'object', properties: { label: { type: 'string' }, consequence: { type: 'string' } }, required: ['label', 'consequence'] },
              description: 'The choices the person has, each with what it costs.',
            },
            recommendation: { type: 'string', description: 'Which option you recommend, and why.' },
            brief: briefProperty,
          },
          required: ['paths', 'reason'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, ['paths', 'reason', 'options', 'recommendation', 'brief']);
        if (unknown) return unknown;
        const paths = args['paths'];
        const reason = args['reason'];
        if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string') || paths.length === 0) return toolError('"paths" must be a non-empty array of strings.');
        if (typeof reason !== 'string' || reason.trim() === '') return toolError('"reason" is required.');
        const rawOptions = args['options'] ?? [];
        if (!Array.isArray(rawOptions)) return toolError('"options" must be an array.');
        const options = rawOptions.map((o) => ({ label: String((o as JsonObject)['label'] ?? ''), consequence: String((o as JsonObject)['consequence'] ?? '') }));
        const recommendation = args['recommendation'];
        if (recommendation !== undefined && typeof recommendation !== 'string') return toolError('"recommendation" must be a string.');
        const found = await round(workspace, env, args['brief']);
        if ('text' in found) return found;
        const { request, memo } = await raiseEscalation(workspace, found.brief, { paths: paths as string[], reason, options, recommendation: recommendation ?? null });
        return { text: `${memo}\nStop here until a person rules on ${request.id}.`, structured: { id: request.id } };
      },
    },
    {
      descriptor: {
        name: 'audit_round',
        title: 'Audit the round',
        description:
          'Did the round stay inside the lines: what the archive would refuse (open boxes, protected files, files outside the scope), the brief\'s own assertions, unverified rulings, and every dependency added.',
        inputSchema: { type: 'object', properties: { brief: briefProperty, base: baseProperty }, additionalProperties: false },
        annotations: readOnly,
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, ['brief', 'base']);
        if (unknown) return unknown;
        const base = baseOf(args);
        if ('text' in base) return base;
        const found = await round(workspace, env, args['brief']);
        if ('text' in found) return found;
        const result = await runAudit(workspace, found.brief, reader, base.base);
        const { counts, findings } = result.report;
        const text =
          findings.length === 0
            ? 'The audit found nothing.'
            : findings.map((f) => `${f.severity} ${f.rule}: ${f.message}. Next: ${f.hint}`).join('\n');
        return { text: `${text}\n\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.note} note(s)`, structured: { counts, findings: findings.map((f) => ({ ...f })) } };
      },
    },
    {
      descriptor: {
        name: 'list_rounds',
        title: 'List the rounds',
        description: 'The live briefs: status, wave, what each waits on, and which are ready to start.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: readOnly,
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, []);
        if (unknown) return unknown;
        const live = (await workspace.siblings.briefs()).filter((brief) => brief.phase === 'live');
        const text = live
          .map((b) => `${b.id} ${b.title ?? ''} - ${b.status ?? 'unknown'}, wave ${b.wave ?? '-'}, ${b.ready ? 'ready' : `waits on ${b.waitingOn.join(', ')}`}`)
          .join('\n');
        return { text: text === '' ? 'No live brief.' : text, structured: { briefs: live.map((b) => ({ ...b })) } };
      },
    },
  ];
}

const SKILLS: readonly { name: string; title: string; argument: string; description: string }[] = [
  { name: 'draft-brief', title: 'Draft a brief', argument: 'request', description: 'What the round should achieve, in the person\'s words.' },
  { name: 'split-goal', title: 'Split a goal into rounds', argument: 'goal', description: 'The goal to split.' },
  { name: 'run-round', title: 'Run a round', argument: 'brief', description: 'The brief id.' },
  { name: 'close-round', title: 'Close a round', argument: 'brief', description: 'The brief id.' },
];

function skillText(name: string): string {
  const file = fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url));
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

export function prompts(): PromptDefinition[] {
  return SKILLS.map((skill) => ({
    descriptor: {
      name: skill.name,
      title: skill.title,
      arguments: [{ name: skill.argument, description: skill.description, required: false }],
    },
    async get(args: Readonly<Record<string, string>>): Promise<JsonObject> {
      const given = args[skill.argument];
      const text = `${skillText(skill.name)}${given === undefined || given === '' ? '' : `\n\n${skill.argument}: ${given}`}`;
      return { description: skill.title, messages: [{ role: 'user', content: { type: 'text', text } }] };
    },
  }));
}

export async function mcpCommand(options: Options, io: CliIO): Promise<number> {
  const workspace = await openWorkspace(options, io);
  const handle = createMcpServer({ name: 'spec-harness', version: version(), instructions: INSTRUCTIONS, tools: tools(workspace, io.env), prompts: prompts() });
  await serveLines(process.stdin, (line) => process.stdout.write(`${line}\n`), handle);
  return 0;
}
