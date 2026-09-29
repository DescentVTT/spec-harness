---
status: accepted
date: 2026-09-26
---

# ADR-0006: A ruling is a row whose commit a person signed

## Context

When a round cannot finish without touching what its brief protects, a person
must decide. The plan recorded the decision with a SHA-256 of token, option,
time and actor. The agent can compute that hash as well as anyone, so it
proves nothing about who decided.

## Decision

- An agent **escalates**: `spec-harness escalate --path … --reason …`, or the
  `request_escalation` MCP tool, records the request under
  `<git-common-dir>/spec-harness/escalations/` and prints a memo: what, why,
  the options and what each costs, and the agent's recommendation.
- A person **rules**: `spec-harness rule <id> --allow|--deny --note …` writes
  one row into the brief's `## Rulings` table
  (`| Ruling | Paths | Decision | Note |`), and the person commits it
  **signed**.
- A row **counts** when the commit that last changed it - `git blame` of that
  line as the file on disk has it, so an uncommitted row has no commit and
  cannot borrow a signed line's - carries a good SSH signature by a principal
  in the allowed signers file **as the base branch has it**
  (`.github/allowed_signers` by default). The round's own tree cannot add a signer, and an edit to the row
  by anyone moves the blame to a commit that must be signed again.
- Verified `allow` rulings let the guard pass the paths they name, and let
  spec-brief's archive accept a protected file they cover, through the
  spec-brief plugin this package ships.

**A signature is only as strong as the key's isolation.** An agent running as
the person, with the key loaded where it can reach it, can sign. The
recommendation is a FIDO2 key (`sk-ssh-ed25519@openssh.com`), whose
signature needs a touch no process can supply, or a signing key the agent's
account cannot read.

*Amended 2026-09-30.* doctor notes each signer in the allowed-signers file on
the base whose key is not a FIDO2 key, `sk-ssh-ed25519@openssh.com` or
`sk-ecdsa-sha2-nistp256@openssh.com`, reading the file as OpenSSH does:
principals, any options, the key type and the key. It is a note, never a
failure. This decision accepts a key the agent's account cannot read as well
as a FIDO2 key, and a hardware key reached through PIV or PKCS#11 is written
as a plain `ssh-rsa` or `ecdsa` line, so a failure on the key type would
refuse keys this decision accepts. A `cert-authority` line holds a
certificate authority's key; the keys it certifies are not in the file, so
it is left out. init's advice names the file `rulings.allowedSigners`
names, where it named `.github/allowed_signers` whatever the configuration
said, and a FIDO2 key made with `ssh-keygen -t ed25519-sk`.

## Consequences

No new format, service or network: git, OpenSSH 8.1 or later (2019), and an
allowed-signers file the forge's branch protection already guards. A forge
that squash-merges re-signs with its own key, so rulings are verified on the
branch, before the merge.
