# Changelog

## Unreleased

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
- `mcp`: start_round, check_path, request_escalation, audit_round and
  list_rounds, with the workflow prompts, over both MCP protocol eras.
- Skills for Claude Code and other Agent Skills readers: draft-brief,
  split-goal, run-round, close-round; the repository is also a Claude Code
  plugin marketplace.
- spec-core at cbe2223, vendored with its licence, which the package ships.
  A scope that writes `**` inside a name (`docs/**.md`) is refused with the
  two ways to say what was meant, as spec-brief and spec-guard refuse it.
