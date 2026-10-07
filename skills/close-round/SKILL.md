---
name: close-round
description: Check that a round is really done - scope kept, protections held, goals met, the defect's probe green, no unexplained dependency - and hand the archive decision to a person. Use when a brief's work looks finished, before opening or merging its pull request.
---

# Close a round

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

## 1. Audit

```bash
npx --no-install @descent-vtt/spec-harness audit --format json
```

It reports, as one list: what spec-brief's archive would refuse or warn
about (open boxes, protected files changed, files outside the scope, work not
committed), the brief's own assertions (a goal that fails; a premise that
still holds), rulings whose signatures do not verify, and every dependency the
round added or allowed to run install scripts. Fix what it reports, then run
it again. `unmeasured` means it could not see the round's commits: pass
`--base <branch>`. Read `measured` beside the findings, since an audit that
ran nothing finds nothing too: `assertions: "unavailable"` ran no goal, and
`assertion-unreadable` is a directive spec-guard cannot read, to fix before
the round is done.

## 2. For a defect, show it is gone

```bash
npx --no-install @descent-vtt/spec-harness probe <id> --at head
```

`fixed` is the only verdict that closes a defect. Add the evidence table to
the brief next to the one that measured it.

## 3. Hand over

```bash
npx --no-install @descent-vtt/spec-brief archive <id> --dry-run --base <branch>
```

A protected file a signed ruling allows is accepted only when spec-brief loads
spec-harness's plugin; if the dry run refuses one,
`npx --no-install @descent-vtt/spec-harness doctor` says whether it does, and
`init` adds it.

Show the person the audit, the dry run and a short summary of what the round
did and did not do. Archiving is theirs: they run `spec-brief archive <id>`
and commit the result. Do not archive a brief yourself.
