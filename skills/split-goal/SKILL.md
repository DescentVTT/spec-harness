---
name: split-goal
description: Split a goal too large for one round into briefs - each a small, separately reviewable round - ordered by dependency and grouped into waves that provably cannot write the same file. Use when asked to plan a multi-step feature, an epic, or work for several agents in parallel.
---

# Split a goal into rounds

You decide what the pieces are; the tools decide whether the plan holds.

## 1. Cut along files and decisions

- One brief, one outcome a reviewer can judge on its own. Prefer rounds that
  touch few files; a round whose scope is `src/**` collides with everything.
- What must exist before something else can start is a `dependsOn`.
- Split off what can wait - scaling, polish, the second backend - as its own
  brief, and give each deferral an **observable trigger** in its text ("when
  the second tenant signs", "when p95 exceeds 200 ms"), never a date.
- Write each piece as a draft with the `draft-brief` steps. Drafts need not be
  complete to be scheduled; their scopes must be.

## 2. Let the tools place the waves

```bash
npx spec-brief schedule --format json     # if this version has it
npx spec-brief matrix --all-waves         # otherwise: which pairs collide
```

A wave may run in parallel only if no two of its briefs can name the same
file. `schedule` computes waves from `dependsOn` and from collisions; `matrix`
names a file both briefs would write when two collide. Resolve a collision by
narrowing a scope, by adding a `dependsOn`, or by moving a brief to a later
wave - never by leaving it for merge time.

```bash
npx spec-brief lint --format json         # no cycles, waves in dependency order
```

## 3. Present the plan

Give the person the list: each brief's title, wave, dependencies and scope,
and the deferrals with their triggers. The person approves the plan and each
brief before its round starts.
