# spec-harness

**Rounds of agent work under a brief a person approved: what the agent needs to start, a guard on every write, an escalation a person signs when the brief is not enough, and an audit when it ends.**

spec-harness is the agent-facing member of the [spec-\* tools](https://github.com/DescentVTT/spec-core#the-family). It calls no model and writes no content - the agent is the model. It gives the agent the contract and the facts, and answers, the same way every time, whether the agent stayed inside the lines. No runtime dependencies, no account, no network.

```bash
npm install --save-dev @descent-vtt/spec-harness @descent-vtt/spec-brief
npx spec-harness init            # the plan: what it would configure, and why
npx spec-harness init --write    # apply it
```

spec-brief 0.2.0 or later is required: the brief is the contract, spec-brief is its reader, and 0.2.0 is the first whose archive asks this package's plugin about signed rulings. spec-guard 0.12.0 and spec-graph 0.9.0 or later are used when they are installed, and their absence is reported, never assumed clean. A sibling installed below its minimum is never run: `doctor` and every command that needed it name the minimum ([ADR-0011](docs/adr/0011-releases-are-staged-by-ci.md)).

## A round

```text
person approves brief 012 ─▶ agent on branch brief/012-rotate-tokens
                                   │
            spec-harness context ◀─┘  the brief, its scope, signed rulings,
                   │                  the rules in force, the documents it cites
                   ▼
         agent edits ── hook: protected? refused, with the next step
                   │          outside the scope? a warning after the write
                   │
                   ├── needs a protected file ─▶ escalate ─▶ person rules, signs
                   ▼
            spec-harness audit ─▶ spec-brief archive --dry-run ─▶ person archives
```

### `context [brief]`

The brief in full - it is the contract - then what it implies: the files the round may write and must not change as the guard reads them, the rulings already signed, the briefs it depends on and whether they are done, the architecture rules spec-guard holds that code to, and the documents the brief links to, whole, until the packet reaches its budget (`context.budget`, 60,000 characters). Documents left out are named by path, not dropped.

### `guard <path...>` and the hooks

May the round write this? A path the brief protects is **refused** unless a signed ruling allows it; a path in `affectedFiles` is allowed; anything else is **outside the scope** - a warning by default, or a question to the person, or a refusal (`outOfScope`: `warn`, `ask`, `deny`). Paths are compared as the filesystem spells them, links resolved and case corrected, so `SRC/db/schema.ts` does not walk past a protection on `src/db/schema.ts` on Windows.

`spec-harness hook claude` answers Claude Code's PreToolUse and PostToolUse hooks: a refusal before the write, with the reason and the next step; a warning after a write outside the scope. It never answers `allow`, which would skip the person's own permission prompt. `spec-harness hook git` is a pre-commit hook for any agent or none. A guard is a guardrail - an agent that writes through a shell passes it - so the audit and spec-brief's archive are the gates ([ADR-0005](docs/adr/0005-a-guard-is-a-guardrail.md)).

**Which brief?** `--brief <id>`, then `SPEC_BRIEF`, then the branch name (`brief/{id}`, `brief-{id}`, `*/brief/{id}`, `*/brief-{id}`). Never guessed ([ADR-0004](docs/adr/0004-the-active-brief-is-named-not-guessed.md)).

### `escalate`, `rule`, `rulings`

```bash
# the agent, when the round cannot be done without a protected file
npx spec-harness escalate --path src/db/schema.ts \
  --reason "Rotation needs a rotated_at column." \
  --option "Allow: one additive column" --option "Refuse: rotation keeps no timestamp" \
  --recommend "Allow; the column is additive."

# the person
npx spec-harness escalate --show E-012-1
npx spec-harness rule E-012-1 --allow --note "Add rotated_at only."
git commit -S -m "ruling R-012-1: allow" -- briefs/012_rotate-tokens.md
```

A ruling is a row in the brief's `## Rulings` table. It **counts** when the commit that last changed the row is signed by a key the **base branch's** `.github/allowed_signers` lists. An agent can write a row and compute any hash; it cannot produce the person's signature, and an edit to the row moves it to a commit that must be signed again ([ADR-0006](docs/adr/0006-a-ruling-is-a-signed-commit.md)). Use a FIDO2 key (`ed25519-sk`) where the agent runs as you: its signature needs a touch no process can supply.

spec-brief's archive refuses a round that changed a protected file, and learns that a signed ruling allows it only from this package's plugin: `init` adds `"plugins": ["@descent-vtt/spec-harness/spec-brief-plugin"]` to spec-brief's configuration. Without it, the archive refuses the file whatever was signed; `doctor` says whether spec-brief loads the plugin, and `audit` names it as the reason for such a refusal.

### `audit [brief]`

One report: what spec-brief's archive would refuse or warn about, run with `--dry-run`; the brief's own assertions through spec-guard - a goal that fails, or a premise (under a heading such as *The Defect, Measured*) that still holds after the round meant to change it; rulings whose signatures do not verify; and every dependency the round added to `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `requirements*.txt`, NuGet project files or a `Gemfile`. A part that could not be measured is a finding, never a silence.

### `probe [brief]`

A defect is measured before it is filed. The brief carries its probe:

````markdown
```probe
id: old-token-still-accepted
setup: npm ci
run: npx vitest run tests/probes/rotate.test.ts
signature: expected 401, got 200
```

```probe-file tests/probes/rotate.test.ts
...
```
````

`probe --at base` runs it in a temporary worktree at the base commit: every run must fail **for the declared reason** - the `signature` in the output, or a JUnit `test` failing - or the verdict is `vacuous` (no defect), `flaky` or `invalid`. `probe --at head` must be green: `fixed`. The evidence table it prints names the hash of the probe it measured with ([ADR-0007](docs/adr/0007-probes-declare-their-failure.md)).

### `premises`

Is every live brief still about something true? It runs spec-guard over the live briefs' assertions and reports each premise - an assertion under a section in `assertions.premises` - that no longer holds as `stale-premise`: the defect was fixed another way, or the code the brief describes is gone, and an agent sent to fix it would fix nothing. Goals are left to `audit`, since a goal fails until its round is done. Run it in CI: exit 1 when a premise is stale, exit 2 when spec-guard is not there to ask.

### `mcp`

`start_round`, `check_path`, `request_escalation`, `audit_round` and `list_rounds` over MCP on stdio, with the four workflow prompts. Both protocol eras are served. The architecture rules themselves stay with spec-guard's server.

### `init`

Configures the family to agree. It prints the plan, merges into files that exist, keeping what is there, and changes nothing without `--write`:

- **spec-brief**: `spec-brief init` when there is no configuration, then this package's plugin in its `plugins`, `"@descent-vtt/spec-harness/spec-brief-plugin"`. spec-brief's archive asks the plugin whether a signed ruling allows a protected file, and refuses the file without it.
- **spec-graph**, when it is installed: the archive in its `historyPatterns`, so an archived brief is a record whatever its status says, and a live brief that depends on one is not a stale premise. That holds only where spec-graph reads the briefs, and its default patterns (`docs/`, `doc/`, `adr/`, `rfcs/`, `specs/` and Markdown at the root) do not reach `briefs/`: `init` says whether they do, and leaves adding the briefs to `patterns` to you, since that changes what spec-graph checks, and its `patterns` replace its defaults. It merges into the configuration spec-graph reads, and leaves a `"spec-graph"` key in `package.json` to you.
- **`.spec-harness.json`**, naming the base rounds are measured from and the allowed signers are read on: the remote's default branch where git recorded one, as a clone does; otherwise the branch `init` runs on when it is `main` or `master`, or the only branch, since a repository made with `git init` and pushed to a remote records no default. When it cannot tell, it says so and writes none: set `"base"` yourself.
- **Claude Code**: the guard hooks in `.claude/settings.json` and the MCP server in `.mcp.json`, each run with `node` from the project's `node_modules`. These are the ones the [plugin](#as-a-claude-code-plugin) brings: use one or the other. The `npx` entries 0.1 wrote are replaced.
- With `--git-hook`, a pre-commit hook.

### `doctor`

Which sibling tools are installed, at which versions, and how each is run, the repository root, the branch, and the brief the flag, `SPEC_BRIEF` or the branch names. Then what a signed ruling needs to count: the base, and whether `--base`, `.spec-harness.json` or the remote named it; whether the allowed-signers file is on that base; and whether spec-brief loads this package's plugin. A sibling older than this release needs is `outdated`, with the minimum and the command that installs a newer one, and exit 1. A command named under `tools` is run as named, and its version is not checked. The first thing to run when a hook refuses something unexpectedly.

## As a Claude Code plugin

The repository is a plugin and a one-plugin marketplace: the four skills (`draft-brief`, `split-goal`, `run-round`, `close-round`), the hooks and the MCP server. The hooks and the server run the `spec-harness` installed in your project, `node ${CLAUDE_PROJECT_DIR}/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js`, so install it there first; the server is told the project with `--root`, since Claude Code starts a plugin's server in the plugin's own directory.

```text
/plugin marketplace add DescentVTT/spec-harness
/plugin install spec-harness@spec-tools
```

The plugin's hooks and server are the ones `init` writes into `.claude/settings.json` and `.mcp.json`: use one or the other. With both, every write is guarded twice and the server is registered twice, so with the plugin, leave those two files out of what `init` writes, or take its `spec-harness` entries out of them.

## Configuration

`.spec-harness.json` at the repository root. Every key is optional; an unknown key stops the run with exit 2.

| Key | Default | What it says |
| --- | --- | --- |
| `branches` | `brief/{id}`, `brief-{id}`, `*/brief/{id}`, `*/brief-{id}` | Branch names that carry the active brief's id. |
| `outOfScope` | `"warn"` | A write outside `affectedFiles`: `warn`, `ask` or `deny`. |
| `base` | the remote's default branch | What rounds are measured from, and where allowed signers are read. `init` names it, since a repository that was not cloned has no default branch recorded. |
| `rulings.section` | `"Rulings"` | The brief section holding the rulings table. |
| `rulings.allowedSigners` | `".github/allowed_signers"` | The allowed-signers file, read from the base branch. |
| `dependencies.manifests` | the list above | Manifest names whose added dependencies the audit reports. |
| `context.budget` | `60000` | Characters a context packet may hold; cited documents fill what the rest leaves, and those that do not fit are named by path. |
| `assertions.premises` | `The Defect, Measured`, `Premises`, `Preconditions` | Sections whose assertions state what was true before the round. |
| `probes.runs`, `probes.timeout` | `2`, `600` | Runs per probe, and seconds per run. |
| `tools` | found in `node_modules` | A sibling's command by name: `{ "spec-brief": ["node", "path/to/spec-brief.js"] }`. |

**Exit codes:** `0` clean, `1` refused, found something, or waiting on a person, `2` the answer cannot be trusted.

## Design

The decisions and what they cost are in [`docs/adr/`](docs/adr/README.md); what the whole family shares is [spec-core's ADR-0005](https://github.com/DescentVTT/spec-core/blob/main/docs/adr/0005-the-family-contract.md).

## License

MIT
