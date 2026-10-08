---
status: accepted
date: 2026-09-26
---

# ADR-0007: Probes declare their failure

## Context

A model planning work will sometimes describe a defect that does not exist.
The planned `spec-probe` answered with a test that must fail before the brief
is filed, and proposed checking that it fails "for the reason in the defect
description" - comparing prose with prose.

## Decision

- A probe is a fenced `probe` block in the brief (`id`, `run`, and optionally
  `setup`, `junit`, `test`, `runs`, `timeout`), with the files it needs as
  `probe-file <path>` blocks. The evidence and the claim are one record, and
  a hash of every block is printed with the evidence, so a later edit to the
  probe shows.
- **How it fails is declared**: a `signature` the failing output must
  contain, or a `test` whose failure the JUnit report must show - with a
  message containing the signature when both are given. A probe with neither
  is refused: a red that may be a compile error proves nothing.
- It runs in a temporary worktree (ADR-0003) at the **base**, where every run
  must be red for the declared reason (`measured`), and at the **head**,
  where every run must be green (`fixed`). Runs that disagree are `flaky`;
  green at the base is `vacuous` - the defect is not there; any other outcome
  is `invalid`.
- JUnit XML is the one report format read, because nearly every runner
  writes it, natively or through a reporter.
- The command runs through the shell. It is a line of the repository's own
  brief, approved with it, as CI runs the repository's own scripts.

*Amended 2026-10-08.* What a probe's command finds installed was measured
with the released 0.10.0 on Windows under npm 11.16.0, with a made-up name
served from a registry on the loopback address. The worktree holds the files
the commit tracks and the probe's files: no `node_modules`, and none above it
in the temporary directory. The command has no terminal and `CI` set. There
`npx <name>` fetched the registry's package of that name and ran it, unasked,
wherever `setup` had not installed the name. With `--no-install` on the line,
or `yes=false` in an `.npmrc` the commit tracks, npm asked the registry about
the name and fetched nothing. `npm test -- <file>` asked the registry
nothing, and failed where `setup` had installed nothing. The README's example
ran its test through `npx` by the runner's name alone; it now runs the
project's own script, the `draft-brief` skill says the same of a probe an
agent writes, and `tests/npm.test.ts` holds every probe this repository shows
to a command that fetches nothing. The harness still runs a probe's line as
it is written.

*Amended again 2026-10-08.* **A probe's command fetches nothing through npx
unless its line or the person says so.** Measured on Windows 11 with Node
24.18.1 under npm 10.9.9, 11.16.0, 11.20.0 and 12.2.0, a command started as a
probe's is, with a made-up name served from a registry on the loopback
address and a cache apiece. The four agree on every line:

| The command, and what its environment says | What npm did |
| --- | --- |
| `npx <name>`, the name not installed | fetched the package and ran it |
| the same, `npm_config_yes=false` | asked the registry about the name, fetched nothing, and stopped: `npx canceled due to missing packages`, with the package's name |
| the same, the variable spelled `NPM_CONFIG_YES` or `Npm_Config_Yes` | the same |
| `npm exec -- <name>` | as `npx`, with the variable and without |
| `npx --yes <name>` or `npx -y <name>`, the variable false | fetched and ran |
| the variable false, and `yes=true` in the project's `.npmrc` | fetched nothing: the environment outranks the file |
| the variable set and empty | fetched and ran, as with no variable |
| the variable false, the package in npm's cache from an earlier fetch | downloaded nothing, and ran the copy in the cache |
| `npm ci`, `npm install`, `npm test`, and `npx <tool>` of a tool the project installed, the variable false | as without it, and asked the registry nothing |

So the sandbox hands a probe's `setup` and `run` lines `npm_config_yes=false`
where the person's environment does not set the variable, in whatever case.
Where it does, the variable is left as they set it: a person who set it has
said what they want. Set and empty says nothing to npm, so it is taken out
and the setting made. The line is run as it is written all the same, and
`--yes` on it fetches: the line is the person's, approved with the brief.
Through the harness, under npm 10.9.9, 11.16.0 and 12.2.0: a probe whose `run`
is `npx <name>`, `measured` with 0.10.1 by a package it fetched, is `invalid`
and fetches nothing, as is one in a project whose `.npmrc` says `yes=true`;
with `npm_config_yes=true` or `NPM_CONFIG_YES=true` in the person's
environment, or `--yes` on its line, it fetches as before; and a probe that
runs a project's script after `setup: npm ci` is as it was.

The setting is npm's alone and stops a download alone. pnpm 11.20.0 fetched
and ran the name through `pnpm dlx` and `pnpx` whatever the variable said, and
never through `pnpm exec`; yarn and bun were not on the machine, and are not
measured. A copy in npm's cache runs. And an `.npmrc` that says `yes=true` no
longer has a probe's npx fetch, since the environment outranks it: that takes
`--yes` on the line, or the variable. Linux and macOS were not measured by
hand. The integration suite runs the npm on the PATH against a registry of
its own on the loopback address - nothing fetched by default, fetched where
the person's environment says so in lower case or upper, fetched with `--yes`
on the line - so CI holds every platform and npm it runs to the same. Its
first run did, on Ubuntu 24.04 and 26.04, macOS 26 and Windows Server 2025:
npm 10.9.8 and 10.9.9 with Node 22, 11.19.0 with Node 24 and 11.19.1 with
Node 26.

**A run that proves nothing shows what its command printed.** An `invalid`
probe said that its command "exited 1 and its output does not contain" the
signature, and nothing of the output, so the reason npm gives above reached
nobody. A run that is neither red nor green - it failed for another reason,
was stopped at its timeout, or left no report that can be read - now carries
the end of what its command printed: its last 2,000 characters, as many as a
failed `setup` shows. That is every run of an `invalid` probe and any such
run of a `flaky` one. `measured`, `fixed`, `vacuous` and `still-failing` are
verdicts over red and green runs, whose evidence is the line that matched or
the pass, and they show nothing more. In the JSON document it is `output` on
each such run, and nothing is written beside the document. With the table it
is on the standard error, for the first such run of each result, under one
line: `spec-harness: probe <id> is <verdict> at <base or head>: run <n> of
<runs>: <what the run showed>; its output ended:`, or `; it printed nothing`.
The table, which a brief records and a script reads, is as it was.

What is shown is for a person to read, not for a terminal to obey. A carriage
return ends a line. A colour is dropped: it says nothing in a report, and a
command can colour what it prints with nobody at a terminal to see it. npm
11.16.0 did into a pipe where the environment said `npm_config_color=always`.
vitest 4.1.11 did not on a workstation, into a pipe with `CI`,
`GITHUB_ACTIONS` or `FORCE_COLOR` set, though the logs of this repository's
CI hold its colours on every runner. Every other control character but the
line feed and the tab is written as its escape, `\u001b`, so that an escape
sequence shows and does nothing. Space at the end and blank lines at the
start are dropped. A failed `setup`, which showed its last 2,000 characters
as they came, shows them by the same rule. The sandbox keeps the first 4 MiB
a command prints, so past that the end shown is the end of what was kept.

A command is also given no input. Its input was a pipe that nothing wrote to
and nothing closed, so a command that read it, as one does that asks a
question, waited until its timeout stopped it: measured with a five-second
timeout, `node -e "process.stdin.resume(); ..."` was stopped at five
seconds with nothing printed. It is now told at once that there is no
input, and what it does then is its own to print.

*Amended a third time 2026-10-08.* A run stopped at its timeout is answered
within three seconds of it, where it waited without bound for a process the
stop did not reach to let go of the command's output. Such a run is a
`timeout` as before, with what its command had printed by then, and its
evidence goes on from `stopped after <n> seconds` to say that something the
command started was left running, holding its output. ADR-0003 has what was
measured, and what a timeout reaches on each platform.

*Amended 2026-10-09.* **A run is judged by its command's shell.** A command
whose shell had ended while something it started still held its output was
waited for until its timeout and was then a `timeout`, so its probe was
`invalid` whatever the command had printed and however its shell had exited;
and a `setup` that left such a process stopped the probe. A command is now
answered when its shell ends, as a step is in CI: a `run` is red, green or
neither by the shell's exit code and what was printed until then, a `setup`
has passed when the code is 0, and the output is waited for three seconds
and no longer. Where it was still held then, the run's evidence goes on to
say that something the command started was left running, after the line
that matched or `the command passed`; a `setup` that passed says so on the
standard error, and one that failed in the error that stops the probe. So a
probe that was `invalid` at its timeout may be `measured`, `vacuous`, `fixed`
or `still-failing`, and one whose `setup` stopped it may be measured.

What a command leaves running is no part of its answer and is not waited
for: its work must be done when its shell ends. It runs on beside the runs
after it, as what a step left does beside the steps after it, and is stopped
when the probe is done at that commit where the sandbox can still reach it:
on Linux and macOS in the command's process group, on Windows nowhere.
ADR-0003 has what was measured, here and in CI, and why it is not stopped as
the shell ends.

## Consequences

A research round whose answer may be "no" is not a defect and needs no probe;
probes are for defect briefs. A fresh worktree has no installed dependencies
until `setup` installs them, which is slow and honest.
