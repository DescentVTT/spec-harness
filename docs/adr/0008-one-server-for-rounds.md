---
status: accepted
date: 2026-09-26
---

# ADR-0008: One MCP server for rounds; spec-guard keeps its own for rules

## Decision

`spec-harness mcp` serves what is about a round: `start_round` (the context
packet), `check_path` (the guard), `request_escalation`, `audit_round`,
`list_rounds`, and the workflow prompts. spec-guard's server keeps serving the
rules (`get_architectural_rules`, `check_architecture`). The harness asks
spec-guard for rules through its command line and does not re-serve them, so
an agent meets each question once. Both servers use spec-core's `jsonrpc`
module and serve both protocol eras (spec-core ADR-0008).

*Amended 2026-10-09.* A tool refuses an argument that is given and names
nothing, as the command line refuses its option (ADR-0005): an empty `brief`
or `base`, an empty place in `paths`, an empty `recommendation`, an option
without a label (ADR-0006). The answer is a tool error that names the
argument and shows what it holds, `"paths[1]" is "", which names no file`,
and nothing is written for the call. Read as left out, an empty `brief` was
answered for the branch's brief and an empty `base` with no ruling
verified, and the agent took either for the answer to what it had asked. A
prompt's argument left empty is still the prompt alone: a client sends an
empty one for a field a person left blank.
