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
