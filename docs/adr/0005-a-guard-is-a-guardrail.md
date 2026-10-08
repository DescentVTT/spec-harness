---
status: accepted
date: 2026-09-26
---

# ADR-0005: A guard is a guardrail; the audit and the archive are the gates

## Context

The plan intercepted an agent's writes by watching its output stream and
killing it on a violation. By the time a stream shows a write, the write has
happened. And an agent with a shell can write a file no tool-level hook sees.

## Decision

- **Before the write, in the agent's own hook.** `spec-harness hook claude`
  answers Claude Code's PreToolUse for Edit, Write, MultiEdit and
  NotebookEdit, reading the file from `file_path`, `path` or
  `notebook_path`. It refuses a protected file (`deny`, with the reason and
  the next step), may ask the person about a file outside the scope
  (`outOfScope: "ask"`), and otherwise says nothing. It never says `allow`:
  that would skip the person's own permission prompt.
- **After the write, a warning.** PostToolUse tells the model, as additional
  context, that it wrote outside the scope: informing, never unlocking.
- **At commit, for any agent or none.** `spec-harness hook git` is a
  pre-commit hook over the staged files.
- **Paths are compared as the filesystem spells them**: links resolved and,
  on a case-insensitive filesystem, the real case, so `SRC/db/schema.ts` does
  not walk past a protection on `src/db/schema.ts`.
- **The gates are elsewhere**: `audit` measures the whole round from its base,
  and spec-brief's `archive` refuses a round that changed a protected file.

*Amended 2026-09-30.* The audit says what it measured beside what it found.
spec-core's ADR-0005 holds that nothing measured is not clean, and the audit
reported only what failed. spec-guard lists an assertion it cannot read
apart from its results, as one of its `errors`; the audit read only the
results, so a brief whose assertions could not be read ran none of them and
passed. And a report with no finding could not be told from one that checked
nothing. Each assertion spec-guard cannot read is now `assertion-unreadable`,
a warning on its line with spec-guard's reason, which fails the audit under
`--strict` as every warning does. Beside the counts the audit reports
`measured`: whether the round's changes were measured from a base, whether
the archive answered and the assertions ran, the goals that held and
failed, the premises retired and still holding, the assertions that could
not be read, the rulings verified and not, and the dependencies changed and
the manifests that could not be read. A person reads it as one line above
the counts, which stay the last line, and `audit_round` says it too. A brief
that declares no assertion says `goals: none declared` and draws no warning:
a brief without assertions is a brief, the archive still measures its
round, and a warning on every such brief would be a false positive. The
field is added beside `counts`, so no `schemaVersion` moves.

*Amended 2026-09-30.* spec-core's ADR-0005 offers SARIF and GitHub
annotations where findings have places, and GitLab Code Quality as each tool
next touches its reporter. `audit` and `premises` take `--format gitlab`,
`sarif` and `github`; every other command prints pretty or json, and
refuses the three with exit 2, since its output has no places. The shapes
are the siblings'. An error is `major` in GitLab, a warning `minor` and a
note `info`, as in spec-brief, and each format carries the hint after the
message. A finding's fingerprint is the SHA-256 of its identity - the rule,
the file and its `subject`, the assertion, ruling, dependency or name it is
about - with a count for repeats, and never of its message or line, as in
spec-guard: GitLab compares fingerprints between a merge request and its
target, and a reworded message or a line added above would read as one
problem fixed and another found. A finding with no file is placed on the
brief, and one with no line on line 1. `subject` is a field of each finding
in `--format json` as well, added, so no `schemaVersion` moves.

*Amended 2026-09-30.* The guard at commit covers what the agent's hooks do
not, a write through a shell, and it was installed only when asked. init
now advises git's pre-commit hook when `--git-hook` is not given, and doctor
says whether it is installed. Both find it where git runs it from, as `git
rev-parse --path-format=absolute --git-path hooks/pre-commit` answers:
`core.hooksPath` relative to the work tree, absolute or under `~`, and the
shared hooks of a linked worktree. init joined `core.hooksPath` to the work
tree, which put the hook for an absolute or a `~` path where git never runs
it. No Bash hook looks for `--no-verify` or a shell's writes: every shell
command would pay for it, it is easy to get around, and the audit stays the
gate.

*Amended 2026-09-30.* `premises` reads spec-guard's errors as the audit now
does. A directive in a premise section that spec-guard cannot read was
dropped with the rest of its errors, so a brief whose premise nothing checks
passed for one whose premise holds, and CI said nothing. It is now
`assertion-unreadable`, the audit's warning, on its line with spec-guard's
reason, and `premises` fails on a warning under `--strict`, as the audit
does; without it, only a stale premise fails the run, as before. A directive
spec-guard cannot read outside the premise sections is a goal, the audit's
to report. The summary counts the premises that could not be read apart
from those checked, and `--format json` gains `unreadable`.

*Amended 2026-10-07.* The audit reports a package a round allowed to run
install scripts, as it reports a dependency a round added. npm 12 runs a
dependency's `preinstall`, `install` and `postinstall`, and `prepare` for one
that is not from a registry, only where the project's `package.json` allows
the package under `allowScripts`, where `npm install-scripts approve` and
`deny` write: a key that is a package, a package at exact versions joined by
`||`, or a git, file or tarball source, to `true` or `false`, a denial
winning over an approval. The audit read the four dependency sections alone,
so a round could add the one line that runs a dependency's code on every
contributor's machine and in CI, code that is in no diff, and the audit said
nothing. It now reads the field in each `package.json` that
`dependencies.manifests` names and the round changed, as npm reads it: an
entry is its key as written and `true` or `false`, any other value is no
entry, and a field that is not an object holds none. An approval the round
added, or turned from a denial, is `install-script-allowed`, a warning that
fails `--strict`, which no ruling covers, as `new-dependency` is. A denial
is `install-script-denied` and a removed entry
`install-script-entry-removed`, notes as `dependency-removed` is: a denial
and a removed approval stop a script, and a removed denial approves nothing
by itself. Where an approval of the same package stood beside the denial,
npm honours it again; npm's own commands never leave the two together, and
the note on the denial is what the audit says of it. A key is not parsed.
npm pins an approval to the version a person reviewed, so `canvas@3.2.0`
beside a removed `canvas@3.1.0` is a new approval and a removed entry, not
a version moved; and telling an exact version from the range or the
dist-tag npm passes over is npm's reading of a package spec, which the
audit does not copy. `--format json` lists the entries as `installScripts`
and counts them in `measured`, apart from the dependencies, and the line a
person reads says so only when a policy changed. Both are added, so no
`schemaVersion` moves.

What else grants the same, and is not read:

- **`.npmrc`.** npm takes `allow-scripts` from it when `package.json` has
  no entry, and `dangerously-allow-all-scripts` whenever it is set. It is not
  a manifest, and `dependencies.manifests` names none. The lockfile holds no
  approval.
- **pnpm.** pnpm 11 and 12 keep their approvals as `allowBuilds` in
  `pnpm-workspace.yaml`, where pnpm also writes a placeholder for each build
  it ignored, and read no setting from the `pnpm` field of `package.json`.
  That is YAML, a reader the harness does not have. The
  `pnpm.onlyBuiltDependencies` pnpm 10 read from `package.json` is an
  approval under that major and nothing under the two after it, so the
  manifest alone does not say whether an entry there grants anything.
- **Bun and Yarn.** Bun's `trustedDependencies` replaces a list built into
  Bun, and Yarn's `dependenciesMeta` allows a build only where
  `.yarnrc.yml` turns scripts off. What an entry of either grants is not in
  the manifest, and neither was run here.
- **The root package's own `preinstall`, `install`, `postinstall` and
  `prepare`.** They run on every install too. But they are the repository's
  commands, written in the round's diff for a reviewer to read, where an
  approval is one line that turns on code no diff holds. `prepare` is where
  a package builds, so it changes in ordinary rounds, and a script that runs
  `npm run build` changes what it runs without changing. A brief that must
  keep them protects `package.json`, which the guard and the archive hold.

*Amended 2026-10-08.* An error the harness did not expect is exit 2, from
the hook as from every command. `run` named the errors it expects (a usage
mistake, a configuration that does not load, a sibling missing or
unreadable) and threw any other again, and the launcher's
`process.exitCode = await cli.main()` left that to Node: the stack and exit
code 1. Exit 1 is "refused or found something" to a script, and to Claude Code a
PreToolUse hook that failed without blocking, so the write the guard could
not check went ahead (ADR-0012). Measured on 0.10.1 through the launcher,
with a stdout that throws: `--version`, `--help`, `doctor`, `guard`,
`escalate --list` and `init` each exited 1. Such an error is now
`spec-harness: unexpected error:` and the stack on stderr, so that a report
of it says where, nothing on stdout for it, and exit 2: the answer cannot be
trusted (spec-core's ADR-0005), and before a write the write waits, as it
does when the guard cannot read the briefs. After a write there is nothing
to hold, and the hook exits 2 all the same, as it did for an error it
expects. The launcher answers the same way an error nothing awaits - a
stream's, a timer's, a child process's - which never reaches `run`.

What the hook already answered its own way is as it was: a question that is
not JSON or names no event is exit 1, refusing nothing it cannot see, and
so is one that could not be read from its input at all, which has no event
to hold a write by; a
session outside a git work tree is exit 0; and a check before a write that
fails says `cannot check this write`, with exit 2. The server answers a
request that fails with an error for that request and serves the next. A
caller of `run` or `main` from the package gets 2 where it got a rejection.

*Amended again 2026-10-08.* An exit 2 the harness could foresee says so in a
line. The amendment above printed two things as `unexpected error:` with a
stack that are no defect of the harness's, and a stack sends a person looking
for one. Measured on 0.11.0 through the launcher (Windows 11, Node 24.18.1):

- **A reader that closed the output.** `spec-harness --help` into a reader
  that had already left printed `spec-harness: unexpected error: Error:
  EPIPE: broken pipe, write` and eight lines of stack, exit 2; so did
  `doctor`, `guard`, `escalate --list` and `init`, and the server at the
  first answer it could not write. It is now one line,
  `spec-harness: stdout was closed before all of the output was written`, in
  the words every tool of the family uses (spec-core's ADR-0005), and exit 2
  as before: the answer did not arrive. Every time, it arrived as the
  stream's `error` event, which nothing awaits, and never as an error thrown
  where `run` awaits: so the launcher answers it, and `run` answers in the
  same words where a write does throw it, as a caller's own stream may. It
  is told from every other error by its code, `EPIPE`: stdout and stderr are
  the only pipes the harness writes to. When stderr is the one that closed
  there is nowhere left to say anything: nothing is written, to stdout
  either, and the exit is 2. A write that fails for another reason, a full
  disk, keeps `unexpected error:` and its stack. A hook's answer before a
  write is as it was: a check that fails for any reason, this one included,
  says `cannot check this write`, exit 2, and the write waits.
- **A git command that failed.** `hook git` in a repository whose index git
  could not read printed `spec-harness: unexpected error: GitError: git diff
  --cached failed: fatal: .git/index: index file smaller than expected` and
  a stack. `GitError` is the harness's own error, with a message written
  for a person, and `run` now names it with the others it expects: the
  message alone, `spec-harness: git diff --cached failed: fatal: ...`, exit
  2. So for the diff `audit` reads and the worktree `probe` adds.

*Amended 2026-10-09.* An input that is set and names nothing is refused,
not read as if it had not been given (spec-core's ADR-0005, amended the same
day). The command line had one table of options for every command, and
nothing asked whether what the parser took named anything. Measured on
0.11.1 through the launcher, each of these ran as if the input were not
there, exit 0 unless said:

- **An option another command reads.** `doctor --note x`, `doctor --id ""`,
  `init --base nowhere`, `mcp --brief 999`, `hook git --strict`: every
  command took all eighteen options, and did nothing with those it does not
  read.
- **An argument no command asked for.** `doctor extra`, `init mydir`, which
  set up the directory it stood in, `premises extra`, `mcp extra`, and a
  second argument to `context`, `rulings`, `audit`, `probe` and `rule`.
- **An option given an empty value.** `--root ""` ran in the current
  directory; `--brief ""` was the branch's brief (ADR-0004); `audit --base
  ""` was an audit that measured no change, with a warning; `escalate`
  wrote the empty value into its memo (ADR-0006). `probe --id ""` and
  `escalate --show ""` were exit 2 in words that named no option.
- **An empty argument.** `guard src/a.ts ""` judged the empty path as the
  repository itself, and `context ""` was the branch's brief.

Each is now exit 2 and one line on stderr that names the input, shows what
it holds and says what to do, before the command reads or writes anything:

- A command has a shape: the options it reads and the arguments it takes
  (`src/usage.ts`, and the README's table). An option is a command's only
  where its answer depends on it. `init` chooses the base itself and the
  server is told the brief and the base by each call, so neither takes
  `--base` or `--brief`: taking one would tell someone the base or the
  brief had been set. An option a command does not read is refused by name,
  with those it does read, and an argument it does not take with what it
  takes.
- An option that takes a value refuses one that is empty or only space, by
  the option's name, the value shown as JSON, where a tab can be seen. No
  option gives emptiness a meaning, so there is no exception among them.
  `--format`, `--at` and `rule`'s `--note` were refused already, each in
  its own words, and keep them. An argument that names nothing is refused
  the same way.
- A `--root` that is a file, or is not there, was exit 2 already, in words
  that named a git work tree and not the option. It is refused by name.
- A `.spec-harness.json` that is a directory was refused in Node's words,
  `is not valid JSON: EISDIR`. It says `is a directory, not a configuration
  file`.
- `--help` and `--version` answer whatever else is on the line: asked for
  the help, a run answers nothing else that could be mistaken.
- The server answers a tool call that holds such an argument with a tool
  error that names it, `"brief" is "", which names no brief`, and serves
  the next: an empty `brief` or `base`, an empty place in `paths`, an empty
  `recommendation`, an option without a label (ADR-0006). It refused an
  argument a tool does not take, and one of the wrong type, already.

**`hook claude` is exempt, and reads its line as every release has.** The
line is in `.claude/settings.json` and in the plugin of every release since
0.1.0, which a later release cannot rewrite, and Claude Code holds a tool
call on a PreToolUse hook's exit 2: a refusal of something on that line
would hold every write of a session, the write that mends the line among
them, for the sake of an option that had done no harm. So whatever is on
its line beside `hook claude` is passed over as it was, an empty `--brief`
or `--root` included, and the hook keeps the answers the amendments above
give it: exit 1 for a question it cannot read, exit 0 outside a git work
tree, exit 2 for a brief that is named and is not one, and exit 2 for an
option no command has, which the parser refused before this. What the
releases wrote on that line is `hook claude` and nothing else (ADR-0012).

`hook git` is held to the rule. It stops one commit with a line a person
reads, who can then mend the hook, and the releases wrote `hook git` and
nothing after it. `doctor` is a diagnosis: it refuses what any command
refuses, but an empty `--brief` or `--base` it says in its report, as it
says a base that names no commit (ADR-0004).

Each refusal is input refused that was accepted, a minor release (spec-core's
ADR-0009). What was found and left as it was:

- `--base` naming no commit is said where it matters and stops nothing but
  `probe`: a warning in `audit`, a ruling not verified in `rulings` and the
  guard, a line of `doctor`'s report.
- `escalate --list` and `--show` pass over the options of a request given
  beside them, and `premises` reads a `--brief` spec-brief does not know as
  no round.
- A brief given as an argument and by `--brief` at once is the argument's.

## Consequences

An agent that writes through a shell passes the guard and is caught at the
audit and at the archive. The guard's job is to make an honest agent never
need them, cheaply.
