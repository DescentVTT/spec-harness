---
status: accepted
date: 2026-09-26
---

# ADR-0004: The active brief is named, not guessed

## Decision

The brief a round works on is, in order: `--brief <id>`; the `SPEC_BRIEF`
environment variable; the branch name, read through templates such as
`brief/{id}` and `*/brief-{id}` (configurable as `branches`). Ids compare as
written, or as numbers when both are all digits, so `brief/12` names `012`.

It is never inferred from which brief happens to be the only active one.
With no brief named, the guard has no contract to check and says so. With a
brief named that spec-brief does not know, or one already archived, every
write waits (exit 2) until the name is fixed: a guard pointed at the wrong
contract protects the wrong files.

*Amended 2026-09-30.* CI checks out a commit on no branch, so a round's own
CI run named no brief: `premises` read the premise the round retires as
stale, and failed the round's pipeline for doing its work. On a detached
HEAD the branch is now the one the forge's CI names, in this order:
`GITHUB_HEAD_REF`, a GitHub pull request's head branch; `GITHUB_REF_NAME`
when `GITHUB_REF_TYPE` is `branch`, the branch a GitHub push built;
`CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, a GitLab merge request's source
branch; `CI_COMMIT_BRANCH`, the branch a GitLab pipeline built. Each names a
branch only: `GITHUB_REF_NAME` names a tag too, so it is read only with
`GITHUB_REF_TYPE`, and GitLab's `CI_COMMIT_REF_NAME`, which names a tag as
well, is not read. This is a name, not a guess: the forge says which branch
the run builds, and the branch's name still has to carry the brief's id. A
branch checked out always wins, so a person's detached HEAD outside CI
names no brief, as before.

*Amended 2026-10-09.* A name that names no brief is refused where it is
given, and only an empty `SPEC_BRIEF` is still passed over. The order above
had the next source answer for a flag that held nothing: on a branch
`brief/012-x`, `guard --brief ""` was decided against brief 012 and
`context --brief " "` printed its packet, exit 0, and nothing said the flag
had named no brief (measured on 0.11.1, through the launcher).
`--brief "$ID"` is what a script writes, and the variable not set is how it
comes to hold nothing. The run then answers for another brief than the one
its caller believes it named, which is the guard pointed at the wrong
contract that this decision exists to prevent.

- `--brief` given an empty value, or space alone, is exit 2 and one line,
  `--brief is "", which names no brief`, from every command that reads it;
  so is a brief given as an argument, `context ""`, and the `brief` argument
  of the server's tools, as a tool error that names it (ADR-0005).
- `SPEC_BRIEF` set and empty, or to space alone, is as unset, and that is
  decided, not left over. What sets the variable sets it whether or not a
  round is under way: a hook's settings, a pipeline's `env` block, which is
  written once and expands to nothing on every run outside a round. The
  branch that then names the brief is a source the output states. A flag is
  typed for the run it is on; a variable is set for every run. One that
  names a brief spec-brief does not know stops the run, as the flag does and
  as it did.
- `hook claude` passes over an empty `--brief`, as every release has: a
  refusal on its line is exit 2 before every write of a session (ADR-0005).
- `doctor` says it in its report, `brief   none: --brief is "", which names
  no brief`, and says there what every command that acts on a brief stops
  on: a brief spec-brief does not know, or has archived, whichever source
  names it. It printed `brief   999` and no more for a brief under which
  every write was held. It asks spec-brief only when something names a
  brief, as above; a spec-brief that cannot be run is a row of the report
  already, and one that could not list the briefs is said on the brief's
  line. None of it changes doctor's exit code: its report states a base that
  names no commit and exits as it would have, and a brief is stated the
  same way. `--format json` keeps the id as `brief` and adds the reason as
  `briefProblem`, `null` where there is none; the field is added, so no
  `schemaVersion` moves.

## Consequences

No file records the active brief, so no file can record it wrongly, and two
worktrees on two branches run two rounds without coordinating.
