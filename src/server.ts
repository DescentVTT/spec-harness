/**
 * `spec-harness mcp`: the round's questions, served over the Model Context
 * Protocol on stdio (ADR-0008). The protocol is spec-core's `jsonrpc` module;
 * this file is the five tools, the four prompts, and nothing else. Every
 * request reads the repository afresh: a brief edited a minute ago is the
 * brief the next answer uses.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { describeMeasured } from './audit.js';
import { findActive } from './briefs.js';
import { briefIdFromBranch } from './branch.js';
import { titleOf } from './context.js';
import { createReader } from './reader.js';
import { realSpelling } from './fs.js';
import { buildContext, checkPaths, raiseEscalation, runAudit } from './round.js';
import type { EscalationOption } from './rulings.js';
import type { BriefRow } from './types.js';
import { emptyValue, isBlank, type ValuedOption } from './usage.js';
import {
  CLIENT_CAPABILITIES_KEY,
  createMcpServer,
  isObject,
  serveLines,
  toolError,
  unknownArguments,
  type JsonObject,
  type PromptDefinition,
  type ToolDefinition,
  type ToolOutcome,
} from './vendor/spec-core/jsonrpc/index.js';
import { describeActive, findTree, foundCommonDir, mayBeElsewhere, openFound, openWorkspace, version, writesBy, type CliIO, type Options, type Workspace } from './workspace.js';

const reader = createReader();

export const INSTRUCTIONS =
  'spec-harness keeps a round of work inside the brief a person approved. ' +
  'Call start_round before working: it returns the brief, the scope you may write, what you must not touch, the rules in force and the documents the brief cites. ' +
  'Call check_path before writing a file you are unsure of. A protected file needs a ruling: call request_escalation and stop until a person rules. ' +
  'Call audit_round when the work is done, and fix what it reports; archiving is a person\'s decision. ' +
  'For the architecture rules themselves, spec-guard\'s own server answers get_architectural_rules.';

const briefProperty = { type: 'string', description: 'The brief id. Omit to use the brief the branch or SPEC_BRIEF names; an empty id is refused.' };
const baseProperty = {
  type: 'string',
  description:
    'The branch the round is measured from, whose allowed signers a ruling is verified against. Omit to use the configured base; an empty one is refused.',
};

/**
 * The tool error for an argument that is given and names nothing, in the
 * words the command line has for its option. Read as left out, an empty
 * `brief` was answered for the branch's brief and an empty `base` with no
 * ruling verified, and nothing told the agent that neither was the answer to
 * what it had asked.
 */
function namesNothing(argument: string, option: ValuedOption, value: string): ToolOutcome {
  return toolError(`${emptyValue(`"${argument}"`, option, value)}.`);
}

const directoryProperty = {
  type: 'string',
  description:
    "A directory in the work tree the round is in, such as the worktree you work in. Omit to use the work tree the client's roots name, where they name one of this repository, or else the project's.",
};

/**
 * The directories a client's roots name, or `null` where it declared no
 * roots, answered with an error, or did not answer in time.
 */
export type Roots = () => Promise<readonly string[] | null>;

/** No client to ask: the tools as a caller of the package builds them, with no server around them. */
const NO_ROOTS: Roots = async () => null;

/** How long a client is given to answer `roots/list`: Claude Code answers from what it holds (its MCP page, below). */
export const ROOTS_MS = 5_000;

/**
 * The client's roots, asked as MCP has a server ask them, with a request of
 * the server's own, `roots/list`, where the client declared the capability
 * as it started: in its `initialize`, or a later request's `_meta`. Claude
 * Code's MCP page (https://code.claude.com/docs/en/mcp, Option 3: Add a local
 * stdio server, read 2026-10-19) has it answer with the session's launch
 * directory and every working directory added to it, and
 * `CLAUDE_PROJECT_DIR` the stable project root, which does not move with
 * them. The answer arrives on the input as a response, which the protocol's
 * module passes over: it is read here first, by the id it was asked under.
 */
export interface RootsClient {
  /** Reads a message before the protocol's handler does: `true` where it was the answer to a request of this one's, which is then no one else's. */
  observe(message: unknown): boolean;
  readonly ask: Roots;
}

export function rootsClient(write: (line: string) => void, limit = ROOTS_MS): RootsClient {
  let declared = false;
  let asked = 0;
  const waiting = new Map<string, (answer: unknown) => void>();
  const declares = (capabilities: unknown): boolean => isObject(capabilities) && isObject(capabilities['roots']);
  return {
    observe(message) {
      if (!isObject(message)) return false;
      const params = isObject(message['params']) ? message['params'] : {};
      const meta = isObject(params['_meta']) ? params['_meta'] : {};
      if ((message['method'] === 'initialize' && declares(params['capabilities'])) || declares(meta[CLIENT_CAPABILITIES_KEY])) declared = true;
      const id = message['id'];
      // The server's requests have strings for ids, so one that is no string
      // finds nothing waiting either way: the mutant that drops the test is
      // equivalent.
      const settle = typeof id === 'string' && message['method'] === undefined ? waiting.get(id) : undefined;
      if (settle === undefined) return false;
      settle(message);
      return true;
    },
    async ask() {
      if (!declared) return null;
      asked += 1;
      const id = `spec-harness-roots-${asked}`;
      const answer = await new Promise<unknown>((settled) => {
        const timer = setTimeout(() => settled(null), limit);
        waiting.set(id, (message) => {
          clearTimeout(timer);
          settled(message);
        });
        write(JSON.stringify({ jsonrpc: '2.0', id, method: 'roots/list' }));
      });
      waiting.delete(id);
      const result = isObject(answer) ? answer['result'] : undefined;
      const roots = isObject(result) ? result['roots'] : undefined;
      if (!Array.isArray(roots)) return null;
      // A root is a `file:` URI, by the protocol; Node refuses one of any other scheme, which names no directory here.
      return roots.flatMap((root: unknown) => {
        const uri = isObject(root) ? root['uri'] : undefined;
        if (typeof uri !== 'string') return [];
        try {
          return [fileURLToPath(uri)];
        } catch {
          return [];
        }
      });
    },
  };
}

/** Where a tool reads the round: the work tree, and what named it. */
interface Chosen {
  readonly workspace: Workspace;
  readonly from: 'argument' | 'roots' | 'server';
}

/**
 * The work tree of the server's repository that holds a directory: the
 * server's own where it is in that, with no `.git` between, and otherwise the
 * one git names, where it shares the git directory the server's repository
 * keeps; `null` where the directory is in another repository, or in none.
 */
async function treeOf(server: Workspace, io: CliIO, directory: string): Promise<Workspace | null> {
  // Asked anyway, git names the server's own top for a directory in it,
  // which answers the server's own below: the mutant that always asks is
  // equivalent, at a process's cost.
  if (!mayBeElsewhere(directory, server.root)) return server;
  const found = await findTree(directory);
  if (found === null) return null;
  // Its own work tree, opened again, reads every answer the same way: the
  // check saves a start of git, and its mutant is equivalent.
  if (realSpelling(found.root) === realSpelling(server.root)) return server;
  const common = await foundCommonDir(found);
  // git names a common directory wherever it names a top, so `null` is there for the type.
  if (common === null || realSpelling(common) !== realSpelling(server.commonDir)) return null;
  return openFound(found, io, () => [server.root]);
}

/**
 * The work tree a tool that reads a branch reads the round in (ADR-0008):
 * the one a `directory` given names; where none is given, the one the
 * client's roots name, where they name one work tree of this repository and
 * no other; and the server's own otherwise, as before. The server is started
 * once, for the project Claude Code names, and a session in a worktree
 * names that worktree to it in neither the project nor the server's root.
 */
async function chosen(server: Workspace, io: CliIO, roots: Roots, given: unknown): Promise<Chosen | ToolOutcome> {
  if (given !== undefined) {
    if (typeof given !== 'string') return toolError('"directory" must be a string.');
    if (isBlank(given)) return toolError(`"directory" is ${JSON.stringify(given)}, which names no directory; give it the directory the round is in, or leave it out.`);
    const workspace = await treeOf(server, io, resolve(server.root, given));
    if (workspace === null) return toolError(`"directory" is ${JSON.stringify(given)}, which is in no work tree of this repository; give a directory in the project or in one of its worktrees, or leave it out.`);
    return { workspace, from: 'argument' };
  }
  const named = await roots();
  if (named !== null) {
    const trees = new Map<string, Workspace>();
    for (const directory of named) {
      const workspace = await treeOf(server, io, directory);
      if (workspace !== null) trees.set(realSpelling(workspace.root), workspace);
    }
    const [only, ...more] = [...trees.values()];
    if (only !== undefined && more.length === 0) return { workspace: only, from: 'roots' };
  }
  return { workspace: server, from: 'server' };
}

/** What a tool's answer says of the work tree it read: always in its structured part, and in its text where it is not the server's own. */
function readIn(where: Chosen): { readonly said: string; readonly workTree: JsonObject } {
  const how = where.from === 'argument' ? 'the "directory" given' : "the client's roots";
  return { said: where.from === 'server' ? '' : `\n\nRead in the work tree at ${where.workspace.root}, which ${how} name.`, workTree: { root: where.workspace.root, from: where.from } };
}

/** The `base` argument, or the tool error for one that is not a string, or names no commit. */
function baseOf(args: JsonObject): { base: string | undefined } | ToolOutcome {
  const base = args['base'];
  if (base !== undefined && typeof base !== 'string') return toolError('"base" must be a string.');
  if (base !== undefined && isBlank(base)) return namesNothing('base', 'base', base);
  return { base };
}

/** The `paths` argument, or the tool error for one that is no list of files, or has a place that names none. */
function pathsOf(args: JsonObject): { paths: string[] } | ToolOutcome {
  const paths = args['paths'];
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string') || paths.length === 0) {
    return toolError('"paths" must be a non-empty array of strings.');
  }
  const empty = paths.findIndex(isBlank);
  if (empty !== -1) return namesNothing(`paths[${empty}]`, 'path', paths[empty] as string);
  return { paths };
}

/**
 * The `options` argument as the memo's choices, or the tool error for one
 * the memo cannot be written with: a choice is its label, and one without
 * was written as a number and two empty stars. What a choice costs may be
 * left out, and the memo then gives the choice alone.
 */
function optionsOf(args: JsonObject): { options: EscalationOption[] } | ToolOutcome {
  const raw = args['options'] ?? [];
  if (!Array.isArray(raw)) return toolError('"options" must be an array.');
  const options: EscalationOption[] = [];
  for (const [index, item] of raw.entries()) {
    // An item that is no object has no label, and is refused for that.
    const entry: JsonObject = item ?? {};
    const label = entry['label'];
    const consequence = entry['consequence'] ?? '';
    if (typeof label !== 'string') return toolError(`"options[${index}].label" must be a string.`);
    if (isBlank(label)) return toolError(`"options[${index}].label" is ${JSON.stringify(label)}, which names no choice; give the option a label, or leave the option out.`);
    if (typeof consequence !== 'string') return toolError(`"options[${index}].consequence" must be a string.`);
    options.push({ label: label.trim(), consequence: consequence.trim() });
  }
  return { options };
}

async function round(workspace: Workspace, env: CliIO['env'], id: unknown): Promise<{ brief: BriefRow; briefs: BriefRow[] } | ToolOutcome> {
  if (id !== undefined && typeof id !== 'string') return toolError('"brief" must be a string.');
  if (id !== undefined && isBlank(id)) return namesNothing('brief', 'brief', id);
  const briefs = await workspace.siblings.briefs();
  const fromBranch = briefIdFromBranch(workspace.config.branches, workspace.branch);
  const active = findActive(briefs, { argument: id, environment: env['SPEC_BRIEF'], branch: fromBranch });
  // Named as every argument of a tool is, where it was called the flag, and
  // a tool call has none.
  const { brief, note, problem } = describeActive(active, '"brief"');
  if (problem !== null) return toolError(problem);
  if (brief === null) return toolError(note);
  return { brief, briefs };
}

export function tools(workspace: Workspace, env: CliIO['env'], roots: Roots = NO_ROOTS): ToolDefinition[] {
  const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
  // A tool writes nothing to the server's streams, so these are never
  // written to, and their mutants are equivalent: what a tool says is its
  // answer.
  const quiet = { write: (): boolean => true };
  const io: CliIO = { stdout: quiet, stderr: quiet, cwd: workspace.cwd, env };
  return [
    {
      descriptor: {
        name: 'start_round',
        title: 'Start a round',
        description:
          'Everything needed to start the round: the brief in full, the files it may write and must not change, signed rulings, the briefs it depends on, the architecture rules in force for its scope, and the documents it cites.',
        inputSchema: { type: 'object', properties: { brief: briefProperty, base: baseProperty, directory: directoryProperty }, additionalProperties: false },
        annotations: readOnly,
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, ['brief', 'base', 'directory']);
        if (unknown) return unknown;
        const base = baseOf(args);
        if ('text' in base) return base;
        const where = await chosen(workspace, io, roots, args['directory']);
        if ('text' in where) return where;
        const found = await round(where.workspace, env, args['brief']);
        if ('text' in found) return found;
        const packet = await buildContext(where.workspace, found.brief, found.briefs, reader, base.base);
        const { said, workTree } = readIn(where);
        return {
          text: `${packet.markdown}${said}`,
          structured: {
            workTree,
            brief: found.brief.id,
            included: [...packet.included],
            omitted: [...packet.omitted],
            unresolved: [...packet.unresolved],
            unclosedFrontMatter: [...packet.unclosedFrontMatter],
            unreadableFrontMatter: [...packet.unreadableFrontMatter],
            unreadableScope: [...packet.unreadableScope],
            unreadableProtections: [...packet.unreadableProtections],
            unreadableRulingPaths: [...packet.unreadableRulingPaths],
            unmatchedSpecs: [...packet.unmatchedSpecs],
          },
        };
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
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Paths relative to the top of the work tree the round is in, or absolute; an absolute one in another work tree of this repository is decided by that one. An empty one is refused.',
            },
            brief: briefProperty,
            base: baseProperty,
            directory: directoryProperty,
          },
          required: ['paths'],
          additionalProperties: false,
        },
        annotations: readOnly,
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, ['paths', 'brief', 'base', 'directory']);
        if (unknown) return unknown;
        const given = pathsOf(args);
        if ('text' in given) return given;
        const base = baseOf(args);
        if ('text' in base) return base;
        const where = await chosen(workspace, io, roots, args['directory']);
        if ('text' in where) return where;
        // Each path by the work tree of this repository that holds it, as the
        // hook decides a write: the one read, another, or the server's own.
        const decisions = [];
        for (const part of await writesBy(workspace, where.workspace.root, given.paths, io)) {
          const found = await round(part.workspace, env, args['brief']);
          if ('text' in found) return found;
          decisions.push(...(await checkPaths(part.workspace, found.brief, undefined, part.paths, where.workspace.root, reader, base.base)));
        }
        const text = decisions.map((d) => `${d.verdict}: ${d.message}${d.verdict === 'allow' ? '' : `. Next: ${d.hint}`}`).join('\n');
        const { said, workTree } = readIn(where);
        return { text: `${text}${said}`, structured: { workTree, decisions: decisions.map((d) => ({ ...d })) } };
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
            paths: { type: 'array', items: { type: 'string' }, description: 'The protected files the round needs to change. An empty one is refused.' },
            reason: { type: 'string', description: 'Why the round cannot be done without them. It is required, and may not be empty.' },
            options: {
              type: 'array',
              items: { type: 'object', properties: { label: { type: 'string' }, consequence: { type: 'string' } }, required: ['label', 'consequence'] },
              description: 'The choices the person has, each with what it costs. A choice whose label is empty is refused.',
            },
            recommendation: { type: 'string', description: 'Which option you recommend, and why. Omit it when there is none: an empty one is refused.' },
            brief: briefProperty,
            directory: directoryProperty,
          },
          required: ['paths', 'reason'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, ['paths', 'reason', 'options', 'recommendation', 'brief', 'directory']);
        if (unknown) return unknown;
        // Every part of the memo before anything is written: a person rules
        // on what it says, and cannot rule on a part that says nothing.
        const given = pathsOf(args);
        if ('text' in given) return given;
        const reason = args['reason'];
        if (typeof reason !== 'string' || isBlank(reason)) return toolError('"reason" is required.');
        const choices = optionsOf(args);
        if ('text' in choices) return choices;
        const recommendation = args['recommendation'];
        if (recommendation !== undefined && typeof recommendation !== 'string') return toolError('"recommendation" must be a string.');
        if (recommendation !== undefined && isBlank(recommendation)) return namesNothing('recommendation', 'recommend', recommendation);
        const where = await chosen(workspace, io, roots, args['directory']);
        if ('text' in where) return where;
        const found = await round(where.workspace, env, args['brief']);
        if ('text' in found) return found;
        const { request, memo } = await raiseEscalation(where.workspace, found.brief, {
          paths: given.paths,
          reason,
          options: choices.options,
          recommendation: recommendation ?? null,
        });
        const { said, workTree } = readIn(where);
        return { text: `${memo}\nStop here until a person rules on ${request.id}.${said}`, structured: { id: request.id, workTree } };
      },
    },
    {
      descriptor: {
        name: 'audit_round',
        title: 'Audit the round',
        description:
          'Did the round stay inside the lines: what the archive would refuse (open boxes, protected files, files outside the scope), the brief\'s own assertions, unverified rulings, every dependency added and every package allowed to run install scripts.',
        inputSchema: { type: 'object', properties: { brief: briefProperty, base: baseProperty, directory: directoryProperty }, additionalProperties: false },
        annotations: readOnly,
      },
      async call(args: JsonObject): Promise<ToolOutcome> {
        const unknown = unknownArguments(args, ['brief', 'base', 'directory']);
        if (unknown) return unknown;
        const base = baseOf(args);
        if ('text' in base) return base;
        const where = await chosen(workspace, io, roots, args['directory']);
        if ('text' in where) return where;
        const found = await round(where.workspace, env, args['brief']);
        if ('text' in found) return found;
        const result = await runAudit(where.workspace, found.brief, reader, base.base);
        const { counts, findings, measured } = result.report;
        // What was measured beside what was found: "nothing found" from an
        // audit that ran no goal is not a round that is done.
        const text =
          findings.length === 0
            ? 'The audit found nothing in what it measured.'
            : findings.map((f) => `${f.severity} ${f.rule}: ${f.message}. Next: ${f.hint}`).join('\n');
        const { said, workTree } = readIn(where);
        return {
          text: `${text}\n\n${describeMeasured(measured)}\n\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.note} note(s)${said}`,
          structured: { workTree, counts, measured: { ...measured }, findings: findings.map((f) => ({ ...f })) },
        };
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
          .map((b) => `${[b.id, titleOf(b)].filter((part) => part !== null).join(' ')} - ${b.status ?? 'unknown'}, wave ${b.wave ?? '-'}, ${b.ready ? 'ready' : `waits on ${b.waitingOn.join(', ')}`}`)
          .join('\n');
        return { text: text === '' ? 'No live brief.' : text, structured: { briefs: live.map((b) => ({ ...b, title: titleOf(b) })) } };
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
  // The package ships the skills beside dist/ (package.json's files), so one
  // that cannot be read is a broken install, and the request fails saying so
  // rather than serving an empty prompt.
  const text = readFileSync(fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), 'utf8');
  // Every skill opens with its front matter (tests/source.test.ts), so the
  // anchor is equivalent to its mutant here.
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
  // Claude Code starts a plugin's server in the plugin's directory, and names
  // the project in CLAUDE_PROJECT_DIR; the server answers for the project.
  const workspace = await openWorkspace({ ...options, root: options.root ?? (io.env['CLAUDE_PROJECT_DIR'] || undefined) }, io);
  const write = (line: string): void => {
    io.stdout.write(`${line}\n`);
  };
  // The work tree a session is in, where its client names it (ADR-0008).
  const roots = rootsClient(write);
  const handle = createMcpServer({ name: 'spec-harness', version: version(), instructions: INSTRUCTIONS, tools: tools(workspace, io.env, roots.ask), prompts: prompts() });
  // A session handed over whole, as a test hands it, is served as a client
  // would stream it on stdin. Only the built command line serves
  // process.stdin, and the suite spawns it from dist/, outside the sweep
  // (tests/integration/mcp.test.ts), so a mutant that ignores it survives.
  const input = io.stdin === undefined ? process.stdin : Readable.from([Buffer.from(await io.stdin())]);
  await serveLines(input, write, async (message) => (roots.observe(message) ? null : handle(message)));
  return 0;
}
