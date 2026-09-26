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

Configures the family to agree: spec-brief's directories, spec-graph reading the archive as history (so a brief depending on an archived one is not a stale premise), `.spec-harness.json` with the base branch, the Claude Code hooks, the MCP server, and with `--git-hook` a pre-commit hook. It prints the plan, merges into files that exist, and changes nothing without `--write`.

### `doctor`

Which sibling tools are installed, at which versions, and how each is run, the repository root, the branch, and the brief the flag, `SPEC_BRIEF` or the branch names. A sibling older than this release needs is `outdated`, with the minimum and the command that installs a newer one, and exit 1. A command named under `tools` is run as named, and its version is not checked. The first thing to run when a hook refuses something unexpectedly.

## As a Claude Code plugin

The repository is a plugin and a one-plugin marketplace: the four skills (`draft-brief`, `split-goal`, `run-round`, `close-round`), the hooks and the MCP server. It calls the `spec-harness` installed in your project.

```text
/plugin marketplace add DescentVTT/spec-harness
/plugin install spec-harness@spec-tools
```

## Configuration

`.spec-harness.json` at the repository root. Every key is optional; an unknown key stops the run with exit 2.

| Key | Default | What it says |
| --- | --- | --- |
| `branches` | `brief/{id}`, `brief-{id}`, `*/brief/{id}`, `*/brief-{id}` | Branch names that carry the active brief's id. |
| `outOfScope` | `"warn"` | A write outside `affectedFiles`: `warn`, `ask` or `deny`. |
| `base` | the remote's default branch | What rounds are measured from, and where allowed signers are read. |
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
