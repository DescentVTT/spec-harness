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
