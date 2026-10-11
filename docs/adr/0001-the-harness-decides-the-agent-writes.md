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

*Amended 2026-09-29.* The packet names a protection and a ruling's path the
guard cannot read, as it names such a pattern in the scope. While a
protection the guard cannot read stands, the guard refuses every write but
to the brief, where it is fixed, as `unreadable-protection`, and no ruling
waives the refusal. No write got past it on the packet's word, but the
packet listed the pattern as written among the files the round must not
change, so the agent planned the round on a scope it could not write and
learned why from the first refusal. A ruling's path the guard cannot read
is passed over, so it allows nothing, and the packet listed it among what
the ruling allows. Each is now marked where it is listed, with spec-core's
reason and what the guard does without it: for a protection, that until it
is fixed the guard refuses every write but to the brief; for a ruling's
path, that it allows nothing. `context --format json` and `start_round`
list them as `unreadableProtections` and `unreadableRulingPaths`, each path
with its ruling's id. A readable pattern is listed as before.

*Amended 2026-09-30.* A pattern in `affectedFiles` that a leading `/` roots,
alone or on a brace alternative, such as `/docs` or `{/docs,src/**}`, can be
read, and matches no path the guard decides, all of which are
repository-relative: the rooted part puts no path in the scope. spec-guard
was asked about its base, `/docs`, or `/` for a name the repository does not
hold, refused the path as outside the repository, and with it the whole
query, so the rules over the rest of the scope were lost too. A rooted base
is no longer asked about, and the packet marks the pattern where the scope
is listed as putting no path in the scope, or, for a rooted alternative, as
that alternative putting none. When no pattern in `affectedFiles` puts a
path in the scope, each rooted or unreadable, the packet says so, and to
treat every ADR as binding until the scope is fixed.

*Amended 2026-09-30.* A protection or a signed ruling's path that a leading
`/` roots is read the same way, and was listed as written: a person read
`/src/db/schema.ts` among the files the round must not change while the
guard let every write to it through, and a ruling over `/src/db/schema.ts`
among what is allowed while the file stayed refused. The packet now marks a
rooted protection as protecting no path and a rooted ruling path as
allowing nothing, or, for a rooted brace alternative, that alternative. The
audit warns about each, `protection-rooted` and `ruling-path-rooted`, which
fail it under `--strict`: a protection that protects nothing may have let
the round change what the person meant to keep.

*Amended 2026-09-30.* Front matter that closes can still hide a status. A
line that is not `key: value` - `status accepted` without its colon, an
indented line with no key above it - is one spec-core's reader passes over
and reports (spec-core ADR-0004), and the packet showed the document as one
without a status and said nothing. The packet now names each such line: the
document, the line number and the line as written, with spec-core's reason,
and says a status written on it, if any, was not read. `--format json` and
`start_round` list them as `unreadableFrontMatter`, beside
`unclosedFrontMatter`. The line is named whether or not a status was read
from another line, since the reader cannot tell what it held; a line the
reader did read, such as a key declared twice, is not named.

*Amended 2026-09-30.* A cited document's status is read under `status`
alone again. 0.7.0 read it under `狀態` or `状态` as well, without a
`status` key, with the family's Chinese status words; the maintainer chose
English only for the whole family - a small team, one language to
maintain, and a heuristic in a second language is where false positives
come from. A document may be written in any language; its status is
written in English, `status: superseded`, which every spec-* tool reads.

*Amended 2026-10-11.* The packet lists the rules of the rest where
spec-guard refuses for a spec pattern that matched no file. The packet asks
`spec-guard query <paths> --json` and told its refusals apart by the
document: exit 2 with a document that names no spec file is a repository
that keeps none, and any other exit 2 was rules that could not be read,
with what spec-guard said and `Treat every ADR as binding until they can`.
spec-guard 0.22.0 added a refusal that is neither: a pattern among its
`specs` that matches no file beside others that do is exit 2, and the
document is still written, with the rules of every file that did match and
the patterns as `unmatchedSpecs` (spec-core's ADR-0005, amended
2026-10-11). Measured on 0.13.0 through the launcher (Windows 11, Node
24.18.1), with `docs/**/*.md` and `rfcs/*.md` as spec-guard's `specs`, one
ADR under `docs` that states a rule over the brief's scope, and nothing
under `rfcs`:

| spec-guard | Its answer to the query | The packet |
| --- | --- | --- |
| 0.12.0, the minimum, and 0.21.0 | exit 0, the rule, no `unmatchedSpecs` | the rule |
| 0.22.0 | exit 2, the rule, `unmatchedSpecs` naming `rfcs/*.md`, and on stderr `the pattern "rfcs/*.md" matched no spec file. Remove it from "specs" in package.json.` | `The rules spec-guard holds this code to could not be read: spec-guard exited 2: the pattern "rfcs/*.md" matched no spec file.` and so on, and no rule |

So a repository that upgraded spec-guard lost every rule from the packet
over one pattern, and its agent was told to treat every ADR as binding
where spec-guard had named the rules that are. The packet now lists those
rules as it lists any, under one sentence:

    spec-guard's pattern `rfcs/*.md` matched no spec file, so a rule kept under it is not listed here; remove the pattern from spec-guard's `specs`.

- **The document decides, and the exit code beside it does not.** A
  document that names such patterns is read for them and for its rules,
  whatever code came with it; one that names none is read as it was. So
  where no pattern matched a file, which 0.22.0 also says with
  `unmatchedSpecs`, spec-guard still holds no rule over the scope, and any
  other refusal is still rules that could not be read.
- **Nothing is said beyond what is known.** The sentence names what the
  list lacks and what to do, and does not say to treat every ADR as
  binding: the rules listed are in force. Where the files that matched
  hold no rule over the scope, the packet says that of them, `The spec
  files that did match hold no rule over this scope`, and not that
  spec-guard holds none.
- **The patterns have a field of their own.** `context --format json` and
  `start_round` carry them as `unmatchedSpecs`, as spec-guard writes them
  and in its order, and an empty list where it names none. The field is
  added, so no `schemaVersion` moves. It is read as every field of a
  sibling's document is (ADR-0002): patterns that are not a list of text
  are a document the harness cannot read, and the rules are then said to
  be unread, never listed as a whole answer.
- **An older spec-guard is read as before.** It writes no such field, so
  `MINIMUM_VERSIONS` stays where it is. The development dependency is
  brought to 0.22.0, and the suite's test of the real sibling holds both
  answers to the same repository, the one 0.22.0 gives and the one CI's
  `test (minimum siblings)` job gets from 0.12.0 (ADR-0011).

The audit and `premises` run spec-guard over a brief they name, which
replaces its `specs`: measured with the same configuration, spec-guard
0.22.0 answers both as 0.21.0 did, exit 0, and neither is changed.

## Consequences

Every command gives the same answer for the same repository. What the plan
wanted that needs a model became prompts; what needs the host stayed the
host's.
