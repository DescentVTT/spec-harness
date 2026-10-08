---
status: accepted
date: 2026-09-26
---

# ADR-0003: State outside the work tree, and temporary worktrees

## Context

Two things are in flight while a round runs: an escalation waiting for a
person, and a sandbox a probe runs in. The plan put the first in
`.escalation/session_*.json` in the repository and did the second with stash
and rollback. Both collide with spec-brief's ADR-0002 (the brief is the
record; no state file in the tree) and ADR-0004 (read git, never write it).

## Decision

- **In-flight state lives under the git common directory**,
  `<git-common-dir>/spec-harness/`: shared by every worktree of the
  repository, invisible to `git status`, never committed. Only outcomes are
  written into documents - a ruling becomes a row in the brief.
- **A sandbox is a detached worktree under the system temporary directory**,
  added for one job and removed after it: on success, on a throw, and on
  SIGINT, SIGTERM or SIGHUP. The person's branch, index, stash and files are
  never touched. Nothing is rolled back, because nothing of theirs changed.

*Amended 2026-09-28.* A worktree is removed only once nothing runs in it. On
Linux and macOS a probe's command leads a process group of its own, so that
its timeout can stop the group, and the terminal's Ctrl+C never reaches it:
the interrupt removed the worktree while the command ran on inside it, and on
Windows, where a running command holds its directory, failed to remove it at
all. On SIGINT, SIGTERM or SIGHUP the sandbox now stops every command still
running with everything it started, as the timeout does - SIGKILL to the
process group on Linux and macOS, `taskkill /T /F` on Windows - and waits up
to three seconds for them to let go of their output before it removes the
worktrees and exits. The wait is bounded because whatever still holds the
output after a forced stop has left the tree, and no wait would end it. After
an interrupt a command never answers the job waiting on it, so the job cannot
carry on in a worktree being removed, and the signal handlers stay installed
while the interrupt waits: a second Ctrl+C would otherwise meet Node's
default, which ends the process before any exit handler runs. When the
process exits mid-job its handler can only work synchronously: it stops the
commands the same way and cannot wait for them to end. On Windows a command
just stopped lets go of its directory a moment after `taskkill` returns, so a
worktree's directory that cannot be deleted yet is tried again, for up to
three seconds, and then reported rather than waited on further. An
interrupted process exits as a shell reports a process the signal ended, 128
and the signal's number: 130 on SIGINT, 143 on SIGTERM, and 129 on SIGHUP,
which exited 143, SIGTERM's code.

A worktree is removed, and forgotten by git, alone. Its directory is deleted
first, and `git worktree remove --force` is then run on its path. Measured
with git 2.55.0: git refuses to remove a worktree whose directory is there
without its `.git` file ("validation failed"), and removes its record of one
whose directory is gone - that worktree's entry under the repository's
`worktrees/` and nothing else, found by the path it was added at, through an
8.3 short name or a directory junction as well. The integration suite holds
both cases on every platform CI runs. `git worktree prune`, which the
sandbox ran after each removal at an interrupt and whenever one failed at
the end of a job, forgets every worktree git has lost track of: one of the
person's on a drive that is not mounted, or another tool's. It is no longer
run, and the sandbox touches `worktrees/` only through git.

*Amended 2026-10-08.* **Git is asked first, and a directory that cannot be
deleted costs its job nothing.** Measured with 0.10.0 on Windows (git 2.55.0,
Node 24.18.1): a probe whose command left a process running in the worktree
for longer than the three seconds lost its verdict to a Node stack trace,
exited 1, and left the whole checkout in the temporary directory with git's
record of it in the person's repository. Deleting the directory first is
what left the record. Where a process runs in a directory, Node deletes
nothing of it; where one runs in a directory inside it, Node deletes the
`.git` file and stops there, and git refuses a worktree without one. Asked
while the worktree is as its job left it, `git worktree remove --force`
deletes what it can and forgets the worktree whether or not it could delete
it all: it exits 255 with "failed to delete", the record is gone and the
directory is left empty.

So at the end of a job, at an exit and at an interrupt, git is asked first.
What is left of the directory is deleted next, tried for the same three
seconds. Git is asked a second time only when it refused the first, as it
does a worktree whose job deleted its `.git` file, and by then the directory
is gone. A directory still there after the three seconds is no longer an
error thrown: the job's answer stands, or what the job threw; the directory
stays on the sandbox's list and is tried once more when the process exits;
and one still there then is named on the standard error, in one line that
begins `spec-harness: the temporary worktree at`, where the exit ended in an
uncaught error before. The same probe now prints its verdict, exits by it,
and leaves an empty directory and nothing in git. A worktree whose job
deleted its `.git` file and whose directory cannot be deleted either keeps
git's record: git refuses it for as long as the directory is there.

**Ctrl+Break on Windows.** Windows has a fourth signal, SIGBREAK: Ctrl+Break,
which GitHub's runner also sends there, after Ctrl+C, to a step it cancels,
where it sends SIGTERM elsewhere (`ProcessInvoker.cs` in actions/runner).
Unhandled, it ended the harness at once, with the worktree in place,
git's record of it, and the probe's commands running on: on Windows a command
is started without a console window, in a console of its own, so no console
event reaches it, as no terminal signal reaches its process group elsewhere.
SIGBREAK is handled as the other three are, and exits 149, 128 and its
number. Measured with console events sent to a console of the harness's own:
Ctrl+C exits 130, Ctrl+Break 149 and a closed console 129, each with nothing
left behind.

A closed console is the one interrupt the system puts a deadline on: Windows
ends the process about five seconds after it. On a loaded workstation it
ended 0.10.0 before the harness had finished, once in three runs, with the
directory deleted and git's record left. Nothing in a handler lifts that
deadline. A process ended outright - `taskkill /F`, a run an agent stops -
runs no handler at all, and leaves the directory, the record and the
commands, as the Consequences say of a crash.

*Amended again 2026-10-08.* **A command is stopped by its id only while the
sandbox holds its shell.** Both ways of stopping a command name it by a
number: `taskkill /pid` on Windows, the process group elsewhere. The number
is the command's only while something holds it, and the sandbox went on using
it after. It keeps a command on its list until the command's output closes,
which is later than the end of the command's shell whenever something the
command started still holds the output, and it stopped every command on the
list by its id: at the command's timeout, ten minutes by default, at an
interrupt and again three seconds into it, and at exit. By then the id could
be another process's, and `taskkill /T /F` ends that process with everything
it started.

Measured on Windows 11 with Node 24.18.1:

- Node holds a process until it has seen it end. 64 processes that had ended,
  with Node not yet told, kept their ids through 1,500 process starts. Once
  Node had seen them end, 22 of the 64 ids were given to the next 1,500
  processes started, the first after 264.
- With eight workers starting processes at once, as the suite's do, an id
  came back 1.4 seconds after its holder ended at the soonest, at 143 starts
  a second, and 5.3 seconds after with node and git at 28 a second: never
  inside a second, and at the faster rate inside the three seconds after
  which an interrupt stops the commands a second time.
- Given the id of a root that has ended while something the root started
  still runs, `taskkill /T /F` exits 128, "not found", and stops nothing: it
  finds no tree under a root that is gone.
- A process ended by `taskkill /F`, or by Node's SIGKILL, reports exit code 1
  and no signal: to whatever waits on it, a tool that failed and said
  nothing.

So the sandbox reads what Node has seen of the shell: until `exitCode` or
`signalCode` is set, Node holds the shell, on Windows by its handle and
elsewhere as a child not yet collected, and the system gives the id to
nothing else. A command whose shell is held is stopped as before, with
everything it started.

On Windows a command whose shell has ended is no longer stopped: not at its
timeout, not at an interrupt, not at exit. Nothing is lost by it: what the
command left running was out of taskkill's reach already, and runs on until
it ends, as it did. A command whose timeout has passed still answers as
stopped at it once its output closes, and an interrupt still waits its three
seconds for one.

On Linux and macOS the shell's id also names its process group, and the
system keeps the id of a group from new processes for as long as the group
has a member (POSIX, Process ID Reuse). Measured on Linux 5.15, in a process
namespace of its own: with one process left in the group of a leader that had
ended, 99,694 process starts went round every id and none was given the
group's; once that process had ended, the next time round the id went to the
process started when its turn came, and that one led a group, so a group of
the id existed again and was not the first command's. So what a shell left in
its group is still stopped after the shell has ended, as before, unless a
process has the id by then, which says the group emptied and the id was given
out again: then nothing is signalled.

One case is left that the sandbox cannot tell from its own group: a process
that was given the id after the group emptied, led a group of its own, left
members in it and ended, all before the command's timeout, on a system that
had gone round every id meanwhile. Closing it takes a shell the sandbox holds
for as long as it waits on the command, which is a change to how a command is
started. macOS was not measured.

The integration suite had the fault in its own cleanup: after each test it
sent SIGKILL to the ids the test's commands had written to files, which the
processes no longer had whenever the test had passed, with every other test
file running beside it. A process a test's command starts now makes itself
known over a connection to the test, which closes when the process ends and
over which it is told to end; one the test starts itself is stopped through
its handle. On 2026-10-07 a Windows job
failed an audit test with `spec-guard exited 1 without JSON` and nothing
after it, which is how a process ended from outside reads, while the sandbox
tests were sending such signals in another worker during the same seconds.
The job's log names no ids, so what ended that sibling is not proven.

*Amended a third time 2026-10-08.* **A timeout ends the wait, and what a
timeout and an interrupt reach is said for each platform.** A command is
answered when its output closes. At its timeout the sandbox stopped what it
could and went on waiting for that, with no bound, where an interrupt has
waited three seconds at most since 2026-09-28. So a command whose output was
held by a process the stop did not reach answered when that process ended,
and its probe with it: never, for a process that does not end.

Measured with 0.11.0 on Windows 11 (Node 24.18.1, cmd) and on Linux 5.15
(Node 24.21.0, dash, in a container): a command with a timeout of two seconds
whose line leaves a process that holds its output for twelve, and how long
the command took to answer.

| What the line left holding its output | Windows | Linux |
| --- | --- | --- |
| Nothing: the command itself runs on | 2.3 s | 2.0 s |
| A process Node started `detached`, its parent ended, the shell ended | 12.5 s | 12.1 s |
| The same, while the shell still runs another command | 12.6 s | 12.1 s |
| What the shell puts in the background: `start /b`, and `&` | 12.3 s | 2.0 s |
| `setsid`, in the background | | 12.0 s |

Each twelve is the process ending by itself. On Linux `&` leaves the process
in the command's group, where the group's signal finds it after the shell has
ended. On Windows `start /b` leaves it under a shell that has ended, which is
no longer stopped by its id (above). In the third row taskkill ended the
shell and the command it was running, and not the process whose parent had
ended: it follows a tree from parent to child, and finds that process under
no root. Through `probe` on Windows, with a process that stays: no end in two
minutes.

So the timeout bounds the wait. A command is stopped at its timeout as
before. Three seconds later - the bound an interrupt has, and for its reason:
what a forced stop reached is gone in the time the system takes to end it,
and no wait ends the rest - the sandbox closes its own ends of the command's
output and answers: stopped at its timeout, with what was printed until
then, and with its output still held. Each twelve above became 5.0 seconds,
5.3 in the third row on Windows, and the other rows are as they were. `probe`
on Windows, over a run with a five-second timeout, ended inside 17 seconds:
the five, the three of the bound, and three more twice for a directory that
cannot be deleted, as said above of one.

- **What holds the output is not stopped.** The sandbox has no id of it: a
  process out of the group and out of the tree is what no id the sandbox
  holds leads to. It runs on until it ends or a person ends it.
- **The output is let go, not left open.** Node does not end while one of a
  command's streams is open. With the two left open, on both systems, the
  command answered after five seconds and the process that had run it could
  not end before the twelfth, when the holder did; and `probe`, with a
  process that stays, did not end in two minutes. Closing them is what the
  end of `probe` does to that process, sooner. Measured on both systems: a
  Node process writing to an output whose reader had exited had its next
  write fail with `EPIPE` and ended with code 1; one whose reader was the
  sandbox, letting go, did the same; and one that wrote nothing ran its
  twelve seconds.
- **A person is told where the run is told of.** The run's evidence, which
  says `stopped after <n> seconds`, goes on `, and something it started was
  left running, holding its output`: in the table, in the line on the
  standard error, and in the JSON document's `detail`. A `setup` so stopped
  says it in the error that stops the probe. A `setup` stopped at its timeout
  said only that it `failed`, with whatever it had printed, which may be
  nothing: it now says `was stopped after <n> seconds`.
- **The worktree is removed as any other.** On Windows the process runs in
  the worktree, where its command ran, so the directory cannot be deleted:
  git forgets the worktree and the directory is named as `probe` exits, as
  above. On Linux and macOS it is deleted under the process. A later run of
  the probe starts in the same worktree while the process still runs.

**What a timeout and an interrupt reach.** Both stop a command that has not
answered yet, in the same way, as the exit of the process does, and nothing
else:

- On Linux and macOS, every process still in the command's process group,
  whether or not the command's shell has ended. Not a process that moved to
  a session or a group of its own, as a daemon does, `setsid`, and a process
  Node starts `detached`.
- On Windows, the command's shell and the processes under it, each found
  through a parent that still runs. Not a process whose parent has ended;
  and once the shell itself has ended, nothing the command left.
- On neither, a process that a command left running after the command had
  ended and its output had closed: the sandbox holds nothing of that command
  any more. On Linux a process put in the background with its output sent to
  a file was such a one: its command answered 0 at once, and it ran its
  twelve seconds, through the end of the process that had run the command.
  On Windows `start /b` with the output sent to a file still held the
  command's output, and the command answered at its timeout, as held:
  sending a process's own output elsewhere does not take the command's from
  it there.

"With everything it started", which this record and the README said of a
timeout and of an interrupt, was true of a command whose processes stay in
its group or under its running shell, and of no other.

Not changed: a command whose shell has ended is still waited for until its
output closes or its timeout passes, so a `setup` that leaves a server
holding the output takes its whole timeout and then stops the probe. Ending
the wait when the shell ends would change which runs are red and which
green. Not reached: a shell that a forced stop does not end. None was
produced, so this is read from the code and not measured: its command is
answered at the bound all the same, since the answer does not wait for the
shell, and Node then waits for that shell before it ends.
macOS was not measured by hand: the integration suite runs there, and holds
on every platform that a command left with its output held is answered once
the bound has passed, that what holds it runs on, and that `probe` ends.

## Consequences

`git worktree add` is the one git write in the family, bounded to a directory
the tool created and deletes. A crash that skips every handler leaves a
directory in the temporary directory and an entry `git worktree prune`
removes.
