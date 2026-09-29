# spec-harness

**Rounds of agent work under a brief a person approved: what the agent needs to start, a guard on every write, an escalation a person signs when the brief is not enough, and an audit when it ends.**

spec-harness is the agent-facing member of the [spec-\* tools](https://github.com/DescentVTT/spec-core#the-family). It calls no model and writes no content - the agent is the model. It gives the agent the contract and the facts, and answers, the same way every time, whether the agent stayed inside the lines. No runtime dependencies, no account, no network.

```bash
npm install --save-dev @descent-vtt/spec-harness @descent-vtt/spec-brief
npx spec-harness init            # the plan: what it would configure, and why
npx spec-harness init --write    # apply it
```

spec-brief 0.2.0 or later is required: the brief is the contract, spec-brief is its reader, and 0.2.0 is the first whose archive asks this package's plugin about signed rulings. spec-guard 0.12.0 and spec-graph 0.9.0 or later are used when they are installed, and their absence is reported, never assumed clean. A sibling installed below its minimum is never run: `doctor` and every command that needed it name the minimum ([ADR-0011](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0011-releases-are-staged-by-ci.md)).

Claude Code 2.1.139 or later runs the guard hooks and the plugin's server: the hooks pass the project's path in a hook's `args`, which Claude Code reads from that release on, and the plugin's server names `${CLAUDE_PROJECT_DIR}`, which a plugin may from the same release ([ADR-0012](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0012-one-way-into-claude-code.md)). An older Claude Code runs every write unguarded, so `doctor` checks the one on `PATH`.

git 2.31 or later: spec-harness asks git where its shared directory and its hooks are with `rev-parse --path-format`, which that release added (2021).

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

The brief in full - it is the contract - then what it implies: the files the round may write and must not change as the guard reads them, the rulings already signed, the briefs it depends on and whether they are done, the architecture rules spec-guard holds that code to, and the documents the brief links to, whole, until the packet reaches its budget (`context.budget`, 60,000 characters). Documents left out are named by path, not dropped. So is a document whose front matter opens on its first line and is never closed, which spec-core's scanner reads as no front matter: its status was not read, and the packet says so, with the fix - close the block with `---` on a line of its own - rather than showing a document without one. The note fails nothing; `context` exits 0. Rules spec-guard could not read are named as unread, with what it said, never as none; a repository where no spec file matches spec-guard's patterns has none. The rules are those over the scope: spec-guard is asked about where `affectedFiles` can reach, `src` for `src/**` or `src/`, not the whole repository. A name with no glob syntax that exists, `src` or `src/a.ts`, is asked about as itself; one the round has yet to create is asked about through the directory that will hold it, the root for a name at the top, since it may become a directory as well as a file ([ADR-0001](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0001-the-harness-decides-the-agent-writes.md)). A pattern in `affectedFiles` the guard cannot read - malformed, too large to compile, or naming no path, such as `{./,src}` - is named as unread where the scope is listed, with spec-core's reason, the one the guard gives when it passes over it: it puts no path in the scope, and spec-guard is not asked about it. When no pattern in `affectedFiles` can be read, the packet says the scope could not be read, never that spec-guard holds no rule over it. `context --format json` and `start_round` list such patterns as `unreadableScope`. A protection the guard cannot read is named the same way where the protections are listed, with what it does: until it is fixed, the guard refuses every write but to the brief, and no ruling waives the refusal. So is a path of a signed ruling the guard cannot read, where the ruling is listed: the guard passes over it, so it allows nothing. They are listed as `unreadableProtections`, each with its `pattern` and `reason`, and `unreadableRulingPaths`, each with its `ruling` as well. `--base` names the base the rulings are verified against.

### `guard <path...>` and the hooks

May the round write this? A path the brief protects is **refused** unless a signed ruling allows it; a path in `affectedFiles` is allowed; anything else is **outside the scope** - a warning by default, or a question to the person, or a refusal (`outOfScope`: `warn`, `ask`, `deny`). Paths are compared as the filesystem spells them, links resolved and case corrected, so `SRC/db/schema.ts` does not walk past a protection on `src/db/schema.ts` on Windows.

`spec-harness hook claude` answers Claude Code's PreToolUse and PostToolUse hooks: a refusal before the write, with the reason and the next step; a warning after a write outside the scope. It never answers `allow`, which would skip the person's own permission prompt. `spec-harness hook git` is a pre-commit hook for any agent or none. A guard is a guardrail - an agent that writes through a shell passes it - so the audit and spec-brief's archive are the gates ([ADR-0005](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0005-a-guard-is-a-guardrail.md)).

**Which brief?** `--brief <id>`, then `SPEC_BRIEF`, then the branch name (`brief/{id}`, `brief-{id}`, `*/brief/{id}`, `*/brief-{id}`). Never guessed ([ADR-0004](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0004-the-active-brief-is-named-not-guessed.md)). CI checks out a commit on no branch, so on a detached HEAD the branch is the one the forge's CI names, the first of: `GITHUB_HEAD_REF` (a GitHub pull request), `GITHUB_REF_NAME` when `GITHUB_REF_TYPE` is `branch` (a GitHub push), `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` (a GitLab merge request pipeline), `CI_COMMIT_BRANCH` (a GitLab branch pipeline). A branch checked out always wins, and `doctor` says which variable named the branch. Without them, a round's own CI run would name no brief, and `premises` would report the premise the round retires as stale.

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

A ruling is a row in the brief's `## Rulings` table. It **counts** when the commit that last changed the row is signed by a key the **base branch's** `.github/allowed_signers` lists. An agent can write a row and compute any hash; it cannot produce the person's signature, and an edit to the row moves it to a commit that must be signed again ([ADR-0006](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0006-a-ruling-is-a-signed-commit.md)). Use a FIDO2 key (`ssh-keygen -t ed25519-sk`) where the agent runs as you: its signature needs a touch no process can supply. The file is `rulings.allowedSigners` in `.spec-harness.json`, `.github/allowed_signers` by default.

spec-brief's archive refuses a round that changed a protected file, and learns that a signed ruling allows it only from this package's plugin: `init` adds `"plugins": ["@descent-vtt/spec-harness/spec-brief-plugin"]` to spec-brief's configuration. Without it, the archive refuses the file whatever was signed; `doctor` says whether spec-brief loads the plugin, and `audit` names it as the reason for such a refusal. spec-brief loads a plugin by a path as well, one that starts with `.` or is absolute: a path to this package's plugin file counts as loading it.

### `audit [brief]`

One report: what spec-brief's archive would refuse or warn about, run with `--dry-run`; the brief's own assertions through spec-guard - a goal that fails, or a premise (under a heading such as *The Defect, Measured*) that still holds after the round meant to change it; rulings whose signatures do not verify; and every dependency the round added to `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `requirements*.txt`, NuGet project files or a `Gemfile`. A part that could not be measured is a finding, never a silence. Each of these is a warning, which fails the audit only under `--strict`:

- `assertion-unreadable`: an assertion in the brief spec-guard cannot read, on its line, with spec-guard's reason. Nothing it states was run.
- `manifest-name-unread`: a name in `dependencies.manifests` that spec-core's glob cannot read, malformed or too large to compile, with the reason. The audit reads the manifests the other names name.
- `manifest-name-rooted`: a name a leading `/` roots at the filesystem's root, alone or on a brace alternative, such as `/package.json` or `{/Gemfile,Cargo.toml}`. Every path the audit reads is repository-relative, so the rooted part names no manifest; write the name without the slash, since a name is matched at any depth.

What was measured is said beside what was found, so an audit that found nothing can be told from one that checked nothing ([spec-core's ADR-0005](https://github.com/DescentVTT/spec-core/blob/main/docs/adr/0005-the-family-contract.md)). It is the line above the counts, which stay the last line:

```text
measured: goals: 2 held, 0 failed · premises: 1 retired, 0 holding · archive: asked · rulings: none · dependencies: 3 changed, 0 unread
0 error(s), 0 warning(s), 1 note(s)
```

A brief that declares no assertion says `goals: none declared`, and draws no warning: a brief without assertions is a brief, and the archive still measures its round. `--format json` has the same as `measured`, beside `counts`: `changes` (`measured` or `unmeasured`), `archive` (`asked` or `unavailable`), `assertions` (`run` or `unavailable`), `goals` (`held`, `failed`), `premises` (`retired`, `holding`), `unreadableAssertions`, `rulings` (`verified`, `unverified`) and `dependencies` (`changed`, `unread`). `audit_round` says it too.

`--format gitlab`, `sarif` or `github` prints the findings for a forge: a GitLab Code Quality report, SARIF 2.1.0, or GitHub workflow commands. Each carries the finding's hint after its message. A finding with no file of its own is placed on the brief, and one with no line on line 1. An error is `major` in GitLab, a warning `minor` and a note `info`; SARIF's levels and GitHub's commands are `error`, `warning` and `note` or `notice`. The fingerprint is the SHA-256 of the rule, the file and the finding's `subject` - the assertion, ruling, dependency or name it is about - never of its message or line, so a reworded message or a line added above does not read as one problem fixed and another found; SARIF carries it as `partialFingerprints.specHarnessFinding`, with what was measured as a note. In GitLab CI:

```yaml
spec-harness:
  image: node:22
  script:
    - npm ci
    - npx spec-harness audit --format gitlab > gl-spec-harness.json
  artifacts:
    when: always
    reports:
      codequality: gl-spec-harness.json
```

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

`probe --at base` runs it in a temporary worktree at the base commit: every run must fail **for the declared reason** - the `signature` in the output, or a JUnit `test` failing - or the verdict is `vacuous` (no defect), `flaky` or `invalid`. `probe --at head` must be green: `fixed`. The evidence table it prints names the hash of the probe it measured with ([ADR-0007](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0007-probes-declare-their-failure.md)). Interrupted, it stops every command it started, with everything those started, before it removes the worktree ([ADR-0003](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0003-state-outside-the-work-tree.md)).

### `premises`

Is every live brief still about something true? It runs spec-guard over the live briefs' assertions and reports each premise - an assertion under a section in `assertions.premises` - that no longer holds as `stale-premise`: the defect was fixed another way, or the code the brief describes is gone, and an agent sent to fix it would fix nothing. Goals are left to `audit`, since a goal fails until its round is done. For the same reason, the premise of the brief a round is working on - the one `--brief`, `SPEC_BRIEF` or the branch names - is reported as `audit` reports it, `premise-retired`, a note that fails nothing: on the round's branch, a premise that no longer holds is the work being done. Run it in CI: exit 1 when a premise is stale, exit 2 when spec-guard is not there to ask. `--format gitlab`, `sarif` or `github` prints its findings for a forge, as `audit` does.

### `mcp`

`start_round`, `check_path`, `request_escalation`, `audit_round` and `list_rounds` over MCP on stdio, with the four workflow prompts. Both protocol eras are served. The architecture rules themselves stay with spec-guard's server.

### `init`

Configures the family to agree. It prints the plan, merges into files that exist, keeping what is there, and changes nothing without `--write`:

- **spec-brief**: `spec-brief init` when there is no configuration, then this package's plugin in its `plugins`, `"@descent-vtt/spec-harness/spec-brief-plugin"`, and the base below as its `archiving.base` unless one is set. spec-brief's archive asks the plugin whether a signed ruling allows a protected file, and refuses the file without it; and without a base it checks no protected file at all, warning only that the scope went unmeasured, so a plain `spec-brief archive` is a gate only once one is named.
- **spec-graph**, when it is installed: the archive in its `historyPatterns`, so an archived brief is a record whatever its status says, and a live brief that depends on one is not a stale premise. That holds only where spec-graph reads the briefs, and its default patterns (`docs/`, `doc/`, `adr/`, `rfcs/`, `specs/` and Markdown at the root) do not reach `briefs/`: `init` says whether they do, and leaves adding the briefs to `patterns` to you, since that changes what spec-graph checks, and its `patterns` replace its defaults. It merges into the configuration spec-graph reads, and leaves a `"spec-graph"` key in `package.json` to you.
- **`.spec-harness.json`**, naming the base rounds are measured from and the allowed signers are read on: the remote's default branch where git recorded one, as a clone does and git 2.48 or later does on a fetch; otherwise the branch `init` runs on when it is `main` or `master`, or the only branch, since a repository made with `git init` and pushed to a remote often records no default. When it cannot tell, it says so and writes none: set `"base"` yourself.
- **Claude Code**: the guard hooks in `.claude/settings.json` and the MCP server in `.mcp.json`, each run with `node` from the project's `node_modules`. These are the ones the [plugin](#as-a-claude-code-plugin) brings, so while the plugin is on - `"spec-harness@<marketplace>": true` under `enabledPlugins` in your user, project or local Claude Code settings - `init` writes neither and says why (`skip`). To have its entries instead, which every clone reads, turn the plugin off for the project, `claude plugin disable spec-harness@spec-tools --scope local`, and run `init` again. It removes nothing: where the plugin is on and a file already holds its entry, it says so (`advise`) and leaves the file alone. The `npx` entries 0.1 wrote are replaced.
- **git's pre-commit hook**, where git runs it from: `core.hooksPath`, relative, absolute or under `~`, and the shared hooks of a linked worktree. It refuses a commit that changes what the active brief protects, for any agent or none, a shell's writes included. With `--git-hook` it is written; without, the plan advises it (`advise`). A hook that exists is never replaced: `init` says to add the line to it.
- **The allowed-signers file** `rulings.allowedSigners` names, `.github/allowed_signers` by default: one line per person, and a FIDO2 key, `ssh-keygen -t ed25519-sk`, for anyone whose agent runs as them (`advise`). With it, how the forge keeps it, the ADRs, the tool configurations and the CI configuration from changing unread, as [spec-core's ADR-0005](https://github.com/DescentVTT/spec-core/blob/main/docs/adr/0005-the-family-contract.md) asks: CODEOWNERS and a protected branch on GitHub, Code Owners on GitLab Premium, and on GitLab Free, which has no Code Owners approval, a protected branch no one pushes to, merged by Maintainers, with agents as Developers and pipelines that must succeed. [spec-core's adopting guide](https://github.com/DescentVTT/spec-core/blob/main/docs/adopting.md) has the settings.

### `doctor`

The first thing to run when a hook refuses something unexpectedly. It reports:

- Which sibling tools are installed, at which versions, and how each is run; the repository root, the branch, and the brief the flag, `SPEC_BRIEF` or the branch names. A sibling older than this release needs is `outdated`, with the minimum and the command that installs a newer one, and exit 1. A command named under `tools` is run as named, and its version is not checked.
- What a signed ruling needs to count: the base, and whether `--base`, `.spec-harness.json` or the remote named it; whether the allowed-signers file is on that base; and whether spec-brief loads this package's plugin, by name or by a path to its file.
- A note naming each signer in the allowed-signers file whose key is not a FIDO2 key (`sk-ssh-ed25519@openssh.com` or `sk-ecdsa-sha2-nistp256@openssh.com`). A note, never a failure: [ADR-0006](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0006-a-ruling-is-a-signed-commit.md) also accepts a key the agent's account cannot read, and a PIV or PKCS#11 hardware key reads as a plain `ssh-rsa` or `ecdsa` line. A `cert-authority` line is a certificate authority's key, not a person's, and is left out.
- How Claude Code runs the guard: the plugin, with the settings file that turns it on; `init`'s hooks and server; both, which guards every write twice and exits 1, with how to keep one; or neither.
- When Claude Code runs the guard, which Claude Code: `claude --version`, found on `PATH` and run without a shell. Older than 2.1.139 exits 1. An older release ignores a hook's `args` and runs a bare `node`, which reads the hook's input as a script and fails, and a PreToolUse hook that fails with anything but exit 2 blocks nothing: every write passes unguarded. A `claude` that is not found, a Windows `claude.cmd` shim, which cannot be run without a shell, and a version that cannot be read are *cannot tell*, never fine; `--strict` fails them. The Claude Code in an editor or the desktop app may be another release than the one on `PATH`: check it there with `claude --version` or `/status`.
- Whether git's pre-commit hook runs spec-harness, where git runs it from: installed, missing, a hook of the repository's own without the line, or, outside Windows, one git skips because it is not executable.

## As a Claude Code plugin

The repository is a plugin and a one-plugin marketplace: the four skills (`draft-brief`, `split-goal`, `run-round`, `close-round`), the hooks and the MCP server. The hooks and the server run the `spec-harness` installed in your project, `node ${CLAUDE_PROJECT_DIR}/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js`, so install it there first; the server is told the project with `--root`, since Claude Code starts a plugin's server in the plugin's own directory. It needs Claude Code 2.1.139 or later.

```text
/plugin marketplace add DescentVTT/spec-harness
/plugin install spec-harness@spec-tools
```

The plugin's hooks and server are the ones `init` writes into `.claude/settings.json` and `.mcp.json`: use one or the other. With both, every write is guarded twice and the server is registered twice. `init` run while the plugin is on writes neither. The other order, `init` first and the plugin after, nothing prevents: Claude Code runs a plugin's hooks as the plugin ships them, and a plugin hook that stood down because it believed `init`'s ran could leave no guard at all - Claude Code reads no hooks from `.claude/settings.json` in a session that spans several repositories, and managed settings can turn off the settings' hooks while those of a plugin they force on keep running ([ADR-0012](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0012-one-way-into-claude-code.md)). So after installing the plugin where `init` has run, run `npx spec-harness doctor`: a double install exits 1. Then take the `spec-harness` entries out of those two files, or turn the plugin off for the project.

## Configuration

`.spec-harness.json` at the repository root. Every key is optional; an unknown key stops the run with exit 2.

| Key | Default | What it says |
| --- | --- | --- |
| `branches` | `brief/{id}`, `brief-{id}`, `*/brief/{id}`, `*/brief-{id}` | Branch names that carry the active brief's id. |
| `outOfScope` | `"warn"` | A write outside `affectedFiles`: `warn`, `ask` or `deny`. |
| `base` | the remote's default branch | What rounds are measured from, and where allowed signers are read. `init` names it, since a repository git did not clone may have no default branch recorded. |
| `rulings.section` | `"Rulings"` | The brief section holding the rulings table. |
| `rulings.allowedSigners` | `".github/allowed_signers"` | The allowed-signers file, read from the base branch. |
| `dependencies.manifests` | the list above | Manifest names whose added dependencies the audit reports. A name that cannot be read is a warning in the audit. |
| `context.budget` | `60000` | Characters a context packet may hold; cited documents fill what the rest leaves, and those that do not fit are named by path. |
| `assertions.premises` | `The Defect, Measured`, `Premises`, `Preconditions` | Sections whose assertions state what was true before the round. |
| `probes.runs`, `probes.timeout` | `2`, `600` | Runs per probe, and seconds per run. |
| `tools` | found in `node_modules` | A sibling's command by name: `{ "spec-brief": ["node", "path/to/spec-brief.js"] }`. |

**Exit codes:** `0` clean, `1` refused, found something, or waiting on a person, `2` the answer cannot be trusted. A `probe` interrupted while it runs exits as a shell reports a process the signal ended: `130` on SIGINT (Ctrl+C), `143` on SIGTERM, `129` on SIGHUP.

## Design

The decisions and what they cost are in [`docs/adr/`](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/README.md); what the whole family shares is [spec-core's ADR-0005](https://github.com/DescentVTT/spec-core/blob/main/docs/adr/0005-the-family-contract.md).

## License

MIT
