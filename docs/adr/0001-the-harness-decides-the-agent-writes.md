---
status: accepted
date: 2026-09-26
---

# ADR-0001: The harness decides; the agent writes

## Context

The plan this tool grew from (`agent-brief-harness`, 2026-09-13) had it
package context, run agents as subprocesses, watch their output streams,
count their tokens, roll back their work and draft ADRs. Several of those are
a model's work - writing an ADR, deciding what a goal means - and several are
work the agent's own host already does better - running the agent, counting
its tokens. A tool that does the model's part gives a different answer each
time; one that duplicates the host's part is always a version behind it.

## Decision

**spec-harness never calls a model and never writes content.** It gives the
agent what it needs and judges what the agent did, deterministically:

| It does | It does not |
| --- | --- |
| assemble a round's context (`context`) | summarise, rank or rewrite documents |
| answer "may I write this file" (`guard`, hooks) | stop a process mid-stream |
| audit a finished round (`audit`) | roll back, stash or reset anything |
| run a brief's probes at two commits (`probe`) | write the probe or the fix |
| record escalations and verify rulings | decide a ruling, or sign one |
| configure the family to agree (`init`) | archive a brief: that is a person's decision, through spec-brief |

The agent's host runs the agent. The workflow - how to draft a brief, split a
goal, run a round, close it - is text the agent reads (skills and MCP
prompts), with a size budget a test holds (ADR-0009).

*Amended 2026-09-28.* The context names what it could not read in a cited
document, as it names what the budget left out. Front matter opened on the
first line and never closed is no front matter to spec-core's scanner, which
reports it as `unclosedFrontMatter` (spec-core ADR-0004), so the status its
author wrote was never read and the packet showed a document without one: a
superseded ADR looked like one with no status at all. The packet now names
such a document, says its status was not read, and gives the fix, closing the
block with `---`; the document is still included, and the note fails
nothing. Only YAML front matter is named. TOML front matter gives no status
closed or not, so closing it would change nothing the packet shows.

*Amended 2026-09-29.* The rules in the packet are those over the brief's
scope: spec-guard is asked about where each `affectedFiles` pattern can
reach, its bases under spec-core's glob. A name with no glob syntax had the
base of a file whatever it was on disk, the directory holding it, so
`affectedFiles: [src]` asked about the whole repository and the packet held
a rule over `lib/` that `src/` left out. A name that exists is now asked
about as itself, file or directory, since spec-guard reads which from the
disk. A name the round has yet to create is asked about through the
directory that will hold it, as before, the root for a name at the top:
spec-guard reads a path that does not exist as a file unless it ends in
`/`, so the name alone would leave out the rules over a directory the round
creates, and a packet that leaves out a rule in force tells the agent the
code is freer than it is. The guard still reads the name as a file or a
directory.

*Amended 2026-09-29.* The packet names a pattern in the scope the guard
cannot read, as it names what it could not read in a cited document. A
pattern in `affectedFiles` that spec-core's glob refuses - malformed, too
large to compile, or naming no path, such as `{./,src}` - puts no path in
the scope: the guard passes over it, naming it and the reason in `because`,
and spec-guard is not asked about it. The packet listed it as written among
the files the round may write, so the agent read a scope the guard does not
hold, and a write it made there drew, by default, the guard's out-of-scope
warning after the write. Each such pattern is now marked where the scope is listed,
with spec-core's reason, and `context --format json` and `start_round` list
them as `unreadableScope`; a readable pattern is listed as before. When no
pattern in `affectedFiles` can be read, spec-guard is asked about no path,
and its empty answer read as "spec-guard holds no rule over this scope",
which tells the agent the code it writes is unconstrained. The packet now
says the scope could not be read, and to treat every ADR as binding until
the scope is fixed. A protection the guard cannot read is still listed as
written: the guard refuses every write while it stands, naming it and the
reason, so no write gets past it on the packet's word.

## Consequences

Every command gives the same answer for the same repository. What the plan
wanted that needs a model became prompts; what needs the host stayed the
host's.
