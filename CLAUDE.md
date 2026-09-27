# CLAUDE.md

Working agreements for this repository. The ADRs in `docs/adr/` carry the
reasoning; spec-core's ADR-0005 is the contract every spec-* tool keeps.

## Invariants

Breaking one is a decision that needs an ADR.

- **No model, no content.** The harness gives and judges; it never writes a
  brief, an ADR, a fix or a ruling ([ADR-0001](docs/adr/0001-the-harness-decides-the-agent-writes.md)).
- **Siblings through their command lines**, versioned JSON, never imports and
  never a shell. A missing sibling is reported, never assumed clean
  ([ADR-0002](docs/adr/0002-siblings-through-their-command-lines.md)).
- **No state in the work tree; no git writes but temporary worktrees**, always
  removed ([ADR-0003](docs/adr/0003-state-outside-the-work-tree.md)).
- **The active brief is named, not guessed** ([ADR-0004](docs/adr/0004-the-active-brief-is-named-not-guessed.md)).
- **The hook never answers `allow`** ([ADR-0005](docs/adr/0005-a-guard-is-a-guardrail.md)).
- **A ruling counts only by a signature verified against the base branch's
  allowed signers** ([ADR-0006](docs/adr/0006-a-ruling-is-a-signed-commit.md)).
- **Zero runtime dependencies**, native ESM, TypeScript 7, Node >= 22, strict.
  spec-core is vendored in `src/vendor/spec-core/` and never edited there:
  change spec-core and run its `scripts/vendor.mjs`.
- **LF, no control characters.**
- **Skills stay under 30,000 characters together** ([ADR-0009](docs/adr/0009-prompts-are-workflow-with-a-budget.md)).

## Verification

```bash
npm run lint            # tsc --noEmit
npm test                # vitest: unit and integration
npm run build
npm run test:mutation   # the core sweep: pure modules against tests/unit
```

Both mutation sweeps run in GitHub Actions. The core sweep is a job in
`ci.yml`, on every change, and its `break` is the gate. The full sweep,
`npm run test:mutation:full`, every module against the whole suite, is
`mutation.yml`: weekly and on request, with its own `break` of 89, set below
its first hosted run ([ADR-0010](docs/adr/0010-toolchain-and-verification.md)).

## Layout

| Module | Responsibility |
| --- | --- |
| `branch.ts`, `briefs.ts`, `config.ts` | Which brief, what spec-brief says about it, what the repository configured. |
| `guard.ts`, `hooks.ts` | May this path be written, and the answer in each hook's language. |
| `context.ts`, `audit.ts`, `manifests.ts` | The context packet; the audit's judgement; dependency diffs. |
| `rulings.ts`, `probe.ts`, `junit.ts` | Escalations and rulings; probes and their verdicts; JUnit reports. |
| `reader.ts` | Documents through spec-core's Markdown scanner. |
| `round.ts` | The operations the CLI and the server share: facts gathered, decisions delegated. |
| `versions.ts` | The oldest release of each sibling this one runs, and an installed version against it. |
| `git.ts`, `fs.ts`, `siblings.ts`, `sandbox.ts` | The edges. |
| `configure.ts` | What `init` writes into each tool's configuration. |
| `cli.ts`, `commands.ts`, `setup.ts`, `server.ts` | The command line, `init`, and the MCP server. |

## Prose

Comments explain why, never what. No exclamation marks, no hedging. The same
for diagnostics, hints and commit bodies.
