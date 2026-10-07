---
name: split-goal
description: Split a goal too large for one round into briefs - each a small, separately reviewable round - ordered by dependency and grouped into waves that provably cannot write the same file. Use when asked to plan a multi-step feature, an epic, or work for several agents in parallel.
---

# Split a goal into rounds

You decide what the pieces are; the tools decide whether the plan holds.

## Before any command

Run every command below as written, from the repository's root. Each gives
`npx` the package's full name behind `--no-install`, so it runs the tool this
project installed and fetches nothing.

If one stops with `npx canceled due to missing packages`, the project's
dependencies are not installed in this work tree - a fresh clone, a new
worktree - or you are not at its root. Install them there, as with `npm ci`,
and run the command again; if that fails, stop and tell the person.

Never work around it by dropping `--no-install` or the `@descent-vtt/` in
front of the name. Without the scope the names are not these tools: on npm
`spec-harness` is another publisher's package, and `npx` would fetch it and
run it.

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
npx --no-install @descent-vtt/spec-brief schedule --format json     # if this version has it
npx --no-install @descent-vtt/spec-brief matrix --all-waves         # otherwise: which pairs collide
```

A wave may run in parallel only if no two of its briefs can name the same
file. `schedule` computes waves from `dependsOn` and from collisions; `matrix`
names a file both briefs would write when two collide. Resolve a collision by
narrowing a scope, by adding a `dependsOn`, or by moving a brief to a later
wave - never by leaving it for merge time.

```bash
npx --no-install @descent-vtt/spec-brief lint --format json         # no cycles, waves in dependency order
```

## 3. Present the plan

Give the person the list: each brief's title, wave, dependencies and scope,
and the deferrals with their triggers. The person approves the plan and each
brief before its round starts.
