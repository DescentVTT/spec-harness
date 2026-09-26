# Changelog

## 0.1.5

A packaging fix: the tarball no longer carries spec-core's internal README.
Nothing a command, hook or tool does has changed.

### Fixed

- **The package ships one README, its own.** `files` named `README.md`,
  which npm reads as a name at any depth, so the tarball carried spec-core's
  vendored README beside the licence it ships; the entry is `/README.md`.

## 0.1.4

spec-core at 8840d36. Its Markdown scanner now reads an image inside a
link's text, so a badge wrapped in a link gives two links, and makes the
parts of a scan a command may never ask for only when one asks. What the
commands print is unchanged: `context` includes the document a badge links
to, and never the badge.

### Changed

- spec-core at 8840d36. Its Markdown scanner reads an image inside a link's
  text, as CommonMark renders it, and lists it after the link it lies in:
  `[![build](badge.svg)](actions)` gives both, where the image went unread
  before. `context` takes the link around a badge as a document the brief
  cites and never the image, which is a picture on the page, not a document,
  and would otherwise show as a link that resolves to nothing.
- The scanner makes a document's links, list items and directives mask the
  first time they are read, and keeps them. The answers are the same.

## 0.1.3

spec-brief's archive is a gate from `init` onwards. 0.1.2's `init` named the
base in `.spec-harness.json` and left spec-brief's `archiving.base` at
`null`, and without a base spec-brief's archive checks no protected file: a
plain `spec-brief archive` warned that the scope went unmeasured and passed,
where `--base main` refused the file or waived it by a signed ruling. Found
by the end-to-end run of 0.1.2 from npm.

### Fixed

- `init` sets spec-brief's `archiving.base` to the base it names, beside the
  plugin, and keeps a base a person wrote. Running it again on a 0.1.2 setup
  adds the base.
- `list_rounds` leaves the id off each brief's structured `title`, as its
  text already did.
- `doctor` and `init` spell the allowed-signers line the same way.

## 0.1.2

A signed ruling now works from `init` onwards. An end-to-end check of 0.1.1
from npm, in a repository made with `git init`, could not finish the round
the README describes: `init` named no base and did not load the spec-brief
plugin, so no ruling verified, and spec-brief's archive refused the file a
person had allowed. After upgrading, run `npx spec-harness init --write`
again: it adds what is missing and replaces the `npx` hooks and server 0.1
wrote.

### Fixed

- `init` loads this package's plugin in spec-brief's configuration,
  `"plugins": ["@descent-vtt/spec-harness/spec-brief-plugin"]`, in whichever
  file spec-brief reads. Without it, spec-brief's archive, and so `audit`,
  refused a protected file whatever ruling was signed. `doctor` says whether
  spec-brief loads the plugin, and `audit` gives it as the reason for such a
  refusal, where it passed on spec-brief's "record the departure in the
  brief".
- `init` names the base in `.spec-harness.json`: the remote's default branch
  where git recorded one, otherwise `main`, `master` or the only branch when
  `init` runs on it; otherwise it asks. git records a remote's default
  branch when it clones, and before 2.48 not on a fetch, so a repository
  made with `git init` and pushed to a remote often has none. 0.1 wrote `{}`
  there, and no command could verify a ruling. It adds the base to a configuration that names
  none. `doctor` shows the base, where it came from, and whether the
  allowed-signers file is on it.
- `guard`, `context` and the hooks honour `--base`, which they ignored. The
  MCP tools `check_path` and `start_round` take a `base` argument, as
  `audit_round` does.
- The plugin's MCP server and hooks, and those `init` writes, run `node`
  with `${CLAUDE_PROJECT_DIR}/node_modules/@descent-vtt/spec-harness/bin/spec-harness.js`.
  Claude Code starts a plugin's server in the plugin's directory, where
  `npx --no-install spec-harness` found no spec-harness, and on Windows
  starts a server without a shell, where `npx` cannot start at all. The
  server is told the project with `--root`, and reads `CLAUDE_PROJECT_DIR`
  when no root is named. Use the plugin or `init`'s hooks and server, not
  both.
- `context` says spec-guard holds no rule when no spec file matches its
  patterns, rather than that it could not read its specs, and passes on what
  spec-guard said when it could not.
- `premises` reports the premise of the brief a round works on as
  `premise-retired`, a note, as `audit` does, and no longer fails on the
  round's own branch.
- `init` says whether spec-graph's patterns reach the briefs, which its
  defaults do not in `briefs/`, and merges into the configuration spec-graph
  reads rather than shadowing `spec-graph.config.json` or a `"spec-graph"`
  key in `package.json`.
- A title written with an em dash after the id, as `spec-brief new` writes
  it, no longer repeats the id in `list_rounds` and `context`.
- The README's links to the ADRs work in `node_modules` and on npmjs.com.

### Changed

- The programmatic API exports `GUARD_HOOK`, the guard as a Claude Code
  hook, in place of `HOOK_COMMAND`, and `mcpServer`, `PROJECT_DIR` and
  `PROJECT_DIR_OR_HERE` for the server.

## 0.1.1

The same code as 0.1.0, built by CI from its tag and published with a
provenance attestation. 0.1.0 was published from a workstation by mistake, an
`npm publish` run in a checkout, so it has none; it is deprecated in favour
of this one, and nothing else changed between them.

- `npm publish` in a checkout now refuses to run outside GitHub Actions.
  CI never runs it: it stages a tarball it packed, with scripts off.

## 0.1.0

The first release of spec-harness, the agent-facing member of the spec-*
tools: what an agent needs to start a round of work under a brief a person
approved, a guard on every write, escalations a person rules on and signs, an
audit when the round ends, and probes that prove a defect before it is filed.
It calls no model and has no runtime dependencies. It needs spec-brief 0.2.0
or later, and uses spec-guard 0.12.0 and spec-graph 0.9.0 or later when they
are installed; an older one is reported with its minimum and never run.

This version was staged on npm by CI from its tag, with provenance, and
released by a maintainer with a second factor. 0.0.0 on npm is a placeholder
without code, published by hand to claim the name, and is deprecated
([ADR-0011](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0011-releases-are-staged-by-ci.md)).

### Added

- `context`: the brief in full, its scope as the guard reads it, signed
  rulings, dependencies, the rules spec-guard holds the scope to, and the
  documents the brief cites, within a budget.
- `guard` and `hook claude` / `hook git`: protected files refused unless a
  signed ruling allows them, writes outside the scope warned, asked about or
  refused; paths compared as the filesystem spells them.
- `escalate`, `rule`, `rulings`: requests kept outside the work tree; a ruling
  is a row in the brief that counts when the commit that last changed it is
  signed by a key the base branch's allowed signers list.
- `audit`: what spec-brief's archive would say, the brief's goals and
  premises through spec-guard, unverified rulings, and dependencies added.
- `probe`: a brief's declared probes run in temporary worktrees, red at the
  base for the declared reason and green at the head.
- `premises`: every live brief's premises run through spec-guard, and one
  that no longer holds reported as `stale-premise`, exit 1, for CI.
- `init`: the family configured to agree; a plan until `--write`.
- `doctor`: which siblings are installed, at which versions, and which brief
  is named. The minimums are `peerDependencies` too: spec-brief required,
  spec-graph and spec-guard optional.
- `mcp`: start_round, check_path, request_escalation, audit_round and
  list_rounds, with the workflow prompts, over both MCP protocol eras.
- Skills for Claude Code and other Agent Skills readers: draft-brief,
  split-goal, run-round, close-round; the repository is also a Claude Code
  plugin marketplace.
- spec-core at cbe2223, vendored with its licence, which the package ships.
  A scope that writes `**` inside a name (`docs/**.md`) is refused with the
  two ways to say what was meant, as spec-brief and spec-guard refuse it.
