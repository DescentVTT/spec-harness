---
status: accepted
date: 2026-09-26
---

# ADR-0009: Prompts are workflow, with a budget

## Decision

The workflow - draft a brief, split a goal into rounds, run a round, close it
- ships as Agent Skills (`skills/<name>/SKILL.md`) and as the same text
through MCP prompts. The skills say which deterministic check to run at each
step and what a person must approve; they do not restate what the tools
check. Section names are never hard-coded: a skill tells the agent to read
them, with their hints, from spec-brief's configuration.

**Budget**: all skills together stay under 30,000 characters, held by a
test. Every character is read into an agent's context each time a skill
loads.

*Amended 2026-10-07.* A skill's commands give `npx` the package's full name
behind `--no-install`, as in
`npx --no-install @descent-vtt/spec-harness context <id>`, and each skill
opens by saying what to do where that stops: install the project's
dependencies in the work tree, as with `npm ci`, and never drop the flag or
the scope. An agent follows a skill to the letter in whatever tree it stands
in - a fresh clone, a linked worktree nobody installed into - and with no
terminal `npx` asks nothing before it fetches. Without the scope the names
are not the family's on npm: `spec-harness` is another publisher's package,
with a command of the same name, and the siblings' names belonged to nobody
on 2026-10-07. spec-guard is optional here, so the step that asks it for a
path's rules gave `npx`, in a project without it, a name anyone can
register; that step now runs only where the project lists the package.

The full name alone would fetch this package, which is no stranger's; a
skill does not do that either, because what it would run is the latest
release and not the one the project pinned, and the harness works from the
project's install. `--no-install` in front of the bare name was measured
and is not enough: it stops a download, and npm still runs a copy an
earlier fetch left in its cache, and names the other publisher's package as
the one to install, which is what an agent would then do.
[spec-core's ADR-0005](https://github.com/DescentVTT/spec-core/blob/main/docs/adr/0005-the-family-contract.md#names)
has the family's rule and the measurements, under npm 10.9.9, 11.20.0 and
12.2.0. `tests/names.test.ts` holds the skills, the README and every other
file here to it. The four skills went from 8,404 characters to 11,885.
