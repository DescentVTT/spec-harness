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

## Consequences

Every command gives the same answer for the same repository. What the plan
wanted that needs a model became prompts; what needs the host stayed the
host's.
