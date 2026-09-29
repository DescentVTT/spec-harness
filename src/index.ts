/**
 * Programmatic API. The command line is a thin shell over these; a harness of
 * another kind - a CI job, an orchestrator - can ask the same questions.
 */

export { main, run, EXIT_ERROR, EXIT_FAILED, EXIT_OK, UsageError, version } from './cli.js';
export type { CliIO } from './cli.js';

export { audit } from './audit.js';
export type { AssertionOutcome, AuditInput, AuditReport } from './audit.js';
export { briefIdFromBranch, idFromBranch, sameId, templateError } from './branch.js';
export { findActive, parseBriefList, SiblingOutputError, SUPPORTED_SCHEMA_VERSIONS } from './briefs.js';
export type { ActiveBrief, ActiveSource } from './briefs.js';
export { ConfigError, CONFIG_FILE, DEFAULT_CONFIG, parseConfig, SIBLINGS } from './config.js';
export type { HarnessConfig, OutOfScope, SiblingName } from './config.js';
export { renderContext } from './context.js';
export type { CitedDocument, ContextInput, ContextPacket, RuleInForce, RulingInForce, UnreadablePattern, UnreadableRulingPath } from './context.js';
export { decide } from './guard.js';
export type { Decision, GuardInput, Reason, Verdict, VerifiedRuling } from './guard.js';
export { claudeResponse, gitResponse, parseClaudeHook, WRITING_TOOLS } from './hooks.js';
export type { HookRequest, HookResponse } from './hooks.js';
export { readJUnit } from './junit.js';
export type { JUnitCase, JUnitRead } from './junit.js';
export { diffManifest, ecosystemOf, manifestMatcher, readManifest, readManifestNames } from './manifests.js';
export type { Dependency, DependencyChange, Ecosystem, ManifestNames } from './manifests.js';
export { classify, readProbes, renderEvidence, verdictOf } from './probe.js';
export type { Classified, CodeBlock, ProbeFile, ProbeResult, ProbeRun, ProbeSet, ProbeSpec } from './probe.js';
export { createReader } from './reader.js';
export { addRulingRow, nextId, pathsOf, readRulings, renderMemo, renderRow } from './rulings.js';
export type { EscalationOption, EscalationRequest, RulingRow, TableView } from './rulings.js';
export { buildContext, checkPaths, checkRulings, raiseEscalation, recordRuling, resolveBase, runAudit } from './round.js';
export { GUARD_HOOK, mcpServer, mergeClaudeSettings, mergeMcp, mergeSpecGraph, PROJECT_DIR, PROJECT_DIR_OR_HERE } from './configure.js';
export type { BriefRow, FileChange, Finding, Severity } from './types.js';
