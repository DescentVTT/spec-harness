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
