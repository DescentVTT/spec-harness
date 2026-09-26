---
name: run-round
description: Carry out one approved brief as a contract - load its context, stay inside its scope, escalate instead of working around a protection, and keep its checklist honest. Use when asked to implement, execute or work on a brief, or when on a branch named like brief/<id>-<topic>.
---

# Run a round

## 1. Start from the contract

Work on a branch named after the brief, `brief/<id>-<topic>`, or pass
`--brief <id>`. Then:

```bash
npx spec-harness context <id>
```

It gives you the brief in full, the scope as the guard reads it, the rulings
already signed, the briefs this one waited on, the rules spec-guard holds the
scope's code to, and the documents the brief cites. Read it before the code.

## 2. Stay inside the lines

- Write the files in `affectedFiles`. If the hook is installed, every edit is
  checked; otherwise ask first: `npx spec-harness guard <path>`.
- A protected file is not yours to change. If the round cannot be finished
  without it, stop and escalate - do not work around it, do not edit through
  a shell to avoid the hook:

  ```bash
  npx spec-harness escalate --path <file> --reason "<why the round needs it>" \
    --option "<option>: <what it costs>" --option "<other option>: <cost>" \
    --recommend "<which, and why>"
  ```

  Then wait. A person rules, and signs the ruling; only a signed ruling lets
  the guard pass the file.
- A file outside the scope that the round genuinely needs: say so in the
  brief and tell the person. The archive reports every such file.
- Adding a dependency is a decision: name it in the brief and say why.

## 3. Keep the checklist true

Tick a box when its work is done and verified, not before. A box you will
not do gets a note under it that starts with a disposition the repository
accepts - `**Delegated`, `**Accepted debt`, `**Rejected` by default - and
says why. Commit as you go; the audit measures commits.
