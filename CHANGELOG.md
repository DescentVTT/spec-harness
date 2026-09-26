# Changelog

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
