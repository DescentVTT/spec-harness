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

*Amended 2026-10-11.* A `--root` on the line of Claude Code's hook that is
not a directory is said, with exit 1, and refuses nothing. The amendment
above left `hook claude` out of every refusal, and the hook went on to open
its root as before. git starts in neither a file nor a directory that is not
there, and the hook read that as a session outside a git work tree, where it
has nothing to guard and says nothing. Measured on 0.12.0 through the
launcher (Windows 11, Node 24.18.1, git 2.55), before a write to a file the
brief protects: `hook claude --root <not there>`, `--root <a file>` and
`--root " "` each exited 0 with nothing on either stream, and so did each
after a write. A root that was written on the hook's line and is not there
is a guard that was set up and is off, and nothing told anyone.

It is now exit 1 and one line on stderr:

    spec-harness: --root is "nowhere", which is not a directory, so the guard is off and this write is not checked; give the hook's line a directory that exists, or leave --root out for the project Claude Code names

- **Exit 1, as for a question the hook cannot read.** Claude Code's hooks
  reference (<https://code.claude.com/docs/en/hooks>, *Other exit codes*,
  read 2026-10-11) has a hook that exits with a code other than 0 or 2, and
  prints plain text or nothing on stdout, as a non-blocking error, of which
  it says under *Exit code output*: "The action goes ahead". (This sentence
  first carried a paraphrase between quotation marks; the words are now the
  page's.) The transcript then shows a hook error with the first
  line of the hook's stderr, which is why the line is one line. Its table
  of what blocks gives a PreToolUse hook no blocking code but 2 and a
  PostToolUse hook none, so the write goes on and the person is told.
  Exit 0 would not tell them: the same page sends the stderr of a hook
  that exits 0 to the debug log alone. Exit 2 would hold every write of the
  session, the one that mends the line among them, which is why the hook is
  exempt in the first place.
- **Said where there is a write to check, before a write and after one.** A
  question that cannot be read or parsed is said first, as it was, and a
  tool that writes no file is answered with nothing, exit 0, as it was.
  Whatever else stands on the line, a brief that is not one included, the
  root is said and the exit is 1: no brief is read without a root, and
  `--root <not there> --brief 404` is no decision to hold a write.
- **Not an empty root, and not a directory that is no work tree.**
  `--root ""` is the directory the hook was started in: git starts there
  when it is handed no directory, and the hook has guarded there for one in
  every release (measured: the write is refused). It still does, and the
  hook now names that directory itself. A root that is a directory outside
  any work tree is a session outside one, exit 0 and no word, as before.
- **No line a release wrote meets it.** Read from the tags v0.1.0 to
  v0.12.0, the hook's line is `hook claude` and nothing after it in every
  release, in `.claude/settings.json` and in the plugin. `--root` stands
  only on the server's lines (ADR-0012), and
  `tests/integration/released-lines.test.ts` holds that no hook's line
  carries one. A root on that line is one a person wrote.

Three things the amendment of 2026-10-09 found and left are refused now,
each exit 2 and one line, by every command but `hook claude`, which passes
over them as it passes over the rest: an option beside `escalate --list` or
`--show` that neither reads (ADR-0006), a brief that `premises` is given and
spec-brief does not know, and a brief given as the argument and as `--brief`
at once (both ADR-0004). Each is input refused that was accepted, or an exit
code that changed: a minor release (spec-core's ADR-0009).

What was measured for this and left as it was:

- **The `cwd` of the hook's question.** The hook reads it: as the root, when
  neither `--root` nor `CLAUDE_PROJECT_DIR` names one, and as the directory
  a relative path is read from. Claude Code sets `CLAUDE_PROJECT_DIR` for
  every hook it runs, and with it a `cwd` that is not there changes
  nothing: the write is checked against the project, for an absolute path
  and for a relative one. Without the variable, a `cwd` that is not there is
  exit 0 and no word, and so is a `CLAUDE_PROJECT_DIR` that is not there.
  Neither is written on a line. The first arrives with every question, and
  a project that is gone takes the hook's script with it, so node has
  nothing to start and Claude Code reports that.
- **`doctor` and an installed hook's line.** `doctor` knows a hook as the
  harness's only where its command and arguments are exactly those `init`
  writes, or the line 0.1 wrote. A line with anything added by hand, a
  `--root` that is there as much as one that is not, is to `doctor` no guard
  at all: `neither the spec-harness plugin nor the hooks init writes, so
  Claude Code guards no write`. It reads no argument of a hook's line, so it
  has nowhere to say a root's problem, and is left alone.
- **`hook git` with nothing staged** asks which brief of nobody, and exits 0
  for a brief that is not one: a commit that stages nothing changes nothing
  to check.
- **The hook's other exits of 2** are what they were: a brief that is named
  and is not one, a check that could not be made, an error nothing
  expected, and a line the parser cannot read, such as an option no command
  has or `--root` with no value after it.

*Amended again 2026-10-11.* A line Claude Code's hook cannot read is said,
with exit 1, and holds no write. The amendment above left it among the
hook's exits of 2: the parser refuses a line before any command is known, so
`hook claude` was refused as every command is. Measured on 0.13.0 through
the launcher (Windows 11, Node 24.18.1, git 2.55), before a write to a file
the brief protects and after a write outside its scope, each of these was
exit 2, the parser's words on stderr, and the question never read:

- an option no command has, long or short, with a value or without:
  `--nope`, `--nope=value`, `-x`, and the same before `hook` or between
  `hook` and `claude`;
- an option left without its value: `--root` or `--brief` at the end of the
  line, as `--root $DIR` is in a shell where the variable is not set, and
  `--root --brief 001`, which node says in three lines;
- a value given to an option that takes none, `--strict=yes`;
- a `--format` that is none, or one of the three the hook has no use for,
  and an `--at` that is none: `--format xml`, `--format ""`, `--format
  gitlab`, `--at sideways`.

That is the line the amendment of 2026-10-09 exempted, in the same settings
file, holding the same writes, the one that mends it among them. Each is now
exit 1 and one line on stderr:

    spec-harness: the hook's line cannot be read (Option '--root <value>' argument missing), so the guard is off and this write is not checked; mend it in Claude Code's settings, where init writes "hook claude" and nothing after it

- **Exit 1, by Claude Code's hooks reference as it reads today.** The page
  (<https://code.claude.com/docs/en/hooks>, *Exit code output*, read
  2026-10-11) names a hook that exits with any code but 0 and 2 a
  non-blocking error, and says of one: "The action goes ahead". The table
  under the same heading has the notice in the transcript carry the first
  line of the hook's stderr where its stdout holds no JSON, so the parser's
  words are put on one line, between brackets, with what follows from them
  and what to do after. After a write there is nothing to hold either way:
  the page shows the stderr of a PostToolUse hook's exit 2 to the model,
  and the first line of that of its exit 1 to the person.
- **A hook entry can ask Claude Code to hold the write all the same.** The
  page documents `onFailure` on a hook's entry, read by Claude Code 2.1.295
  and later: set to `"block"`, a hook that fails, by an exit code other than
  0 and 2 among other ways, does what exit 2 does on its event. Neither
  `init` nor the plugin writes the field. Where a person has set it, the
  hook's exit 1 holds the write, for its line as for a question it cannot
  read, which is what the field asks for.
- **Said where a root that is not there is said.** A question that cannot
  be read or parsed is said first, a tool that writes no file is answered
  with nothing, exit 0, and then the line is said, before a write and after
  one. Whatever else stands on it, or names the brief, the exit is 1:
  `--brief 404 --nope`, and `--nope` under `SPEC_BRIEF=404`, name no round,
  since nothing is read from a line that cannot be read.
- **Whose line it is, where the parser gave no command.** The line is read
  a second time with nothing refused, by the same table of options, so that
  a value is not taken for the command it stands before: an option no
  command has is passed over, and one left without its value takes none.
  Only the command and the argument after it are read from that, and no
  value: `hook` and `claude`, as on a line that parsed. A line that does
  not say so is nobody's, and is exit 2 as it was: `hook` alone, `hook
  claud`, `hook --brief claude --nope`, where the word is the brief's
  value.
- **Exit 2 from the hook is for a write it could not check**, and for
  nothing on its own line that it cannot read: a configuration that does
  not load, briefs that cannot be read, an error nothing expected, and a
  brief that is named and is not one. The last may stand on the line,
  `--brief 404`. That line is read, and what it names is missing from the
  repository, as it is when `SPEC_BRIEF` or the branch names it (ADR-0004):
  it holds the write as it did.
- **`hook git` is left as it is.** Measured with a protected file staged:
  `hook git --nope`, `--root` with no value, `--format xml`, `--at
  sideways`, `--strict`, an argument after `git`, a `--root` that is empty
  or not there, and `--brief 404` are each exit 2 and one line that names
  the fault, three for the option that may have lost its value, and git
  stops the commit. A pre-commit hook stops one commit in front of the
  person who made it, who reads the line and mends the hook; nothing there
  waits on a write the hook itself would have to allow.
- **No line a release wrote meets it.** 0.13.0 wrote the lines 0.12.0 wrote
  (ADR-0012), `hook claude` and nothing after it, and
  `tests/integration/released-lines.test.ts` holds each of the five lines
  the releases hand the harness to the command, the argument and the root
  it is read as.

An exit code that changed is a minor release (spec-core's ADR-0009). What
was measured for this and left as it was:

- **`--help` and `--version` on the hook's line** answer as they do on every
  line, `-h` and `-v` too: the help or the version on stdout, exit 0, and no
  write checked. Claude Code takes that for a hook that succeeded, so
  nothing in the transcript says the guard is off. A person who asks the
  hook for its help at a terminal is answered the same way, and the harness
  cannot tell the two apart without waiting for a question that never comes
  at a terminal. No release wrote either on the line.
- **An option given twice** is read as its last value, which is the
  parser's reading for every command: `--root a --root b` is `b`, and
  `--brief 404 --brief 001` is brief 001.
- **A hook that is not named** on its line, `hook` alone or a word that is
  neither `claude` nor `git`, is exit 2 from a settings file as from a
  terminal.

*Amended 2026-10-12.* `doctor` reads the line of Claude Code's hook as the
hook reads it. The amendment of 2026-10-11 found that `doctor` knew a hook
as the harness's only where its command and arguments were exactly those
`init` writes, or the line 0.1 wrote, and left it. Measured on 0.14.0
through the launcher (Windows 11, Node 24.18.1, git 2.55), in a repository
with a brief that protects a file: each line written into
`.claude/settings.json` under both events, `doctor` run there, and the
hook handed the words Claude Code hands it for that line, before a write to
the protected file. "No guard" is `doctor`'s `neither the spec-harness
plugin nor the hooks init writes, so Claude Code guards no write`.

| What follows the harness's command | The hook, before the write | `doctor` on 0.14.0 | `doctor` now |
| --- | --- | --- | --- |
| `hook claude`, as 0.1.2 to 0.14.0 write it, and as 0.1 wrote it | refuses the write | init's entries, exit 0 | the same |
| `hook claude`, the script named without the placeholder, or today's line written for a shell | refuses the write | no guard, exit 0 | init's entries, exit 0 |
| `hook claude --root ${CLAUDE_PROJECT_DIR}` | refuses the write | no guard, exit 0 | init's entries; the line, and that it guards; exit 0 |
| `--brief 001`, `--base main`, `--strict --format json`, or an argument after `claude` | refuses the write | no guard, exit 0 | init's entries; the line, and that it guards; exit 0 |
| `--root ""` | refuses the write, from the directory it was started in | no guard, exit 0 | init's entries; the line, and that it guards; exit 0 |
| `--nope`, `--root` with no value, `--format xml` | exit 1, the line cannot be read, and the write goes on | no guard, exit 0 | the guard is off, in the hook's words; exit 1 |
| `--root` a file, or a directory that is not there, written out or under the placeholder | exit 1, not a directory, and the write goes on | no guard, exit 0 | the guard is off, in the hook's words; exit 1 |
| `--brief 404` | exit 2, and the write is held | no guard, exit 0 | init's entries; the line, and that it guards; exit 0 |
| `hook claude` with `"onFailure": "block"` on its entry | refuses the write | init's entries, exit 0 | the same, and a note on the field |
| a shell's line with `--root "${CLAUDE_PROJECT_DIR}"` after `hook claude` | refuses the write | no guard, exit 0 | cannot tell; exit 0, and 1 under `--strict` |
| the same script with `hook git` or `guard`, and another program's hook | not Claude Code's hook | no guard, exit 0 | the same |

It was the same in `.claude/settings.local.json` and in the user's
settings. So a line a person had added `--root ${CLAUDE_PROJECT_DIR}` to,
which guards, was reported as no guard at all; a line that turns the guard
off was reported in the same words, with exit 0; and beside the plugin
neither was the double install it is.

- **Known by its command and the words `hook claude`.** A hook's entry
  runs the harness where a word of its line is `spec-harness` or
  `spec-harness.js`, alone or at the end of a path: the script by any
  path, the name as `npx` is given it, the package's scoped name. What
  follows that word is the line the harness is handed. It is Claude Code's
  hook where the command line would take it for one: read by the parser
  every line is read by, `hook` its command and `claude` the argument
  after it, on a line that parsed and on one that did not, so an option
  before the two words, or between them, leaves it the hook's line here as
  it does when the hook is started. The same script under `hook git`,
  `guard` or `mcp` is another command's line, and is not reported.
- **Read by the hook's own code.** What the hook does with its line, as far
  as the line decides it, is three functions of `src/usage.ts`: a line the
  parser refused, a line that parsed and the root it gives, and the two
  behind the parser. `hook claude` itself now answers through the first
  two, where it held the same lines of code in the command line, and
  `doctor` reads a line it finds through the third. There is no second
  reading to drift from the first, and a test runs the hook on the words of
  a line and holds `doctor` to its answer: a write refused where `doctor`
  says the line guards, and the hook's own sentence, to the word, where it
  says the guard is off.
- **As a session started at the root hands it over.** Claude Code fills
  `${CLAUDE_PROJECT_DIR}` in a hook's command and arguments with the
  project root where the session started (its hooks reference,
  <https://code.claude.com/docs/en/hooks>, *Reference scripts by path*,
  read 2026-10-12), and `doctor` fills it with the root it runs in. An
  empty `--root` is the directory the hook is started in, which is there,
  and a relative one is read from the root. A session started in a
  subdirectory, or one that has changed directory, can hand the hook
  another path than `doctor` read; a line that names its root by the
  placeholder or by an absolute path is read the same from anywhere.
- **Guards, off, or cannot tell.** A line that guards and holds no more
  than a release wrote is reported with nothing to say of it, as it was. A
  line that guards with more on it is said as it is, with its root where it
  gives one, and fails nothing. A line the hook cannot read, and a root that
  is a file or is not there, are said in the hook's words for them, as a
  guard that is off, and `doctor` exits 1: a guard someone set up, which
  checks no write, is what a diagnosis is run to find.
- **A shell's line is read only as far as it can be.** A hook with no
  `args` is handed to a shell, which splits it, expands its variables and
  drops its quotes before the harness sees a word (the reference, *Exec
  form and shell form*). The line 0.1 wrote is such a line, and holds
  nothing a shell changes: it is split at its spaces and read. Where what
  follows the command holds a quote, a variable or anything else a shell
  rewrites, only the shell can say what the hook is handed, and `doctor`
  does not guess: the line is known as the guard, reported as *cannot
  tell*, never as fine, and `--strict` fails it, as it fails a Claude Code
  whose release cannot be told (ADR-0012). The decision was to say of every
  line what the hook would do with it; for these lines that would take a
  second reading of a shell's syntax, and the note says how to write the
  line so that it is read: with `args`, where each word reaches the hook
  as it stands.
- **`onFailure` is said in a note.** The reference has the field on a
  command hook's entry, `"continue"` by default, read by Claude Code
  2.1.295 and later, and says of `"block"`: "a failure does what exit code
  2 does on that event" (*Block the action when a hook fails*, read
  2026-10-12). Among the failures it lists are a hook that cannot start,
  one that reaches its timeout, and an exit code other than 0 and 2. So
  with the field set, the hook's exit 1 holds a write before it: for a
  question it cannot read, and for a line of its own that turns the guard
  off, which is then every write of the session, the one that mends the
  line among them. The note says which of the two the line is. It fails
  nothing: the field is a person's choice, and `doctor` exits 1 for the
  line that is off with it or without it. After a write there is nothing
  to hold either way.
- **`--format json` has each line** as `claudeCode.lines`: the file, the
  events, the line as written, its state, `onFailure`, and what is said of
  it. The field is added, so no `schemaVersion` moves.
- **No line a release wrote is read another way.** The hook's lines of
  0.1.0 to 0.14.0 are `hook claude` and nothing after it, and
  `tests/integration/released-lines.test.ts` holds `doctor` to reporting
  each as the guard with nothing more to say.

An exit code that can change for a tree that passed is a minor release
(spec-core's ADR-0009). What was measured for this and left as it was:

- **A `--brief` on the line that names no brief.** The hook holds every
  write for it, exit 2, and `doctor` says of the line that it guards: it
  reads the line, and asks spec-brief only about the brief it is given
  itself. The brief `doctor` reports is the one its own flag,
  `SPEC_BRIEF` or the branch names.
- **The plugin's own hooks.** `doctor` reads `enabledPlugins` and no line
  of the plugin's `hooks/hooks.json`, which is a release's file in a
  directory Claude Code keeps.
- **`init` knows only the lines it and 0.1 wrote.** Beside a hook written
  another way it adds its own, and the file then holds two lines that both
  guard, which `doctor` lists and does not count as the double install it
  is; beside the plugin, `init` reports `skip` for such a file where
  `doctor` exits 1 for the double install.
- **What else on an entry decides whether the hook runs**: its `matcher`,
  an `if`, `async`, the event it stands under, `disableAllHooks`. None
  is read. A line under PreToolUse alone, or PostToolUse alone, is named
  with its event.

*Amended again 2026-10-12.* `doctor` says a brief on the hook's line that is
not one, reads the event and the matcher of each entry, and `init` knows the
hook as `doctor` does. The amendment above measured four things and left
them. Measured again on 0.15.0 through the launcher (Windows 11, Node
24.18.1, git 2.55), in a repository with a brief that protects a file, with
spec-brief 0.8.0 and spec-guard 0.23.0 installed in it: each entry written
into `.claude/settings.json`, under both events with the matcher `init`
writes unless the row says otherwise, `doctor` and `init --write` run
there, and the hook handed the words Claude Code hands it for the line
before a write to the protected file.

| What the settings hold | The hook, before the write | `doctor` on 0.15.0 | `init --write` on 0.15.0 | `doctor` now | `init --write` now |
| --- | --- | --- | --- | --- | --- |
| `hook claude --brief 404`, or a brief spec-brief has archived | exit 2: the write is held, and every write after it | the line, and that it guards; exit 0 | adds its own line beside it | the line holds every write, in the hook's words for the name; exit 1 | `advise`, in the same words; writes nothing |
| `--root ${CLAUDE_PROJECT_DIR}`, `--brief 001`, the script named without the placeholder, today's line written for a shell | refuses the write | init's entries; exit 0 | adds its own line beside it, and both run for every write | the same | `keep`, with the line it left and why where doctor has something to say of it; writes nothing |
| `--root ${CLAUDE_PROJECT_DIR}`, with the plugin on | refuses the write | the double install; exit 1 | `skip`: the plugin brings the hooks, so init writes none | the same | `advise`: the double install |
| `--nope`, `--root nowhere` | exit 1, and the write goes on | the guard is off; exit 1 | adds its own line beside it | the same | `advise`, in doctor's words; writes nothing |
| init's line under `PostToolUse` alone | not asked before a write | init's entries, and no word of the event; exit 0 | adds its line under `PreToolUse` | the line is waited on before no write, so it is not the guard; exit 0 | the same as on 0.15.0 |
| init's line under the matcher `Bash` | not asked for a write | init's entries; exit 0 | `keep`: the guard hooks are installed | no guard, and the line said with its matcher; exit 0 | writes its hooks beside the line, and says which it left |
| the same, with the plugin on | not asked for a write | the double install; exit 1 | `advise`: the double install | the plugin alone is the guard, and the line said; exit 0 | `skip` |
| init's line under the matcher `Write\|Edit` | asked before a write by Edit or Write | init's entries; exit 0 | `keep` | guards a write by Edit and Write, and names MultiEdit and NotebookEdit as unchecked; exit 0 | `keep`, saying the same |
| init's line with `"async": true` on its entry | started, and not waited on | init's entries; exit 0 | `keep` | waited on before no write, so not the guard; exit 0 | writes its line under `PreToolUse` |
| init's line with an `if` on its entry | asked for the calls the rule matches | init's entries; exit 0 | `keep` | cannot tell which writes; exit 0, and 1 under `--strict` | `keep`, saying the same |

So `doctor` said that a line guards under which every write was held; one
settings file came to hold two lines that both run; `init` said it wrote no
hook, for the plugin's sake, into a file that held one; and a line Claude
Code never starts before a write was reported as the guard.

- **A brief on the line that is not one holds every write, and is said so.**
  The hook reads `--brief` from its line, asks spec-brief which brief the
  name is, and holds the write under a name spec-brief does not know or has
  archived, exit 2 (ADR-0004). `doctor` read the line and asked nothing.
  The hook's reading of its line now says which brief a line that guards
  names (`claudeHookLine`, `src/usage.ts`), and `doctor` asks spec-brief
  about that name as the hook does: in the work tree the line's root is in,
  through the functions the hook asks through. A name that is no brief is
  said in the words the hook holds the write with, `the flag names brief
  404, and spec-brief knows no such brief`, as a line that holds every
  write until it is mended, and `doctor` exits 1: the guard someone set up
  stops all work, which is what a diagnosis is run to find. The hook says
  its own sentence through the same function (`heldHookLine`), and a test
  runs the hook on the line and holds `doctor` to its words and to exit 2.
  An empty `--brief` is passed over by the hook, and so names nothing here.
- **An entry is read with its event and its matcher, by Claude Code's hooks
  reference as read on 2026-10-12** (<https://code.claude.com/docs/en/hooks>,
  *Hook lifecycle* and *Matcher patterns*). Of the two events the hook
  answers, the page has `PreToolUse` run before a tool call, where a hook
  can block it, and `PostToolUse` after a call that succeeded. A group's
  matcher is tested against the tool's name: left out, empty or `*` it
  matches every tool; made of letters, digits, `_`, `-`, spaces, `,` and
  `|` alone it is the names it lists, each matched exactly; and with any
  other character in it, it is a "JavaScript regular expression,
  unanchored", so `Edit.*` matches `NotebookEdit` as well. The tools a line
  is read for are the four the hook reads a file from, `Edit`, `Write`,
  `MultiEdit` and `NotebookEdit` (`src/hooks.ts`), which is the matcher
  every release wrote.
- **A line Claude Code waits on before no write is not the guard**,
  whatever the hook would do with it: under `PostToolUse` alone, or under a
  matcher that names none of the four tools. `doctor` says so, with what
  the line stands under, and a settings file whose only line is started
  for no write, before one or after, is not counted among `init`'s entries:
  alone it is no guard, as `doctor` then reports, and beside the plugin it
  doubles nothing. It fails nothing: no guard is a choice (ADR-0012). A
  line the hook cannot read is still said as off, wherever it stands: it
  fails after every write it is started for.
- **A line waited on before some of the four tools guards those**, and
  `doctor` names the rest, whose writes go unchecked, and the tools it is
  started after. It fails nothing: `Edit|Write` is the matcher the
  reference itself gives as its example, and a person may have chosen it.
- **A hook in the background refuses nothing.** The reference has an entry
  with `async` or `asyncRewake` set run in the background, where Claude
  Code does not wait for it and takes no decision from it (*Run hooks in
  the background*). Before a write such an entry is waited on for nothing,
  and is read so. After a write it still tells the model, on the next turn.
- **`if` is not read, and is said as cannot tell.** The reference has an
  entry with an `if` start only for the tool calls its rule matches, a rule
  written in the syntax of a permission rule, which is another page's and
  is not read here. So which writes such a line is asked on is *cannot
  tell*: never reported as fine, and a failure under `--strict`, as a line
  only a shell can read is. So is a matcher that is not text, or is no
  pattern, of which the reference says nothing.
- **A matcher that is a pattern is read within a budget.** A matcher is a
  line of a settings file, which arrives with a clone, and a pattern can be
  written that a test of four short names never finishes. Measured on Node
  24.18.1 against the four tools' names: `^((([A-Za-z]*)*)*)*$X`, three
  stars each around the last, took 208 ms, four took 4,047, and five ran
  for more than ten seconds and was stopped. Read as written, one such
  entry beside the hook's line and neither `doctor` nor `init` would come
  back, with no word. So a pattern is made and tested in a context of its
  own (`node:vm`), whose run takes a timeout where a test in the
  process's own context takes none, and is stopped after 100 ms. A
  reading that runs out its budget is *cannot tell*, as a matcher that is
  no pattern is: said with the matcher, never fine, a failure under
  `--strict`, and taken by `init` as a line that is started, beside which
  it writes none. The budget is of the clock, so a
  machine under load may answer *cannot tell* for a matcher an idle one
  reads. No matcher of a sane size comes near it: `Edit.*`,
  `^(Edit|Write)$`, `mcp__.*__write.*` and an alternation of 6,805
  characters each took half a millisecond at the median of 500 readings
  and under four at the slowest, on Node 22.16.0 as on 24.18.1, and 4.81
  at the slowest with the machine busy at a test run, so the budget is
  some two hundred times what a reading takes. An answer that comes back
  and says it cannot tell is better than one that does not come: a
  diagnosis that hangs says nothing of the guard at all, and a `--strict`
  run that fails on a loaded runner can be run again. A check of the
  pattern's shape would not do instead: groups in a row backtrack as
  nested ones do, ten of `(.*)*` taking 674 ms where four took 6. Two
  tests hold the budget with the pattern of five stars, each under a bound
  of its own around the reading, so that without the budget it fails after
  two seconds where it would otherwise not come back.
- **`init` knows the hook as `doctor` knows it.** It knew its own line and
  0.1's, by their exact command and arguments. It now asks the hook's own
  reading whose line an entry is, and reads the entry's event and matcher
  as above. Where the file holds a line of the hook it did not write, which
  Claude Code starts for a write, `init` writes no hook into the file: a
  second line would run beside the first, and a line under one event alone
  is the person's to complete. It says which line it left and why, in
  `doctor`'s words for the line: `keep` where the line guards, `advise`
  where it turns the guard off, holds every write, or is waited on before
  none. It rewrites no line but the one 0.1 wrote, so a line a person
  changed is as they left it, and its own line under one event alone it
  completes, as it did. A line that is started for no write is left too,
  and `init` writes its own, as `doctor` then advises. Beside the plugin, a line that is started
  is the double install, in the project's file or in one of the person's
  own, and `init` says so where it said it had written none (ADR-0012).
- **`--format json`** has `held` and `unstarted` among a line's states, and
  for each line `before` and `after`, the writing tools Claude Code waits
  on it before a write by and starts it after one by, `null` where that
  cannot be told, with what is said of the two as `cover`. The fields are
  added, so no `schemaVersion` moves.
- **No line a release wrote is read another way, and the hook answers no
  line differently.** Read from the tags v0.1.0 to v0.15.0, every release
  wrote the hook's line under both events with the matcher
  `Edit|Write|MultiEdit|NotebookEdit`, in `.claude/settings.json` and in
  the plugin, and nothing after `hook claude`.
  `tests/integration/released-lines.test.ts` holds `doctor` to reporting
  each as the guard, started before every write and after each, with
  nothing more to say, and holds the hook's answer for each line it had.

An exit code that can change for a tree, and what `init` writes, are a
minor release (spec-core's ADR-0009). What was measured for this and left
as it was:

- **The plugin's own `hooks/hooks.json`.** Read from the tags, the file
  holds the same line under the same matcher in every release, so nothing
  in it would change an answer. What `enabledPlugins` does not say is
  whether the plugin is on this machine at all. Claude Code's plugin
  loading reference (<https://code.claude.com/docs/en/plugins/loading>,
  *Enabled in project settings but not installed*, read 2026-10-12) has
  Claude Code not go and get a plugin a machine lacks where a project's
  `.claude/settings.json` alone turns it on, with two exceptions: a
  marketplace that gives the plugin's source as a relative path, and a
  seed directory that has the plugin already. The `/plugin` Errors tab
  then shows a message. A plugin that is not on the machine brings no
  hook to it: that follows, and is not the reference's sentence. So
  `doctor` there reports as the guard a plugin that guards nothing, and
  `init` skips. Telling it apart takes Claude Code's own
  records of what it installed, under its plugins directory, whose shape
  the reference gives only in part, and which could not be measured
  against a Claude Code here; a wrong answer would have `init` write a
  second guard, or `doctor` fail a tree that is guarded. It is left
  unread.
- **A root on the line that is a directory outside any work tree.** The
  hook checks no write there and says nothing, exit 0 (the amendment of
  2026-10-11), and `doctor` says of the line that it guards, by its root.
  A brief on such a line is asked of no one.
- **Two lines in two files.** A line in a person's own
  `.claude/settings.local.json`, or in their user settings, and `init`'s in
  `.claude/settings.json` both run for that person. `init` writes the
  project's file whatever the person's own holds, since every clone reads
  it, and `doctor` lists both lines and counts nothing.
- **`disableAllHooks`**, an entry's `type`, and an entry of the harness's
  under another event than the two, which the hook answers with nothing.
  None is read.

*Amended a third time 2026-10-12.* `doctor` and `init` read a line for the
tools a supported Claude Code can call, which are three. The amendment
above read a line for the four names the hook reads a file from, and said
of a line waited on before some of them that the rest go unchecked.
*Claimed:* Claude Code has no `MultiEdit` any more, so that sentence names
a tool nobody can call. *Measured*, each page read on 2026-10-12:

- **The tools reference** (<https://code.claude.com/docs/en/tools-reference>,
  the table of tools and *Configure tools with permission rules and hooks*).
  Of the tools in the table, three change a file their input names: `Edit`
  makes edits to a file, `Write` creates or overwrites one, and
  `NotebookEdit` changes the cells of a notebook. The word `MultiEdit` is
  nowhere on the page, and the path format of a permission rule,
  `Edit(...)`, is given as applying to those three.
- **The permissions page** (<https://code.claude.com/docs/en/permissions>,
  *Read and Edit*) is one of two pages that have the name at all, the errors
  reference being the other, and calls it "the legacy `MultiEdit` tool": a
  path rule written for it is accepted and never consulted.
- **The changelog** (<https://code.claude.com/docs/en/changelog>, 2.1.296
  back to 0.2.21, and the `CHANGELOG.md` of Claude Code's repository) names
  `MultiEdit` in no release, so the release the tool went in cannot be read
  there.
- **What each release declares.** Every release of
  `@anthropic-ai/claude-code` on npm ships `sdk-tools.d.ts`, the inputs of
  its tools as types. Read as text, release by release, never installed and
  never run: the file declares an input for `MultiEdit` in 1.0.128,
  published 2025-09-27, and in the releases sampled before it, and none in
  2.0.0, published two days later, or in any release sampled after it; and
  each of the 138 releases from 2.1.139 to 2.1.296 was read, of which none
  declares one. The file is no list of every tool (the reference has tools
  it does not hold), so that 2.0.0 took the tool away follows from it and
  is not its sentence. The oldest Claude Code that runs the hooks is
  2.1.139 (`CLAUDE_CODE_MINIMUM`, ADR-0012), published 2026-05-11.
- **The field that holds the path.** The hooks reference
  (<https://code.claude.com/docs/en/hooks>, *PreToolUse input*) gives
  `file_path` for `Write` and for `Edit`, always absolute, and has no
  section for `NotebookEdit`. The permissions page (*Match by input
  parameter*) has `notebook_path` as that tool's, and so do the declarations
  of every release read. The hook reads `file_path`, `path` and
  `notebook_path`, as it did.
- **No other tool in the table names a file it writes.** `Bash`,
  `PowerShell` and `Monitor` take a command, whose writes are git's hook's
  and the audit's to find (above). `Artifact`, `SendUserFile` and
  `ShareOnboardingGuide` send a file somewhere else; `EnterWorktree` makes
  a worktree or enters one; `SendFeedback` keeps a draft in a directory of
  Claude Code's own; `ExitPlanMode` presents a plan written before the
  call. A tool of an MCP server may write anything, under any field, and is
  read by no hook of the harness's.

So no Claude Code the hooks run under has a `MultiEdit` to call, and:

- **The hook reads a path from every name it ever read**, `MultiEdit`
  among them (`WRITING_TOOLS`, `src/hooks.ts`): a name more costs nothing,
  the hook never answers `allow`, and whatever still sends the name is
  answered. No answer of the hook's changes, for any line:
  `tests/integration/released-lines.test.ts` holds them, and the trees
  below were run through both builds.
- **What `doctor` and `init` say names the three** (`CALLABLE_TOOLS`). A
  line Claude Code waits on before `Edit`, `Write` and `NotebookEdit`
  covers every tool that writes, and is said with nothing more; one waited
  on before some of the three names the rest as unchecked; and `MultiEdit`
  is named as unchecked for no line.
- **A matcher that lets `MultiEdit` through and none of the three** is a
  line Claude Code waits on before no write: not the guard, as a line under
  `Bash` is not, and no entry of `init`'s.
- **`init` writes the matcher every release wrote**,
  `Edit|Write|MultiEdit|NotebookEdit`, and the plugin's `hooks/hooks.json`
  holds it. Taking the name out was weighed, and could be shown safe: a
  line is `init`'s own by its command and arguments, never by its matcher,
  so every line a release wrote would still be known, and a second `init
  --write` over a file an older release wrote would change nothing. It
  stays because the hook is asked about a name only under a matcher that
  lets the name through: with `MultiEdit` out of the matcher, the hook
  would read a name its own line never asks it about. The reference has a
  matcher made of names compare each with a tool's name exactly (*Matcher
  patterns*), so a name no tool has starts the hook for nothing.
- **`--format json`**: `before` and `after` hold the three names at most,
  so three for `init`'s own line where they held four. No field is added
  or taken away, and no `schemaVersion` moves.

Measured through the launcher of 0.16.0 and of this change (Windows 11,
Node 24.18.1, git 2.55), in a repository with a brief that protects a file,
the hook's line under both events with the matcher given:

| The matcher | `doctor` on 0.16.0 | `doctor` now |
| --- | --- | --- |
| `Edit\|Write\|MultiEdit\|NotebookEdit`, as `init` writes it | the guard, nothing more; `before` holds four names | the same; `before` holds three |
| `Edit\|Write\|NotebookEdit`, and `^(Edit\|Write\|NotebookEdit)$` | guards, and before none by MultiEdit, which goes unchecked | the guard, nothing more |
| `Edit\|Write` | before none by MultiEdit and NotebookEdit, which goes unchecked | before none by NotebookEdit, which goes unchecked |
| `MultiEdit` | guards, and before none by Edit, Write and NotebookEdit; one of `init`'s entries; exit 0, and 1 beside the plugin | waited on before no write, so not the guard; no entry of `init`'s; exit 0, beside the plugin too |

A `state` and an exit code that can change for a tree are a minor release
(spec-core's ADR-0009), though the tree is one nobody is known to have.
What was measured for this and left as it was:

- **A matcher with a comma, before Claude Code 2.1.191.** The page on
  debugging a configuration (<https://code.claude.com/docs/en/debug-your-config>,
  *Check hooks*, read 2026-10-12) has a `,` separate names as a `|` does,
  and says that before 2.1.191 a comma was read as part of a pattern, which
  then matched no tool. `doctor` reads a comma as the hooks reference has
  it today, for every release, so on 2.1.139 to 2.1.190 a line under
  `Edit, Write` is waited on before no write where `doctor` says it guards
  both. Every release wrote `|`.
- **A matcher that is an array.** The same section has such an entry listed
  as an invalid setting, and under `PreToolUse` none of that file's other
  hooks loaded either. `doctor` says of the entry that it cannot tell, as
  of any matcher that is not text, and reads the file's other entries as
  if they ran.

## Consequences

An agent that writes through a shell passes the guard and is caught at the
audit and at the archive. The guard's job is to make an honest agent never
need them, cheaply.
