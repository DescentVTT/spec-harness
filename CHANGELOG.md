# Changelog

spec-harness is before 1.0, and its version says what an upgrade can do to a
run: a minor release (0.6.x to 0.7.0) may turn a passing run red or change
what a script reads - a finding on by default that was not, a changed exit
code, a flag, key or field renamed or removed, each deprecated with a warning
for a minor release first - and brings new features, while a patch release
only fixes, reports less or documents, so `^0.7.0` takes only releases that
cannot turn a run red. The family's policy is
[spec-core's ADR-0009](https://github.com/DescentVTT/spec-core/blob/main/docs/adr/0009-versions-before-1-0.md).

## Unreleased

### Added

- `audit` and `premises` take `--format gitlab`, `sarif` and `github`: a
  GitLab Code Quality report, SARIF 2.1.0, or GitHub workflow commands, each
  finding with its hint, on its file and line, or on the brief and line 1.
  An error is `major` in GitLab, a warning `minor`, a note `info`. The
  fingerprint is made of the rule, the file and the finding's subject, never
  its message or line, so a reworded message or a moved line is not a new
  finding in a merge request. Every other command refuses the three, exit 2.
  See [ADR-0005](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0005-a-guard-is-a-guardrail.md)'s
  second amendment of 2026-09-30.
- `audit` says what it measured beside what it found, so nothing found can
  be told from nothing checked: a line above the counts, which stay the last
  line, such as `measured: goals: 2 held, 0 failed · premises: 1 retired, 0
  holding · archive: asked · rulings: none · dependencies: 3 changed, 0
  unread`, and `measured` beside `counts` in `--format json` and in
  `audit_round`'s result. A brief with no assertion says `goals: none
  declared`, and draws no warning. `audit_round` answers "The audit found
  nothing in what it measured." and the line, where it said "The audit found
  nothing." The fields are added, so no `schemaVersion` moves.
- Each finding in `--format json` carries its `subject`: the assertion, the
  ruling, the dependency or the name it is about.
- `doctor` notes each signer in the allowed-signers file whose key is not a
  FIDO2 key, and each line that is not a signer. A note, never a failure: a
  key the agent's account cannot read is fine too, and a PIV or PKCS#11
  hardware key reads as a plain one. A `cert-authority` line is left out.
- `doctor` says whether git's pre-commit hook runs spec-harness, where git
  runs it from, and `init` advises the hook when `--git-hook` is not given:
  it is the guard for a write through a shell, which the agent's hooks never
  see.
- `doctor --format json` gains `branchSource`, `allowedSigners.notFido2` and
  `allowedSigners.problems`, `claudeCode.release` and `gitHook`, fields
  added, so no `schemaVersion` moves.
- The README says how a .NET or other non-Node repository installs the
  tools, how to merge a round so its signed rulings still count on GitHub and
  GitLab, how to add the plugin's marketplace from a GitLab mirror, and that
  spec-harness needs git 2.31 or later, which it has since 0.1.

### Changed

- `audit` reports an assertion in the brief that spec-guard cannot read as
  `assertion-unreadable`, a warning on its line with spec-guard's reason. It
  was dropped, and the audit passed on assertions it never ran. It fails
  `audit --strict`. Upgrading: fix the directive spec-guard names.
- `premises` reports a premise spec-guard cannot read as the same
  `assertion-unreadable` warning, where it was dropped and the brief passed
  unchecked, and `premises --strict` now fails on it, as `audit --strict`
  does. The summary line counts it, and `--format json` gains `unreadable`.
  Without `--strict`, only a stale premise fails the run, as before.
  Upgrading: fix the directive, or run `premises` without `--strict`.
- `audit` warns about a name in `dependencies.manifests` a leading `/`
  roots, alone or on a brace alternative, such as `/package.json` or
  `{/Gemfile,Cargo.toml}`, as `manifest-name-rooted`: every path it reads is
  repository-relative, so the rooted part named no manifest, in silence. It
  fails `audit --strict`. Upgrading: write the name without the slash; a
  name is matched at any depth.
- `doctor` runs `claude --version` when the plugin or `init`'s hooks wire
  Claude Code to the guard, and exits 1 when it is older than 2.1.139: an
  older Claude Code runs every write unguarded. One it cannot find or read,
  or a Windows `claude.cmd` it cannot start without a shell, is said to be
  unknown, never fine, and fails `doctor --strict`. See
  [ADR-0012](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0012-one-way-into-claude-code.md)'s
  amendment. Upgrading: update Claude Code, `claude update`.

### Fixed

- On a detached HEAD, as CI checks out, the branch is the one the forge's CI
  names: `GITHUB_HEAD_REF`, `GITHUB_REF_NAME` on a branch push,
  `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, then `CI_COMMIT_BRANCH`. A round's
  own CI run named no brief, and `premises` failed it for the premise the
  round retires. A branch checked out still wins. See
  [ADR-0004](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0004-the-active-brief-is-named-not-guessed.md)'s
  amendment.
- `context` and `start_round` keep the rules over the rest of the scope when
  a pattern in `affectedFiles` is rooted, such as `/docs` or
  `{/docs,src/**}`: spec-guard was asked about `/docs` and refused the whole
  question. The packet marks such a pattern as putting no path in the scope,
  and says so when no pattern puts one.
- `init --git-hook` writes the hook where git runs it from: an absolute
  `core.hooksPath`, or one under `~`, was joined to the work tree.
- `init` names the allowed-signers file `rulings.allowedSigners` names,
  where it named `.github/allowed_signers`, with a FIDO2 key, and says how
  each forge protects the rule files, GitLab Free included, where it said
  CODEOWNERS alone.
- `doctor`, `audit` and `init` read a spec-brief plugin loaded by a path to
  this package's plugin file as the plugin, where they said spec-brief did
  not load it and `init` added it a second time.
- The error for a `tools` command that is not a list suggests `["node",
  "node_modules/@descent-vtt/<tool>/bin/<tool>.js"]`, which runs on every
  host, where it suggested `npx`, which Windows cannot start without a shell.
- The title of a brief loses its id before a full-width colon, and before an
  em or en dash or a colon without spaces, as spec-brief reads it; a hyphen
  still needs a space on each side, so `001-2 migration` is kept.

## 0.6.0

The context packet names a protection or a ruling's path the guard cannot
read, with what that costs - every write refused, or nothing allowed - and
spec-core is at 7e41240, which reads a leading `/` on a brace alternative as
it reads one on a pattern alone. `context --format json` and `start_round`
gain `unreadableProtections` and `unreadableRulingPaths`.

### Changed

- spec-core at 7e41240. Its glob reads a leading `/` on a brace
  alternative as it reads one on a pattern written alone, where the slash
  was dropped: `{/docs,src/**}` is `/docs` or `src/**`, where it was `docs`
  or `src/**`. `/docs` is rooted at the filesystem's root, and every path
  the guard decides is repository-relative, so it matches none of them:
  - In a brief's `affectedFiles`, `{/docs,src/**}` no longer puts
    `docs/a.md` in the scope: the guard answers `out-of-scope` where it
    answered `in-scope`, as it does for `/docs` written alone. `src/a.ts`
    is in the scope as before.
  - In `protectedFiles`, `{/docs,migrations/**}` no longer protects
    `docs/a.md`, and in a ruling's paths `{/src/db/schema.ts,x}` no longer
    allows `src/db/schema.ts`, as `/docs` and `/src/db/schema.ts` alone
    protect and allow nothing. The guard can read each, so the packet lists
    it as written, as it lists `/docs`, with no note.
  - `context` and `start_round` ask spec-guard about `/docs`, or about `/`
    when the repository holds no `docs`, where they asked about `docs`, as
    they do for `/docs` written alone. spec-guard refuses a path outside the
    repository, so the packet says the rules could not be read, with what
    spec-guard said, and to treat every ADR as binding.
  - In `dependencies.manifests`, `{/package.json,Gemfile}` no longer names
    `package.json` at any depth, and names no file the round changed, as
    `/package.json` alone names none. `Gemfile` is read as before, and no
    warning names the name, since it can be read.
  - In spec-graph's `patterns`, `{/briefs/**/*.md,docs/**/*.md}` no longer
    reaches `briefs/`, and `init` says spec-graph does not read the briefs
    there, as it says for `/briefs/**/*.md`.
  - A slash after a segment, or before the braces, reads as before:
    `a/{/b,c}` is `a/b` or `a/c`, `/{docs,src}` roots both, and
    `{docs,src}` is `docs` or `src`.

### Fixed

- `context` and `start_round` name a pattern in `protectedFiles` the guard
  cannot read - malformed, too large to compile, or naming no path, such as
  `{./,src}` - where the protections are listed: it is marked with
  spec-core's reason, the one the guard gives in `because` when it refuses a
  write for it, and with what it does: until it is fixed, the guard refuses
  every write but to the brief, as `unreadable-protection`, which no ruling
  waives. It was listed as written, so the agent learned why every write was
  refused only from the first refusal.
- A path of a signed ruling the guard cannot read is marked the same way
  where the ruling is listed, as allowing nothing: the guard passes over it.
  It was listed among the paths the ruling allows. The ruling's paths the
  guard reads are listed as before, as is a readable protection.
- `context --format json` and `start_round`'s structured result list such
  patterns as `unreadableProtections`, each with its `pattern` and
  `reason`, and `unreadableRulingPaths`, each with its `ruling` as well,
  fields added beside `unreadableScope`, so no `schemaVersion` moves; in the
  programmatic API a context packet carries both, each entry of the second
  an `UnreadableRulingPath`. The reasoning is in
  [ADR-0001](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0001-the-harness-decides-the-agent-writes.md)'s
  third amendment of 2026-09-29.

## 0.5.0

The context packet names a scope pattern the guard cannot read, with
spec-core's reason, and a scope none of whose patterns can be read is said to
be unread, not to be ruled by nothing. `context --format json` and
`start_round` gain `unreadableScope`.

### Fixed

- `context` and `start_round` name a pattern in `affectedFiles` the guard
  cannot read - malformed, too large to compile, or naming no path, such as
  `{./,src}` - where the scope is listed: it is marked with spec-core's
  reason, the one the guard gives in `because` when it passes over it, and
  as putting no path in the scope. It was listed as written among the files
  the round may write, with no note. When no pattern in `affectedFiles` can
  be read, the rules section says the scope could not be read and to treat
  every ADR as binding until it is fixed, where it said "spec-guard holds no
  rule over this scope": spec-guard was asked about no path. A readable
  pattern is listed as before. `context --format json` and `start_round`'s
  structured result list such patterns as `unreadableScope`, each with its
  `pattern` and `reason`, a field added beside `unclosedFrontMatter`, so no
  `schemaVersion` moves; in the programmatic API a context packet carries
  it as well, each entry an `UnreadablePattern`. The reasoning is in
  [ADR-0001](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0001-the-harness-decides-the-agent-writes.md)'s
  amendment.

## 0.4.0

The audit names a `dependencies.manifests` name it cannot read, with
spec-core's reason, where it dropped the name in silence; `context` asks
spec-guard about a plain name in the scope as it is on disk; and spec-core is
at 56c7e54, which refuses a brace alternative that names no path, such as
`{./,src}`, where it read as every path.

### Added

- `readManifestNames` in the programmatic API: the configured manifest
  names read, a predicate over the paths they name and the names that could
  not be read, each with spec-core's reason. `AuditInput.dependencies` takes
  those as `unreadNames`, optional. `manifestMatcher` is unchanged.

### Changed

- spec-core at 56c7e54. Its glob refuses braces that expand to a text
  naming no path, as it refuses that text written alone. `{./,src}`,
  `{src,./}`, `.{/,src}` and `{.,src}/` read `./` as the root's contents and
  matched every path; each is now a pattern that cannot be read, with
  spec-core's reason, `the braces expand to "./", which names no path`:
  - In a brief's `protectedFiles` it protected every path: the guard refused
    every write as `protected`, and a ruling over the path waived it. The
    guard now refuses every write as `unreadable-protection`, naming the
    pattern and the reason, which no ruling waives.
  - In `affectedFiles` it put every path in the scope. It is now named
    among the patterns that could not be read, and the rest of the scope
    still counts. `context` and `start_round` no longer ask spec-guard about
    the whole repository for it, so the packet no longer holds rules over
    code the rest of the scope leaves out.
  - In a ruling's paths it allowed every protected path; it is passed over,
    as a malformed path is.
  - In `dependencies.manifests` it made every file the round changed a
    manifest, each one no reader understands reported as `manifest-unread`.
    It is now the `manifest-name-unread` warning, with the reason.
  - In spec-graph's `patterns` it read the briefs; the list now reads
    nothing, and `init` says spec-graph does not read the briefs.
- `/./` and `/.//` are refused as `the pattern names no path`. They matched
  only paths from the filesystem's root, none of which the guard is given,
  so `protectedFiles: ["/./"]` protected nothing; it now refuses every write
  as `unreadable-protection`.
- A pattern refused before names what its braces expand to: `{.,src}` is
  `the braces expand to ".", which names no path`, `{/,src}` `"/"`, and
  `{,src}` and `{}` `the braces expand to an empty pattern`, where each was
  `the pattern names no path`. `src/{./,a}` reads as before, what `src`
  holds.

### Fixed

- A name in `dependencies.manifests` that spec-core's glob cannot read,
  malformed or too large to compile, is a finding in `audit` and
  `audit_round`: a warning, `manifest-name-unread`, on `.spec-harness.json`,
  with the name and spec-core's reason, such as `a "[" is never closed` or
  `the pattern compiles to more than 65536 states`, whether or not there is
  a base to measure from. It was passed over in silence, so every manifest
  it was meant to name went unmeasured. The other names are read as before,
  and the warning fails the audit only under `--strict`.
- `context` and `start_round` ask spec-guard for the rules over a name with
  no glob syntax in `affectedFiles` as it is on disk: `src`, a directory, is
  asked about as `src`, and `src/auth/a.ts`, a file, as that file. The
  directory holding the name was asked about, the whole repository for a
  name at the top, so the packet held rules over code outside the scope, one
  over `lib/` say, where `src/` asked about `src` alone. A name the round
  has yet to create is asked about through the directory that will hold it,
  as before, since it may become a directory. The guard's answer is
  unchanged.

## 0.3.1

spec-core at f9ce375. A trailing `/` on a brace alternative in a brief's
patterns means that directory's contents, and a pattern too large to compile
is refused as a pattern the guard cannot read, where it crashed the guard and
the hook refused every write.

### Changed

- spec-core at f9ce375. Its glob reads a trailing `/` on a brace
  alternative as it reads one written alone, as that directory's contents,
  where the slash was dropped and the alternative read as a literal:
  - In a brief's `affectedFiles` and `protectedFiles`, and in a ruling's
    paths, `{src/,docs/*.md}` is `src/` or `docs/*.md`. The guard allows or
    protects `src/deep/a.ts` as before, and no longer a path named `src`
    itself.
  - `context` and `start_round` ask spec-guard for the rules over `src` for
    such a scope, where they asked over the whole repository, so a rule that
    reaches only code outside the scope, one over `lib/` say, is no longer
    in the packet.
  - In `dependencies.manifests`, `{tools/,Gemfile}` names every file under
    `tools/` at the root, where it named a file called `tools` at any depth.

### Fixed

- A pattern that spec-core's glob compiles to more than 65536 states is a
  pattern that cannot be read, with spec-core's reason, `the pattern
  compiles to more than 65536 states`, where the command stopped with an
  uncaught `AutomatonTooLarge`. In a brief's `protectedFiles` the guard
  refuses every write as `unreadable-protection`, naming the pattern and the
  reason, as it does a malformed protection; the PreToolUse hook refused
  every write with "cannot check this write" and now gives that refusal and
  the fix. In `affectedFiles` the pattern is named among those that could
  not be read, and the rest of the scope still counts. A ruling's path, a
  name in `dependencies.manifests` and a pattern in spec-graph's
  configuration are passed over as a malformed one is: no path is ruled by
  it, no manifest is read by it, and `init` says spec-graph does not read
  the briefs.

## 0.3.0

An interrupted `probe` stops its commands before it removes their
worktrees, exits 129 on SIGHUP, and never prunes the repository's other
worktrees. `context` says when a cited document's front matter never
closes, and spec-core is at 65ef842, which reads link reference definitions
as CommonMark does. A `DocumentReader` written by hand for `buildContext`
adds one field.

### Changed

- spec-core at 65ef842. Its Markdown scanner reads link reference
  definitions as CommonMark does, and `context` includes the documents a
  brief cites by that reading:
  - A definition cannot interrupt a paragraph. `[r]: r.md` on the line under
    a paragraph's text, a block quote's lazy continuation line included, is
    that text, so `[r]` in the brief no longer cites `r.md`; a blank line
    above the definition has it read. A definition after a blank line or a
    heading, and one under such a definition, is read as before.
  - A label holds no unescaped bracket. `[[r]: r.md](z.md)` is a link to
    `z.md`, and cites it, where it was a definition and cited nothing. A
    label with an escaped bracket, `[a\]b]: x.md`, is now read.
  - A second bracket holding a bracket is no label, and the first is read
    as a shortcut: with `[r]` defined, `[r][a[b]c]` cites `r`'s destination,
    where it cited nothing.

### Fixed

- `context` says when a cited document's front matter opens on its first
  line and is never closed, where it showed the document as one without a
  status. spec-core's scanner reads such a block as no front matter, so the
  status its author wrote was never read. The packet now names the document
  under "Front matter opened on line 1 and never closed, so the status was
  not read; close the block with `---` on a line of its own", still includes
  it, and exits 0. `context --format json` and `start_round`'s structured
  result list such documents as `unclosedFrontMatter`, a field added beside
  `unresolved`, so no `schemaVersion` moves. In the programmatic API a
  cited document may carry `unclosedFrontMatter`, a context packet lists
  them, and a reader's `titleAndStatus` returns it: a reader written for
  `buildContext` by hand adds it. The reasoning is in
  [ADR-0001](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0001-the-harness-decides-the-agent-writes.md)'s
  amendment.
- An interrupted `probe` stops the commands it started before it removes
  their worktree. On Linux and macOS a probe's command runs in a process
  group of its own, so Ctrl+C never reached it: it ran on in a worktree
  removed from under it, and on Windows, where a running command holds its
  directory, the worktree could not be removed. On SIGINT, SIGTERM or SIGHUP,
  and when the process exits mid-probe, every running command is now stopped
  with everything it started, as its timeout stops it, and an interrupt waits
  up to three seconds for them to end before it removes the worktree. The
  reasoning is in
  [ADR-0003](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0003-state-outside-the-work-tree.md)'s
  amendment.
- A run ended by SIGHUP while it held a worktree, as when its terminal is
  closed, exits 129, as a shell reports a process SIGHUP ended, where it
  exited 143, SIGTERM's code. The code is 128 and the signal's number for
  each signal the sandbox handles: SIGINT 130 and SIGTERM 143, as before.
- An interrupted `probe` no longer prunes the repository's other
  worktrees. After removing its own worktree the sandbox ran `git worktree
  prune`, which forgets every worktree git has lost track of - one on a
  drive that is not mounted, or another tool's - and it did the same at the
  end of a probe whose command had deleted its worktree's `.git` file. It
  now deletes the worktree's directory and runs `git worktree remove
  --force` on that path, which forgets that worktree and no other. The
  reasoning is in
  [ADR-0003](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0003-state-outside-the-work-tree.md)'s
  amendment.

## 0.2.0

The Claude Code plugin and `init` no longer install the guard twice by
accident, and the Claude Code release the hooks need is stated: 2.1.139 or
later, the first that runs a hook's `args`. spec-core is at 119345e: a link
inside a link's text now counts only the inner link as a document the brief
cites.

### Changed

- spec-core at 119345e. Its Markdown scanner reads a link inside a link's
  text as CommonMark does: the inner link is the link, and the brackets
  around it and the destination after them are text. `context` now takes
  `[a [b](inner.md) c](outer.md)` as citing `inner.md` alone, where it
  included `outer.md` and never `inner.md`. A badge wrapped in a link still
  cites the link and never the image.
- A brief's pattern that writes `**` inside a name is still one the guard
  cannot read, and what it says of it now builds the advice from the pattern
  written: `docs/**.md` is told `docs/**/*.md` for any depth or `docs/*.md`
  for one level, and `src/a**` `src/a*/**` or `src/a*`, where every such
  pattern was told `docs/**/*.md` or `*.md`.
- `init` writes neither the guard hooks nor the server while Claude Code's
  spec-harness plugin is on. Claude Code runs a plugin's hooks beside the
  same hooks in settings, so with both every write was guarded twice and the
  server registered twice. `init` reads `enabledPlugins` from the user's, the
  project's and the local Claude Code settings as Claude Code merges them,
  plans `.claude/settings.json` and `.mcp.json` as `skip`, and says how to
  have its entries instead: `claude plugin disable spec-harness@spec-tools
  --scope local`, then `init` again. Where the plugin is on and a file
  already holds its entry, it says so and changes nothing.

### Added

- `doctor` says how Claude Code runs the guard - the plugin and the settings
  file that turns it on, `init`'s hooks and server, both, or neither - on a
  `claude` line, and as `claudeCode` in JSON. Both is a double install and
  exits 1, with how to keep one.
- The README and the plugin's manifest state the Claude Code release the
  hooks and the plugin's server need, 2.1.139 or later
  ([ADR-0012](https://github.com/DescentVTT/spec-harness/blob/main/docs/adr/0012-one-way-into-claude-code.md)).

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
