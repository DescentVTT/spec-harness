---
status: accepted
date: 2026-09-27
---

# ADR-0012: One way into Claude Code, and the release it needs

## Context

Claude Code reaches the harness one of two ways. The plugin brings the
skills, the guard hooks (`hooks/hooks.json`) and the MCP server
(`.mcp.json`); `spec-harness init` writes the same hooks into the project's
`.claude/settings.json` and the same server into its `.mcp.json`. Until now
only the README said to pick one.

Both at once is not merged away. Claude Code runs one copy of a handler that
several settings files define, but a plugin's copy of the same handler stays
separate (its hooks reference), so the guard runs twice before and after
every write: a refusal twice, an `ask` asked twice, a warning twice. Claude
Code drops a plugin's server that runs the same command as a server
configured above it, but the two spell the project differently: the plugin
names `${CLAUDE_PROJECT_DIR}`, which Claude Code substitutes for a plugin,
and a project's `.mcp.json` must write `${CLAUDE_PROJECT_DIR:-.}`, since
Claude Code expands it there from an environment that does not hold the
variable. Their arguments differ, and both servers connect.

Claude Code records a plugin as on in `enabledPlugins`, keyed
`<name>@<marketplace>`, in any of its settings: the user's
(`~/.claude/settings.json`, or `settings.json` in `CLAUDE_CONFIG_DIR`), the
project's `.claude/settings.json`, the local `.claude/settings.local.json`,
`--settings` and managed settings. They merge key by key, and for each id
the source of highest precedence that names it decides: user, then project,
then local, then `--settings`, then managed.

The hooks are exec form, `command` and `args`, so the project's path is one
argument whatever it holds and no shell reads it. Claude Code's changelog
adds hook `args` in 2.1.139, the release that also lets a plugin's server
command name `${CLAUDE_PROJECT_DIR}`. The hooks reference describes exec
form without naming a release.

## Decision

**init writes neither entry while the plugin is on.** It reads
`enabledPlugins` from the user's, the project's and the local settings, in
that order, as Claude Code merges them, and counts an id
`spec-harness@<marketplace>` that one sets to `true` and no later one sets
to `false`. Then `.claude/settings.json` and `.mcp.json` are `skip` in its
plan, which names the id and the file that turns it on, and says how to
have init's entries instead: turn the plugin off for this project,
`claude plugin disable <id> --scope local`, which writes `false` into
`.claude/settings.local.json`, and run init again. That is the whole
override. A flag that wrote the entries with the plugin still on would
write the double install this decision is about.

**init removes nothing.** Where the plugin is on and a file already holds
init's entry, as this release or 0.1 wrote it, the step is `advise`: the
double install, and the two ways out. The file is left as it is. Both files
are the repository's, committed for every clone, and a clone whose person
has no plugin relies on them; the plugin may be on in one person's user
settings alone.

**doctor reports the wiring**: the plugin and the file that turns it on,
init's entries (the settings files that hold the guard hooks, and whether
`.mcp.json` registers the server), both, or neither. Both exits 1, with how
to keep one. Neither is said, and is a choice rather than a failure: a
repository may use spec-harness without Claude Code.

**The plugin does not stand down at run time.** Its hooks are files Claude
Code runs as the plugin ships them. The plugin's copy could be told apart by
an argument and stay silent where settings hold the guard, but a copy that
stays silent because it believes another runs can leave none running.
Claude Code reads no hooks from a repository's `.claude/settings.json` in a
session that spans several repositories, and still reads `enabledPlugins`
there; `allowManagedHooksOnly`, and `disableAllHooks` outside managed
settings, turn the settings' hooks off and leave on the hooks of a plugin
that managed settings force on. A guard twice is noise; no guard is an
unguarded write. So the other order, init first and the plugin installed
later, is found by `doctor` and by init's next run rather than prevented.

**Claude Code 2.1.139 or later** runs the hooks and the plugin's server. The
README says so where it says what to install, and so does the plugin's
manifest.

*Amended 2026-09-30.* doctor checks the release, where only the documents
stated it. A Claude Code older than 2.1.139 ignores a hook's `args` and runs
its bare `command`, `node`, which reads the hook's input as a script and
fails; Claude Code blocks a tool call only on a PreToolUse hook's exit 2, so
every write passes unguarded, and nothing says so. When the plugin or
init's hooks wire Claude Code to the guard, doctor runs `claude --version`,
found on `PATH` and started without a shell, as every program the harness
runs is (ADR-0002). An older release exits 1. A `claude` that is not found,
a version that cannot be read, and on Windows a `claude.cmd` shim, which
cannot be started without a shell, are *cannot tell*: never reported as
fine, and a failure under `--strict`, since nothing measured is not clean
(spec-core ADR-0005). The minimum is `CLAUDE_CODE_MINIMUM` in
`src/versions.ts`, beside the siblings', and a test holds the README and the
plugin's manifest to it. The `claude` on `PATH` may not be the one an editor
or the desktop app runs, which doctor cannot see; the README says to check
that one there.

*Amended 2026-09-30.* npm installs Claude Code on Windows as a `claude.cmd`
shim, and Node refuses to start a `.cmd` without a shell since the fix for
CVE-2024-27980, so doctor told most Windows users it could not tell, and
`doctor --strict` failed them. doctor now reads the shim rather than run
it: the path it runs, from the shim's own directory, as npm's cmd-shim
writes it (`"%dp0%\node_modules\@anthropic-ai\claude-code\..."`) and pnpm's
(`"%~dp0\..."`), names the `@anthropic-ai/claude-code` package, whose
package.json declares the release, which is measured against the minimum
as `claude --version`'s answer is, and named as read from that file. Nothing
is run, through cmd.exe or otherwise. A shim that names no such package -
another package's, one by an absolute path, which pnpm writes only across
drives, or none - and a package.json with no version are *cannot tell*, as
before. Which `claude`
is measured is still the one Windows finds first on `PATH`, and a
`claude.exe`, as the native installer puts one, is asked, as before.

*Amended 2026-10-07.* git's pre-commit hook is run as Claude Code's hooks
are: `node` and the script in the project's install. `init --git-hook` wrote
`exec npx --no-install spec-harness hook git`, which starts npm to start
node on every commit. Under npm 12, npx says on stderr what it runs, two
`npm notice run` lines a commit, where npm 10 and 11 print none (measured
with 10.9.9, 11.20.0 and 12.2.0). And where the harness is not installed,
npx asks the registry about the bare name `spec-harness`, which is another
publisher's package, and names that package in its refusal.

git starts a pre-commit hook at the top of the work tree it commits in:
from a subdirectory, under `git -C`, in a linked worktree, whose top it is
though the hook file is the main work tree's, and for a `core.hooksPath`
that is relative, absolute, or shared by several repositories (githooks(5),
and measured with Git for Windows 2.55). So the hook names the script by
its path from there,
`node_modules/@descent-vtt/spec-harness/bin/spec-harness.js`: not from
where the hook file is, which for a linked worktree and for shared hooks is
another place, and not by an absolute path written by init, which a second
work tree or a moved repository does not have. Each work tree is
guarded by its own install, as the siblings are found in its own
`node_modules`. Where the script is not there - a linked worktree nobody
installed into, a repository that shares its hooks with one that uses the
harness - node would end on a stack trace, so the hook checks first, says
what is missing and where, and exits 2: git stops the commit, as it did
when npx found nothing to run. The hook is a POSIX sh script on every
platform, since Git for Windows runs a hook with the sh it ships, and a
test has git run it there.

init never replaces a hook that exists, so one written the old way keeps
running through npx, and keeps guarding. doctor and init read it as a hook
that runs spec-harness, as before, and add a note: how it is run, and the
line that runs it with node. The note fails nothing, `--strict` or not, and
`doctor --format json` has it as `gitHook.note`, `null` where there is
nothing to say; the field is added, so no `schemaVersion` moves.
A comment that names the npx command is not noted, and neither is another
runner's line, such as `pnpm exec`, which is the repository's to choose.
The line advised for a hook of the repository's own is the node line too.

## Consequences

- A plugin turned on by managed settings or `--settings` is invisible to
  init and doctor: neither is a file a project can read. A marketplace that
  lists this repository under a name other than `spec-harness` is not
  recognised either.
- A settings file that cannot be read as JSON says nothing about the plugin
  or the guard.
- A person with the plugin on in their user settings, in a repository that
  committed init's entries, has a double install: doctor exits 1 and says to
  turn the plugin off for the project, which the local settings file keeps
  to them.
- init reads the user's settings from `CLAUDE_CONFIG_DIR`, or `.claude`
  under `USERPROFILE` on Windows and `HOME` elsewhere, as Claude Code does;
  with none of them set it reads the project's two files alone.
