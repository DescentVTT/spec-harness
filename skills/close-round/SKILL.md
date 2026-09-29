---
name: close-round
description: Check that a round is really done - scope kept, protections held, goals met, the defect's probe green, no unexplained dependency - and hand the archive decision to a person. Use when a brief's work looks finished, before opening or merging its pull request.
---

# Close a round

## 1. Audit

```bash
npx spec-harness audit --format json
```

It reports, as one list: what spec-brief's archive would refuse or warn
about (open boxes, protected files changed, files outside the scope, work not
committed), the brief's own assertions (a goal that fails; a premise that
still holds), rulings whose signatures do not verify, and every dependency the
round added. Fix what it reports, then run it again. `unmeasured` means it
could not see the round's commits: pass `--base <branch>`. Read `measured`
beside the findings, since an audit that ran nothing finds nothing too:
`assertions: "unavailable"` ran no goal, and `assertion-unreadable` is a
directive spec-guard cannot read, to fix before the round is done.

## 2. For a defect, show it is gone

```bash
npx spec-harness probe <id> --at head
```

`fixed` is the only verdict that closes a defect. Add the evidence table to
the brief next to the one that measured it.

## 3. Hand over

```bash
npx spec-brief archive <id> --dry-run --base <branch>
```

A protected file a signed ruling allows is accepted only when spec-brief loads
spec-harness's plugin; if the dry run refuses one, `npx spec-harness doctor`
says whether it does, and `init` adds it.

Show the person the audit, the dry run and a short summary of what the round
did and did not do. Archiving is theirs: they run `spec-brief archive <id>`
and commit the result. Do not archive a brief yourself.
