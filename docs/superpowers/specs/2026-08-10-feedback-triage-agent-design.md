# Feedback triage agent — design

**Status:** revised 2026-09-04 after review. Plans 1 and 2 implemented as operator tooling; not deployed. Agent infrastructure remains unimplemented.
**Revision 1, 2026-09-04:** closes seven review findings — a trust boundary for
the prompt-injection surface, a feedback-level advisory lock, queue membership by
`category` rather than `triaged_at`, an explicit at-most-once delivery model,
disposable worktrees for agent git work, effective-fix-SHA selection for
duplicates, and validation of persisted email requests before replay.
**Revision 2, 2026-09-04:** closes four more — `list --pending` for the crash
gap between `triage` and `email`; a real broker process behind a Unix socket in
place of an asserted credential boundary; an agent-owned bare mirror so
worktrees do not touch Jason's checkout; two-lock ordering for dedupe. Delivery
now separates authentication failures (pause and alert) from recipient-level
ones (dead-letter), and dead letters alert actively.
**Revision 3, 2026-09-04:** brokers the GitHub token as well, so the agent holds
no credential of any kind; adds `replay-pending` so a network-failed send is
actually retried rather than silently aging into a dead letter; fixes the stale
"writes a body file" wording; moves `FEEDBACK_WEBHOOK_URL` behind the broker.
**Revision 4, 2026-09-04:** removes the privilege inversion introduced by
revision 3 — privileged git no longer runs inside an agent-writable repository;
the boundary is crossed by a **patch**, not a repository. Adds a model
credential proxy so the agent's own inference credential is not readable by it
either, and constrains patch submission to a server-derived branch namespace.
**Revision 5, 2026-09-04:** gives the fix its own durable state
(`fix_status` and friends, `list --fix-pending`, idempotent
`submit-patch`/`open-pr`, and a `reconcile-fixes` repair verb), so a classified
bug can no longer vanish after its acknowledgement; adds the normative
principal/credential/route table and a second socket for `repos-git`; widens the
privacy test to the patch body.
**Revision 6, 2026-09-04:** resolves four invariants the principal split
created — `reconcile-fixes` becomes the sole writer of the **remote-derived**
`fix_status` transitions, `triage` and `defer` keeping the local ones (the git
principal has no database and cannot call the broker); a revised patch advances
the branch by a fast-forward replacement commit rather than the force push the
constraints forbid; duplicates are `n/a` and never enter the fix queue while
still receiving effective-SHA resolved notices; and patch privacy is enforced by
a broker-signed approval over the patch digest rather than asked of the agent.
**Author:** Claude, with Jason.
**Supersedes nothing.** Extends the W7 feedback capture surface (migration 070).

## Problem

RepOS captures feedback and does nothing with it. `POST /api/feedback` writes a
row, an advisory Discord webhook fires, and `/admin/feedback` lists the queue.
Everything after capture is manual, and nothing is manual enough to have
happened: **all three production rows are untriaged**, the oldest from
2026-06-26.

Now that real invited users are on the app (W9), feedback arrives from people
who are owed an answer. This design makes an agent monitor the queue,
classify it, reply to the submitter, and open fixes.

## Goals

- Feedback is classified within hours of arriving, without Jason reading it first.
- Every submitter who left an address hears back — once when the item is
  triaged, once when the fix is live. A send that cannot be confirmed inside
  Resend's 24-hour idempotency window is abandoned rather than risked twice, and
  surfaced to a human instead (see *Delivery model*).
- Clear-cut bugs arrive as pull requests with a failing test, not as a to-do.
- A submitter is never emailed twice about the same item, even if the agent
  crashes mid-run or a machine reboots.
- "Your bug is fixed" is only ever said about code that is genuinely running in
  production.

## Non-goals

- Inbound email. Replies land in Jason's inbox and are handled by a human.
- Merging or deploying. The agent opens PRs; Jason merges, CI gates.
- A web UI for triage. The existing `/admin/feedback` page stays as-is.
- Handling volume. This is designed for a beta cohort capped at 10, not a
  support desk.

## Decisions

Settled with Jason on 2026-08-10:

| Question | Decision |
|---|---|
| Autonomy | Full loop, including sending user replies without prior approval |
| Trigger | Scheduled sweep, a few times a day |
| Reply policy | Acknowledge on triage, notify on ship. Two emails max per item |
| Runtime | This workstation |
| State | The database is the source of truth (approach A) |
| Tone for conversational/junk feedback | Snarky and funny. **No rules** — every current tester is someone Jason knows personally. Revisit when that stops being true |

## Trust boundary

**The feedback body is attacker-controlled input.** `FeedbackCreateSchema`
accepts up to 4000 characters of free text from any authenticated user
(`api/src/schemas/feedback.ts:8`), and a headless coding agent then reads it and
acts on it — writing code, drafting mail to the submitter, and asking for a pull
request. Text written by someone else, read by an
agent that can act, is a prompt-injection surface regardless of who that someone
is. *"Only people I know get invited"* is a **tone** policy — it was Jason's
answer to how snarky the replies may be. It is not a security boundary, and this
section does not treat it as one. The cohort will also change; the boundary
should not have to.

The design already splits work by judgment: mechanical verbs are tested code,
and only classification, copy and fixes are left to the agent. Extending that
split to *capability* is what closes the injection surface:

- **A broker process owns every credential; the agent owns none.** An earlier
  draft said the CLI "holds the SSH identity itself" while running as the agent
  user. That is not a boundary — a credential an ordinary CLI can read as the
  agent user is a credential the agent can read directly, and any instruction in
  a feedback body could tell it to. The privilege has to live in a *different
  security principal*, not in a different source file.

  `repos-feedback-broker` is a systemd **system** service running as its own
  account, `repos-broker`. It holds `RESEND_API_KEY`, `FEEDBACK_WEBHOOK_URL`,
  the Unraid SSH identity and `DATABASE_URL`, loaded via systemd
  `LoadCredential=` from files owned by `repos-broker` and mode `0600`.
  The GitHub token is deliberately *not* here — it belongs to `repos-git`, so no
  single principal holds both the mail credential and the write credential. It listens on a Unix domain socket,
  `/run/repos-feedback/broker.sock`, mode `0660`, group `repos-agent`. The agent
  account is in that group and **socket access is the entire grant**: it can
  send a request and read a reply, and it cannot read the key files, the SSH
  identity, or the database.

- **The agent has no database access either.** Every verb is a request over one
  of two sockets — the broker's for anything touching mail or the database, and
  `repos-git`'s for the two git verbs. See *Principals, credentials and routes*
  for the authoritative split. The CLI the agent runs is a thin client with no
  secrets in it.

- **No path arguments cross the boundary.** `--body-file` is removed. A
  privileged process that reads a path supplied by a lower-privileged caller is
  an arbitrary-file-read oracle: the agent could pass the broker its own
  credential file and have the bytes mailed to a submitter. Email copy is sent
  as **bounded inline content** in the request — subject, text and html, each
  length-capped — and never as a reference to something the broker must go and
  read.

- **The broker re-derives everything security-relevant server-side.** The
  recipient comes from that row's `user_email_at_submit` in the database, never
  from the request. `from` comes from the broker's own configuration. The
  idempotency key is computed from `(kind, feedback_id)`. The agent supplies
  prose and nothing else; it cannot name a recipient even if it tries.
- **The GitHub credential is brokered too. The agent holds zero credentials of
  any kind.** Handing the agent even a narrow token would have contradicted the
  claim two bullets up: a token in the agent's environment is a string the agent
  can read, and an injected instruction could have it written into email prose
  sent to the submitter who supplied the instruction, or committed to a pushed
  branch. "Cannot exfiltrate a credential" has to mean *all* of them.

  This is cheap here because **the repository is public**: the agent fetches and
  clones its mirror anonymously and needs no credential to read. Only writes
  need one, so `submit-patch` and `open-pr` are brokered verbs. The token is
  scoped to create branches and open pull requests on this repository only — no
  merge, no
  `workflow` scope, no secrets, no admin, no other repository — and it is held
  by `repos-git`, a **third** principal, not by the broker and not by the agent.
  The agent submits a **diff**, never a repository; see *Privileged git never
  runs inside an agent-writable repository*.

  `main` is protected and requires 8 passing checks, so the worst case of a
  poisoned agent remains a bad PR that a human declines — the normal review
  path, not a new one.

- **The repository being public cuts both ways.** Branches, commit messages and
  PR bodies the agent creates are world-readable the moment they are pushed.
  Submitter email addresses and verbatim feedback bodies must therefore never
  appear in a branch, a commit message, a test fixture, a patch hunk or a PR
  description. The agent references feedback by `id`; the broker is the only
  component that ever sees an address. This is **enforced rather than asked
  for** — see *The patch is approved by the broker before `repos-git` will push
  it*, since a rule the agent could simply disobey would protect nothing.
- **The agent's own model credential is brokered too.** Claude Code must
  authenticate to run at all, and an OAuth token or API key sitting readable in
  the agent's environment is the original exfiltration path wearing a different
  name: an injected instruction could read it and place it in email prose bound
  for the person who supplied the instruction. "Zero credentials" is not true
  while that file exists.

  The agent's `ANTHROPIC_BASE_URL` therefore points at a **loopback proxy**
  owned by its own principal, which injects the `Authorization` header and
  forwards upstream. The agent can make inference calls and cannot read the
  credential that authorises them. It is the same shape as the broker: the
  capability is reachable, the secret is not.

  Stated honestly, this bounds theft, not abuse. A poisoned agent can still
  *spend* through the proxy. That is a quota problem rather than a credential
  problem, and the proxy is the place to rate-limit it if it ever matters.

- **The skill frames the body as data.** It is passed inside an explicit
  delimiter and labelled untrusted, with the standing rule that instructions
  found *inside* a feedback body are content to be classified, never directions
  to follow. A body that tries to issue instructions is itself a strong `noise`
  signal, and the snark reply handles it.
- **The agent never sends mail directly.** It submits the copy inline over the
  socket; `email` validates the category transition, derives the recipient and
  the sender, and holds the Resend key.

### Principals, credentials and routes

The single normative statement of who holds what and who answers which verb.
Prose elsewhere in this document describes; **this table decides**.

| Principal | Holds | Serves | Reachable by |
|---|---|---|---|
| `repos-agent` (the agent) | nothing | — | — |
| `repos-broker` | `RESEND_API_KEY`, `FEEDBACK_WEBHOOK_URL`, Unraid SSH identity, `DATABASE_URL`, Ed25519 signing key | `list`, `triage`, `email`, `link`, `defer`, `replay-pending`, `check-shipped`, `reconcile-fixes`, `approve-patch` | agent, over `/run/repos-feedback/broker.sock` (`0660`, group `repos-agent`) |
| `repos-git` | GitHub write token, and the broker's Ed25519 **public** key | `submit-patch`, `open-pr` | agent, over `/run/repos-git/git.sock` (`0660`, group `repos-agent`) |
| model proxy | Anthropic credential | inference forwarding | agent, over loopback via `ANTHROPIC_BASE_URL` |

> **Implementation status (2026-09-07):** Plan 1 (`502e96d`) implemented triage, the email ledger and delivery. Plan 2 implements ship detection, the fix lifecycle, patch approval and `repos-git` as tested libraries plus operator CLI verbs. Neither plan is deployed. The broker daemon, both sockets, separate OS principals, model proxy, agent and sweep remain Plan 3. Until then the CLI runs at operator trust level; its generic patch scan is not yet the broker's row-aware privacy check, and source import tests do not establish the OS credential boundary.

**Two sockets, not one.** An earlier draft said every verb went to the broker
socket while `repos-git` performed the git work, which would have meant the
broker proxying into the git principal — putting the mail-and-database principal
on the path of every push and re-coupling the two credentials this design just
separated. The agent talks to each principal directly instead, and neither one
can invoke the other.

### The patch is approved by the broker before `repos-git` will push it

Privacy of the patch cannot be `repos-git`'s job: it deliberately has no
database, so it does not know the submitter's address or the feedback body and
cannot tell whether a diff leaks them. Left there, the rule would only ever test
whether the agent chose to obey it — which is precisely the thing an injected
instruction attacks.

The check therefore happens where the data is, and travels as a **signed
approval** rather than as a call:

1. The agent submits the diff to the **broker** (`approve-patch --id --diff`).
   The broker holds the feedback row, so it can scan the diff for that row's
   `user_email_at_submit`, for verbatim runs of the feedback body, and for its
   own secrets. Any hit is a rejection with a reason.
2. On success the broker returns a detached **Ed25519 signature** over
   `(feedback_id, base_sha, patch_digest, expiry)`. It signs; it does not
   transmit anything to `repos-git`.
3. The agent presents the diff plus that approval to `repos-git`, which holds
   only the broker's **public** key — not a secret, so this shares no
   capability. It recomputes the digest of the diff it actually received,
   verifies the signature covers that digest, checks the expiry, and refuses to
   push otherwise.

The digest binds the approval to exact bytes, so the agent cannot get one patch
approved and push another. Neither principal calls the other at any point; the
agent carries the token, and a token it forges will not verify.

**Neither principal needs to call the other, and neither needs the other's
data.** `repos-git` derives the branch name from the feedback id alone — a pure
function, no database — and validates the submitted base SHA against its own
clone with `git merge-base --is-ancestor <base> origin/main`. It never gets a
database handle, so a compromised `repos-git` can push a branch and cannot read
a submitter address or send mail.

The broker, in turn, does not need `repos-git` to report back. Because the
repository is **public** and the branch name is **derived**, the broker
rediscovers remote state anonymously over HTTPS — no credential, no token, no
cross-principal call. That is what makes the fix lifecycle below recoverable
rather than merely recorded.

What this buys, stated precisely: an injected instruction cannot exfiltrate a
credential, open a connection to production, mail a third party, or reach the
database directly, because none of those capabilities exist in the agent's
principal. What it does **not** buy: a poisoned agent can still write a bad
patch or rude prose. Those are bounded by CI and Jason's review on a protected
branch, and by the broker's own transition rules — not by this boundary. The
machine is not sandboxed and commits are not signed; neither is claimed.

## Data model

Migration **`094_feedback_triage.sql`**. The number matters: the 08x range is
shared between W9 and origin's own migrations, and production is applied through
`093_cardio_logs`.

### Classification columns on `feedback`

| Column | Type | Purpose |
|---|---|---|
| `category` | TEXT, CHECK in (`bug`,`ux`,`feature`,`question`,`noise`) | what it is |
| `severity` | TEXT, CHECK in (`p1`,`p2`,`p3`), NULL for noise | how much it matters |
| `triage_note` | TEXT | why it was classified that way, in the agent's words |
| `dedupe_of` | BIGINT REFERENCES feedback(id), CHECK not self | canonical row when the same thing is reported twice |
| `fix_commit_sha` | TEXT, CHECK full lowercase 40-hex SHA | set when the fix merges; NULL until then |
| `fix_status` | TEXT, CHECK in (`n/a`,`needed`,`patch_submitted`,`pr_open`,`merged`,`deferred`) | where the fix itself has got to |
| `fix_base_sha` | TEXT, CHECK full lowercase 40-hex SHA | the pinned `origin/main` the patch applies to |
| `fix_patch_digest` | TEXT | SHA-256 of the submitted diff; makes resubmission idempotent |
| `fix_branch` | TEXT | derived `feedback/<id>`, recorded once observed on the remote |
| `fix_pr_number` | INT | the open pull request |

`triaged_at` already exists and keeps its meaning — which is precisely why it
**must not** define queue membership. `PATCH /admin/feedback/:id/triage`
(`adminFeedback.ts:40`) does exactly one thing:
`SET triaged_at = COALESCE(triaged_at, now())`. It sets no category, no
severity, and sends no email. Since the admin UI is explicitly retained as a
non-goal-to-remove, any row a human clicks there would vanish from a
`triaged_at IS NULL` queue while never being classified or answered — a silent
drop, and the worst possible failure for a design whose whole point is that
everyone hears back.

**Queue membership is therefore `category IS NULL`.** `triaged_at` means "a
human or the agent has looked at this"; `category` means "it has been
classified". Only the latter gates the agent's work.

**That leaves a second queue, and it must exist.** `triage` and `email` are
separate verbs, so the moment `triage` commits a `category` the row leaves
`list --untriaged` — and if the sweep dies before `email` creates its ledger
row, nothing selects the row ever again. It is classified, unanswered, and
invisible. Making the two verbs one transaction would not fix it either, since
the send deliberately happens *after* the commit.

`list --pending` closes the gap: rows with a non-NULL `category` and a
`user_email_at_submit`, whose required first email — `reply` for
`noise`/`question`, `ack` otherwise — has no `feedback_emails` row at all.
This is specifically the *no row was ever written* case.

**The written-but-unsent case needs its own verb, and it was missing.** A send
that failed on the network leaves a ledger row with `sent_at IS NULL` — which
`list --pending` deliberately excludes, and which `list --untriaged` never
returns because the row is classified. Nothing selected it, so the "retries on
the next sweep" policy below was fiction: the row would have sat untouched until
it aged past 24 hours and was dead-lettered without a single retry ever being
attempted.

`replay-pending` is the mechanical fix. It selects every `feedback_emails` row
with `sent_at IS NULL` and `dead_lettered_at IS NULL`, validates each persisted
request, and re-sends it under its original key and bytes — or dead-letters it
if it is out of time. It requires no judgement and takes no agent input, so it
is a pure CLI/broker operation. Every sweep drains
`list --pending` before it looks at new feedback, so a crash costs one sweep
interval rather than the item.

Backfill: rows that already have `triaged_at` set but no `category` stay in the
queue and are processed normally. In production this is currently a no-op —
verified 2026-09-04, all three rows have `triaged_at IS NULL` — but the
divergence is ongoing rather than historical, so the rule matters more than the
backfill.

### New table `feedback_emails`

```sql
CREATE TABLE feedback_emails (
  id              BIGSERIAL PRIMARY KEY,
  feedback_id     BIGINT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('ack','resolved','reply')),
  request         TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  message_id      TEXT NULL,
  sent_at         TIMESTAMPTZ NULL,
  error           TEXT NULL,
  attempts        INT NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ NULL,
  last_attempt_at  TIMESTAMPTZ NULL,
  dead_lettered_at TIMESTAMPTZ NULL,
  UNIQUE (feedback_id, kind)
);
```

**`UNIQUE (feedback_id, kind)` is a load-bearing part of this design.** It makes
same-kind deduplication a schema guarantee rather than something the agent has
to remember. The service additionally enforces the allowed state transitions:
`reply` is exclusive with `ack` and `resolved`, and `resolved` is only created
by deployment verification. Together those rules enforce the two-email maximum.

Every mutation of a feedback row and its emails takes a session-level advisory
lock keyed on the **`feedback_id` alone** — never on `(feedback_id, kind)`.
A per-kind lock would not serialize the operations that actually conflict:
`ack` and `reply` are mutually exclusive but hash to different keys, so two
concurrent calls would each see no conflicting row and both commit, defeating
the exclusivity rule while still satisfying `UNIQUE (feedback_id, kind)`. The
unique constraint stops same-kind duplication; only a feedback-level lock stops
cross-kind duplication. `triage` takes the same lock, so a reclassification
cannot race a send.

Holding that lock, the service freezes the request, inserts the row, and
**commits before** making the network request. A crash mid-send therefore leaves durable evidence rather than a
silent gap. `request` holds the frozen bytes so a retry replays verbatim under
the same key instead of re-rendering. An existing row with `sent_at` set is a
no-op; an unsent row replays its persisted request **after validating it**.

A persisted request has round-tripped through storage and is untrusted by the
time it comes back. Before any replay, `assertFeedbackRequest(r, expectedTo)`
— mirroring `assertInviteRequest` in `inviteMailer.ts`, which already does
exactly this — must hold:

- exactly one recipient, equal to that row's `user_email_at_submit`, so a
  corrupted or tampered row can never mail a third party;
- `from` equal to `FEEDBACK_FROM_EMAIL`, so a rewritten row cannot spoof a
  sender;
- every field present, correctly typed and non-empty — validate, never default;
- the idempotency key recomputed from `(kind, feedback_id)` and compared against
  the stored `idempotency_key`; a mismatch is a hard failure, not a repair.

All agent-authored copy is **HTML-escaped** before interpolation into the
template. The agent writes words, never markup.

This is the Q30 lesson from `inviteMailer.ts` applied unchanged: when an
external API keys on request identity, freeze the request at first attempt.
Deriving the key from a re-rendered request is the same bug wearing a hash.

A separate table rather than more columns on `feedback`, because the uniqueness
constraint is expressible only this way, and because a failed send needs
somewhere to record `error` without polluting the feedback row.

## State machine

```
new  →  classified (category, severity, triaged_at)
          ├── noise / question  → ONE email, kind='reply' → terminal
          └── bug / ux / feature → email kind='ack'
                                    → fix merges  (fix_commit_sha set)
                                    → fix reaches prod → email kind='resolved' → terminal
```

The three `kind` values map one-to-one onto the three templates. `reply` is the
terminal one-shot used for both the snark (noise) and a direct answer
(question); those items never enter the ack/ship cycle, so they can never
receive an `ack` or `resolved`. A row therefore holds at most two email rows —
`ack` + `resolved` — or exactly one `reply`.

Noise is terminal on purpose: a joke submission gets one funny reply and no
lifecycle.

Rows with a NULL `user_email_at_submit` are classified and triaged, and the
email step is skipped with the reason recorded in `triage_note`.

### The fix has its own durable state, because otherwise it is lost

Up to revision 4 a classified bug vanished the moment its acknowledgement was
sent. It was excluded from `list --untriaged` (it has a `category`), from
`list --pending` (it has a ledger row), from `replay-pending` (that row is
sent), and from `check-shipped` (`fix_commit_sha` is NULL until `link`). A crash
anywhere between `ack`, `submit-patch`, `open-pr` and `link` stranded it
permanently, and a response lost *after* a successful push left a branch nobody
would ever look at again. That directly contradicted the stateless-sweep claim:
a sweep can only be stateless if the state it resumes from is in the database.

`fix_status` supplies it:

```
n/a          noise / question — no fix is expected
needed       classified as bug/ux/feature, acknowledged, no patch yet
patch_submitted   branch pushed at fix_base_sha with fix_patch_digest
pr_open      fix_pr_number is open
merged       fix_commit_sha recorded; check-shipped now owns the row
deferred     terminal, no fix planned — reason in triage_note
```

`deferred` matters as much as the rest: a feature request nobody intends to
build would otherwise sit in the fix queue forever. It is terminal and requires
a recorded reason. The `ack` copy must therefore not promise a fix, only that
the item was received and read.

**A duplicate never enters the fix queue.** Its canonical row owns the fix, so a
row with `dedupe_of IS NOT NULL` is `n/a` regardless of category, and `triage`
sets it that way when it assigns `dedupe_of`. A row already in `needed` that is
*later* recognised as a duplicate transitions to `n/a` in the same transaction.
Without this, two rows describing one bug would each get a worktree, a patch and
a pull request for the same defect.

This costs the duplicate's submitter nothing: they still receive their own `ack`,
and `check-shipped` still notifies them when the fix ships, because it selects on
the **effective** fix SHA resolved through `dedupe_of` rather than on the row's
own. The duplicate is excluded from doing the work, not from hearing the outcome.

One consequence to be explicit about: if a canonical row is `deferred`, its
duplicates are never notified either, because there is no fix to ship. They keep
their acknowledgement and the reason lives in the canonical row's `triage_note`.

`list --fix-pending` returns rows in `needed`, `patch_submitted` or `pr_open`
with `dedupe_of IS NULL`, oldest first, and is drained as its own sweep step.

**Every transition is idempotent, and recovery does not depend on having been
told.** Because the branch name is derived from the feedback id and the
repository is public, the true state is always observable:

- `submit-patch` — if `fix_branch` already exists on the remote at the same
  `fix_patch_digest`, it is a no-op returning the existing branch. A different
  digest is a revision of the fix, and is applied as a **fast-forward
  replacement commit**: `repos-git` builds the tree that the new patch produces
  on the pinned base, then commits it with the *current branch tip as parent*.
  The tip advances, the content becomes exactly the new patch, and the update is
  an ordinary fast-forward. This matters because force and non-fast-forward
  pushes are refused outright — an earlier draft said the branch was "replaced",
  which those constraints made impossible. Nothing is ever rewritten or deleted.
- `open-pr` — if a pull request already exists with that head branch, it is
  returned rather than duplicated.
- `reconcile-fixes` — **the sole writer of every remote-derived `fix_status`
  transition**, namely `patch_submitted`, `pr_open` and `merged`. The states
  that reflect a local decision rather than remote reality — `needed` and `n/a`
  from `triage`, `deferred` from `defer` — are written by those broker verbs, and
  the two sets never overlap. `repos-git` has no
  database and cannot call the broker, so it cannot advance the column and does
  not try: `submit-patch` and `open-pr` return their result to the agent and
  change nothing in the database. The truth is instead *observed*. For every row
  not in a terminal state, `reconcile-fixes` reads the remote anonymously and
  heals the row to match: branch present while `fix_status` is `needed` →
  `patch_submitted`; PR found → `pr_open` with its number; PR merged → `merged`
  with the squash SHA written to `fix_commit_sha`, the same fact `link` records
  by hand.

  Having exactly one writer for the remote-derived states is what makes the
  lifecycle honest: for anything that happened on GitHub, the database records
  what the remote actually shows, never what a verb reported or an agent
  claimed. It is why `reconcile-fixes` runs **both first and last** in every
  sweep — first so decisions are made against reality, last so work done during
  the sweep is recorded before the run ends rather than waiting four hours. A
  lost response costs one sweep at worst, and usually nothing.

`link` remains for the case where a human merges something the agent did not
push.

Duplicates keep their own ack. When the canonical row's fix ships, the resolved
email is sent to the duplicate's submitter too, traversing `dedupe_of`.
`triage` only accepts a canonical row (`dedupe_of IS NULL`) as the target and
rejects self-references, chains, and cycles in the same transaction.

**Setting `A.dedupe_of = B` locks both A and B**, not just A. Locking only the
row being modified leaves the check racy: while A is being pointed at B, a
concurrent call can point B at C, and both commit having each seen a valid
canonical target. The result is the A→B→C chain the rule exists to forbid. The
two locks are always taken in **ascending `feedback_id` order** so two dedupe
operations touching the same pair cannot deadlock against each other.

## Ship detection

The resolved email must not be a guess. A merged PR is not a deployed fix — this
week produced two separate occasions where `main` was ahead of production.

Each sweep:

1. Reads the deployed SHA from the production container on Unraid (`APP_SHA`,
   verified present: it is baked into the image), through the configured
   `UNRAID_SSH` host (default `unraid`).
2. Runs `git fetch origin main`, then selects every row that has no `resolved`
   email and whose **effective fix SHA** is non-NULL. The effective fix SHA is
   `COALESCE(own fix_commit_sha, canonical row's fix_commit_sha via dedupe_of)`.
   Selecting on the row's own `fix_commit_sha` would be wrong: a duplicate never
   carries one, so every duplicate would be excluded from the very step meant to
   include it, and its submitter would be acked and then never told the fix
   shipped.
3. For each selected row asks
   `git merge-base --is-ancestor <effective_fix_sha> <deployed_sha>`, and sends
   only on a true answer.
4. A duplicate is therefore notified using its canonical row's SHA, on its own
   `feedback_emails` row, to its own submitter. Canonical and duplicates fan out
   from one ancestry check rather than one per row.

Both SHAs must be full lowercase 40-hex object IDs. If the deployed SHA cannot
be read, the fetch fails, an object is missing, or either SHA is malformed,
`check-shipped` **no-ops**. It never guesses, because guessing means telling
someone their bug is fixed when it is not. SSH, Docker, Git, and mail processes
are invoked with argument arrays rather than interpolated shell commands.

## Components

Work is split by whether it requires judgment. Everything mechanical is tested
code; only classification, reply copy, and fixes are left to the agent. This
follows the `cfReconcile.ts` + `scripts/cutover/` pattern from W9.

### `api/src/services/feedbackTriage.ts` + `feedbackTriage-cli.ts`

| Verb | Behaviour |
|---|---|
| `list --untriaged` | the queue — `category IS NULL`, oldest first |
| `list --pending` | classified rows still missing their required first email |
| `replay-pending` | re-attempts every ledger row that is written but unsent, and dead-letters the ones out of time |
| `list --dead-lettered` | sends that were abandoned, so nobody is silently unanswered |
| `list --fix-pending` | acknowledged bug/ux/feature rows whose fix is not yet merged or deferred |
| `reconcile-fixes` | heals `fix_status` from observed remote state; recovers any lost response |
| `defer --id --reason` | terminal `deferred`, for an item no fix is planned for |
| `triage --id --category --severity --note [--dedupe-of]` | writes classification, sets `triaged_at` |
| `email --id --kind ack\|reply --subject --text --html` | validates the category transition, freezes the request, commits the row, sends, records `message_id`. Copy arrives as bounded inline content, never a file path |
| `link --id --sha` | records a full merged/squash commit reachable from `origin/main` |
| `check-shipped` | the only code path that creates and sends `resolved` emails |
| `approve-patch --id --diff` | broker-side privacy scan against that row's address and body; returns a signed approval over the patch digest, or a rejection with a reason |
| `submit-patch --id --diff --approval` | verifies the approval covers these exact bytes, then applies an inert diff in `repos-git`'s own clone on the pinned base, commits, and pushes to the derived `feedback/<id>` branch. Fast-forward only. Replaces revision 3's `push-branch`, which took a repository rather than a patch |
| `open-pr --id` | opens the pull request for that branch; body and title are derived, and carry no submitter address |

**The CLI owning `email` is what makes autonomy safe.** It permits `reply` only
for `noise`/`question` and `ack` only for `bug`/`ux`/`feature`; there is no
general-purpose command for sending a resolved notice. The agent cannot
double-send even if it misbehaves or a run dies partway, because the constraint,
transition checks, and commit-before-send ordering live in code with tests, not
in the agent's reasoning.

**The broker holds the database connection, not the CLI.** The CLI the agent
runs is a socket client with no `DATABASE_URL` and no credentials of any kind.
The broker builds its own `DATABASE_URL` from `POSTGRES_*` when absent, exactly
as `002-w9-cf-baseline.sh` now does — it is not ambient under `docker exec`.

### `api/src/services/feedbackBroker.ts` + the `repos-feedback-broker` unit

The privileged half. Runs as `repos-broker`, owns `RESEND_API_KEY`,
`FEEDBACK_WEBHOOK_URL`, the Unraid SSH identity and `DATABASE_URL` — but **not**
the GitHub token, which lives in `repos-git` so that a compromise of either
principal does not yield the other's capabilities. It serves the verbs above
over
`/run/repos-feedback/broker.sock`. The webhook URL belongs here with the rest:
alerting is a broker responsibility, and an agent that could rewrite the alert
destination could silence its own dead letters. It performs every transition check, derives
every security-relevant field itself, and length-caps each inline copy field.
Requests are a small fixed JSON schema — no paths, no SQL, no shell, no
free-form target. This is the same "mechanical work is tested code" split as the
rest of the design, drawn at a process boundary so it is enforced by the kernel
rather than by convention.

### `api/src/services/feedbackMailer.ts`

Resend, from `FEEDBACK_FROM_EMAIL=feedback@send.jpmtech.com`, with
**`Reply-To: jason@jpmtech.com`** so a human reply reaches a human. Distinct
from `INVITE_FROM_EMAIL` so the two streams can be filtered apart.

Idempotency key: `fb-{kind}-{feedback_id}` — deterministic, stable across
retries, well inside Resend's 1–256 character limit.

Three templates, each with a plain-text alternative, following the invite
mailer's constraints (inline CSS, table layout, brand palette, no `@font-face`
because Gmail strips it): **ack**, **resolved**, **snark**.

### `.claude/skills/feedback-sweep/SKILL.md`

The procedure the agent follows, versioned in the repo so it is reviewable and
improvable like any other code. When a sweep does something dumb, the fix is a
diff.

### `scripts/feedback/sweep.sh`

Invoked by a systemd user timer every 4 hours. Runs Claude Code headless against
the `/feedback-sweep` skill.

A sweep holds **no state of its own**: read the queues, act, write back. Every
step it might be interrupted at is recoverable from the database or from
observable remote state, which is what the `fix_status` lifecycle and
`reconcile-fixes` exist to guarantee — the claim is only true because that state
is durable. A missed or half-finished run therefore costs at most one sweep
interval, never an item, and that is what makes a workstation runtime acceptable
despite the machine not always being awake.

## Sweep order

Every sweep runs these in order, and the order matters: unfinished work is
drained before new work is taken on, so a backlog can never be created faster
than it is cleared.

1. `reconcile-fixes` — heal fix state from the remote before deciding anything
2. `replay-pending` — written but unsent ledger rows
3. `list --pending` — classified rows whose first email was never written
4. `list --fix-pending` — acknowledged items whose fix is unfinished
5. `list --untriaged` — genuinely new feedback, per the flow below
6. `check-shipped` — every sweep, regardless of whether anything new arrived
7. `reconcile-fixes` again — record work done during this sweep before exiting

Steps 1, 2, 6 and 7 are mechanical and involve no agent judgement. Step 4 resumes
work the agent already started; step 5 is the only one that takes on anything
new. `reconcile-fixes` runs first so the rest of the sweep reasons about
observed reality rather than about what the last run believed.

## Per-item flow

1. Classify → `triage`
2. Then, by category:
   - `noise` / `question` → draft copy → `email --kind reply`. Terminal.
   - `bug` / `ux` / `feature` → draft copy → `email --kind ack`
3. Fixable bug → `triage` sets `fix_status='needed'` → **disposable worktree** →
   failing test that reproduces it → fix → `approve-patch` → `submit-patch` →
   `open-pr` (see below). The git verbs do **not** write `fix_status`;
   `reconcile-fixes` observes the remote and advances it, so an interrupted
   attempt resumes from observed reality rather than from anything the run
   remembered. An item no fix is planned for gets `defer` with a reason.
(`check-shipped` runs as step 6 of the sweep above, regardless of new feedback.)

### Fixes run in a disposable worktree, never the shared checkout

`/var/home/jason/Projects/RepOS` is Jason's working checkout and is **routinely
dirty**: `.gitignore` is permanently modified-and-uncommitted there by design,
and any work in progress lives alongside it. An agent committing in that
directory would sooner or later sweep human work into a PR, and `git add -A` is
already banned in this repository for exactly that reason.

Nor can the worktrees hang off that checkout. `git worktree add` writes into the
source repository's `.git/worktrees`, so worktrees rooted in Jason's clone would
have the agent mutating his repository metadata — and under a dedicated account
it would not have permission to anyway. The two mitigations contradict each
other unless the agent owns its own copy.

The agent account therefore keeps its own **bare mirror**, cloned anonymously —
the repository is public, so reads need no credential. Each fix gets a throwaway
worktree created from that mirror at a **pinned `origin/main` SHA** resolved
once at the start of the sweep, so every item in a sweep builds on the same
known base and none of them observe each other's half-finished state. The
worktree is removed when the patch is submitted or the attempt is abandoned. The
agent never reads from, writes to, or references Jason's checkout at all.

### Privileged git never runs inside an agent-writable repository

Revision 3 said the broker would push *from the agent's mirror*. That was a
privilege inversion, and a complete defeat of the boundary. A git repository is
not inert data: `pre-push` and other hooks in `$GIT_DIR/hooks`, and repo-local
config keys such as `core.sshCommand`, `core.pager`, `core.fsmonitor` and
`filter.*.clean`, are **executed by whoever runs the git command**. An agent
that can write its own `.git` could therefore have arbitrary code run as
`repos-broker` on the next push — and that process holds every credential in the
system. Modern git's `safe.directory` ownership check would likely refuse the
cross-user operation outright, but relying on that is relying on a guardrail, not
a design.

**The boundary is crossed by a patch, not by a repository.** The agent commits
in its own worktree, produces a diff, and submits it as bounded inline content
over the socket, exactly like email copy. A diff is inert: applying one executes
nothing.

Git writes then happen in a **third principal**, `repos-git`, which:

- owns its own pristine clone that no other account can write, recreated from
  `origin` rather than from anything the agent touched;
- applies the submitted patch onto the pinned `origin/main` SHA with
  `git apply`, which runs no hooks;
- runs every git command with `core.hooksPath=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=/dev/null`, so neither the
  submitted content nor the workstation's ambient config can introduce a hook,
  a filter, or a transport override;
- holds **only** the GitHub write token — not the Resend key, not the SSH
  identity, not the database. A compromise of `repos-git` costs a bad PR on a
  protected branch, which is the acceptable worst case already stated.

Overriding the ambient config also fixes a real hazard on this machine: the
workstation's git config carries `url.git@github.com:.insteadOf
https://github.com/`, which silently rewrites every HTTPS remote to SSH — and
SSH to `github.com:22` is currently timing out here, which broke a push during
the 2026-09-04 session. An unattended sweep would have hung or failed opaquely.
`repos-git` names its remote and transport explicitly and inherits nothing.

### `submit-patch` is constrained server-side

The branch name is **derived, not accepted**: `feedback/<id>`, and nothing more.
`repos-git` has no database, so the feedback id is the only fact it has — a slug
would have to come from the agent or the broker, which either lets the agent
influence a ref name or forces a cross-principal call this design forbids. The
id alone is also unambiguous and, because it is a pure function of the row, it is
what makes remote state rediscoverable. The agent cannot name a ref. `repos-git` additionally
refuses: any push to `main` or a protected branch, any tag, any ref outside the
`feedback/` namespace, any deletion, any force or non-fast-forward push, and any
remote other than its own configured `origin`. Each of those is a test, not a
convention.

## Failure handling

| Failure | Resting state |
|---|---|
| Resend fails, retryable, inside 24h | Row persists, `error` set, `attempts` incremented, `sent_at` NULL. Next sweep validates and replays the same key and bytes |
| Resend rejects the recipient (422 / suppressed / hard bounce), or a send is still unsent 24h after the first attempt | Dead-lettered: `dead_lettered_at` stamped, never retried, alert fired, listed by `list --dead-lettered` |
| Resend returns 401/403 | Sending halts for the sweep, alert fired, **nothing dead-lettered** — the queue drains once the key is fixed |
| Crash between `triage` and `email` | Row is classified with no ledger row; `list --pending` selects it and the next sweep sends |
| Crash between `ack`, `submit-patch`, `open-pr` and `link` | The remote records the last completed step — branch pushed, PR opened — and `reconcile-fixes` reads it into `fix_status` on the next run, first or last of a sweep. Until that reconcile the row still reads as its previous state; `list --fix-pending` selects it either way and the next sweep resumes |
| Push or PR succeeded but the response was lost | `reconcile-fixes` observes the remote and heals the row; `submit-patch` and `open-pr` are no-ops when the work already exists |
| Workstation asleep / SSH fails | Sweep aborts before any write. Nothing partial |
| Deployed SHA unreadable | `check-shipped` no-ops |
| No submitter address | Classified, triaged, email skipped, reason recorded |
| Feedback row deleted | `ON DELETE CASCADE` removes its email rows |
| Misclassification | `triage` may be re-run to overwrite classification. It never un-sends an email |

### Delivery model: at-most-once

Resend's idempotency key collapses retries into one delivery **for 24 hours
only**. Past that window the key is forgotten, so a replay of a long-failed send
could deliver a second copy. The goal states a submitter is never emailed twice
about the same item, so the earlier "accept the duplicate" position is
withdrawn — it contradicted the guarantee it appeared beneath.

**The send is at-most-once.** A row whose first attempt is more than 24 hours
old and which still has `sent_at IS NULL` is **dead-lettered**: `dead_lettered_at`
is stamped and it is never retried. The reason is that a failed Resend call is
ambiguous — the message may well have been delivered, and only the response was
lost. Past the idempotency window there is no way to distinguish "never sent"
from "sent, response lost", and this design would rather a submitter miss an
acknowledgement than receive it twice.

Retry policy inside the window:

- `attempts` increments and `last_attempt_at` is stamped on every try;
  `first_attempt_at` is set once and is what the 24-hour deadline is measured
  from.
- Retries are driven by `replay-pending` at the head of each sweep, so the
  natural backoff is the ~4-hour sweep interval — roughly five chances inside
  the window. No sub-sweep retry loop; a sweep never sits and spins on a failing
  provider.
Failures are classified by **whose fault they are**, because "4xx that is not
429" lumps together two opposite situations:

| Response | Meaning | Action |
|---|---|---|
| 429, 5xx, network error | transient | retry next sweep, inside the 24h window |
| **401 / 403** | the key is wrong, revoked or misconfigured | **pause and alert.** Nothing is dead-lettered |
| 422 / documented recipient-level rejection — invalid address, suppressed, hard-bounced | this recipient cannot be mailed | dead-letter immediately |
| still unsent 24h after `first_attempt_at` | ambiguous | dead-letter |

The 401/403 row is the important distinction. An authentication failure says
nothing about the message and applies to *every* message: dead-lettering on it
would burn through the whole queue, abandoning every pending submitter, in
response to an expired key. Sending therefore **halts** — no further sends this
sweep, no `dead_lettered_at` stamped, nothing consumed — and the run alerts.
Once the key is fixed the queue drains normally, because every row is still
pending and its frozen request is intact.

**Dead letters and pauses alert actively.** A list nobody opens is a silent
failure with extra steps. Both fire the existing Discord webhook —
`FEEDBACK_WEBHOOK_URL`, already configured in production and restricted to
discord.com by the 2026-09-04 hardening — the same channel that already
announces new feedback. `list --dead-lettered` remains as the audit view, not as
the notification mechanism. If the webhook is unset the sweep says so loudly at
start rather than degrading to silence.

Because a dead-lettered `ack` leaves the row in the ack/ship cycle, `check-shipped`
still sends its `resolved` email later. Dead-lettering one email does not
abandon the item.

## Testing

Aimed at the failure modes this repository keeps producing.

- **Double-send is rejected by the constraint** — mutation-checked by dropping
  the constraint and confirming the test fails.
- **Cross-kind concurrency** — two concurrent calls, one `ack` and one `reply`
  against the same row, produce exactly one email. Mutation-checked by narrowing
  the advisory lock to `(feedback_id, kind)` and confirming the test fails; the
  unique constraint alone does not catch this, which is the whole reason the
  lock is feedback-level. Also covered: `triage` reclassifying a row
  concurrently with a send.
- **Queue membership ignores `triaged_at`** — a row updated through
  `PATCH /admin/feedback/:id/triage` (which sets `triaged_at` and nothing else)
  is still returned by `list --untriaged`.
- **Replay validation** — a persisted request whose recipient has been altered
  to a third party, whose `from` has been altered, or whose stored idempotency
  key no longer matches the recomputed one, fails hard rather than sending.
  Agent-authored copy containing HTML is escaped in the rendered body.
- **Dead-lettering** — a send first attempted more than 24 hours ago is
  abandoned rather than retried; a recipient-level rejection is abandoned on the
  first response; a 429 is not; a dead-lettered `ack` still permits a later
  `resolved`; a dead letter fires the alert.
- **401/403 halts rather than consumes** — a run against a mailer returning 401
  leaves every row pending with `dead_lettered_at` NULL, fires the alert, and a
  subsequent run with a working key delivers all of them. This is the test that
  distinguishes the two failure classes, and it fails if they are merged back
  into "4xx ≠ 429".
- **Crash between `triage` and `email`** — commit a classification, kill the run
  before any `feedback_emails` row is written, and assert the row appears in
  `list --pending` and is delivered by the next sweep. Mutation-checked by
  removing the `--pending` drain and confirming the row is stranded.
- **Fix lifecycle survives a crash at every step** — kill the run after `ack`,
  after `submit-patch` and after `open-pr` in turn; each time the row is
  returned by `list --fix-pending` and the next sweep resumes rather than
  restarting or duplicating. Mutation-checked by removing the trailing
  `reconcile-fixes` from the sweep and confirming the row is stranded until the
  next run.
- **Lost response is recovered, not duplicated** — push succeeds but the reply
  is dropped; `reconcile-fixes` heals the row from the remote, and a repeated
  `submit-patch` with the same digest returns the existing branch rather than
  creating a second one. A changed digest fast-forwards the branch by one commit
  instead.
- **`deferred` is terminal** — a deferred row leaves `list --fix-pending`
  permanently and never receives a `resolved` email.
- **Duplicates do no fix work but hear the outcome** — a duplicate bug is `n/a`
  and never appears in `list --fix-pending`, while still receiving its own `ack`
  and a `resolved` email when the canonical fix ships. A row marked duplicate
  after reaching `needed` drops to `n/a`. Mutation-checked by removing the
  `dedupe_of IS NULL` predicate and confirming two PRs are opened for one bug.
- **Only `reconcile-fixes` writes the remote-derived states** — `submit-patch`
  and `open-pr` leave `fix_status` untouched; `patch_submitted` and `pr_open`
  appear only after a reconcile. Asserted by inspecting the column immediately
  after each git verb. `triage` and `defer` still write `needed`, `n/a` and
  `deferred`, and no verb writes both sets.
- **A revised patch fast-forwards** — submitting a different digest for the same
  row advances the branch by one commit whose tree equals the new patch, with the
  previous tip as parent, and the push is accepted without force. Asserted
  together with the force-refusal test, since the two would otherwise contradict.
- **Patch approval is enforced, not requested** — `repos-git` refuses a patch
  with no approval, with an expired one, with one signed for a different
  `feedback_id` or base, and with one whose digest does not match the bytes
  actually submitted. The broker refuses to sign a diff containing the
  submitter's address or verbatim feedback body. Mutation-checked by disabling
  signature verification and confirming a leaking patch reaches the remote.
- **End-to-end sweep recovery, both stranding modes** — one full sweep with the
  mailer failing on the network, then a second sweep with it healthy, asserts
  every submitter ends up mailed exactly once. Covers the written-but-unsent row
  (via `replay-pending`) and the no-ledger-row row (via `list --pending`) in the
  same run, since the two are stranded by different mechanisms and each is
  invisible to the other's queue. Mutation-checked by removing `replay-pending`
  from the sweep and confirming the network-failed email is never retried and is
  eventually dead-lettered with `attempts = 1`.
- **Concurrent dedupe** — `A.dedupe_of = B` racing `B.dedupe_of = C` produces a
  rejection, not a chain. Mutation-checked by locking only the row being
  modified and confirming the chain forms.
- **The broker boundary is enforced, not documented** — as the agent account:
  the credential files, the SSH identity and the GitHub token are unreadable,
  the database is unreachable, the socket is reachable; and a request naming its
  own recipient or `from` is ignored in favour of the values the broker derives.
  A request carrying a path where copy is expected is rejected outright.
- **A hostile repository cannot execute anything privileged** — a worktree
  carrying a `pre-push` hook, a `core.sshCommand`, and a `filter.*.clean` is
  submitted as a patch; assert none of them run, that the hook file is not even
  transferred, and that `repos-git` operates only in its own clone. Mutation-
  checked by pointing the git principal at the agent's mirror and confirming the
  hook fires.
- **`submit-patch` constraints** — pushes to `main`, to a tag, outside the
  `feedback/` namespace, as a deletion, as a force update, or to a remote other
  than the configured origin are each rejected. The branch name is derived, so a
  request attempting to supply one is ignored.
- **The model proxy hides the credential** — as the agent account, the upstream
  key file is unreadable, while an inference request through the loopback proxy
  succeeds.
- **No credential and no submitter identity can leave via content the agent
  controls** — given a feedback body that asks for exactly that, assert no
  submitter address and no secret appears in: rendered email bodies, branch
  names, commit messages, PR titles and bodies, **and the submitted patch
  itself** — its diff hunks, any test fixture it adds, and any file path it
  creates. The patch is the largest agent-authored artefact that becomes
  world-readable, and metadata-only assertions would miss the obvious case of a
  regression test seeded with the reporter's own words and address.
- **State transitions** — category/kind mismatches are rejected, `reply` and
  `ack`/`resolved` are mutually exclusive, and no direct resolved-email command
  exists.
- **Commit-before-send** — observe the row from a separate database connection
  inside the send mock, then force the send to throw; assert the row survives
  with `error` set and `message_id` NULL, and that a retry replays
  **byte-identical** bytes under the same key. Seeded from a non-default value,
  since a test asserting a field ends at its default proves nothing about the
  path meant to set it.
- **`check-shipped`** — non-ancestor SHA sends nothing; ancestor sends exactly
  one; an already-notified row sends none; malformed/missing SHAs and remote
  read/fetch failures no-op.
- **Null-address row** produces no `feedback_emails` row.
- **Duplicate** receives its own ack, and a resolved email when the canonical
  fix ships — asserted through the effective-fix-SHA selection, so a duplicate
  with a NULL `fix_commit_sha` is still selected; self-references, chains, and
  cycles are rejected.
- **Template render determinism** across a wall-clock jump, mirroring the
  existing invite-mailer guard.
- **Migration 094** — columns, CHECKs, and the unique constraint exist after a
  fresh `runMigrations`; a pre-existing row with `triaged_at` set and `category`
  NULL survives and remains queued.

## Deployment

1. Merge. CI gates as usual.
2. Add `FEEDBACK_FROM_EMAIL` to `/mnt/user/appdata/repos/.env` and **recreate**
   the container — env is fixed at create time.
3. Create the `repos-broker` system account and install the
   `repos-feedback-broker` unit, with the Resend key, `FEEDBACK_WEBHOOK_URL`,
   the Unraid SSH identity, the database credentials and the Ed25519 **signing**
   key readable only by it (`0600`, `LoadCredential=`). Socket `0660`, group
   `repos-agent`. It does not get the GitHub token.
4. Create the `repos-git` account holding **only** the GitHub write token and
   the broker's Ed25519 **public** key, with its own pristine clone that no other
   account can write, and its own socket at `/run/repos-git/git.sock` (`0660`,
   group `repos-agent`). Configure every git invocation with
   `core.hooksPath=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and
   `GIT_CONFIG_GLOBAL=/dev/null`.
5. Stand up the loopback model-credential proxy under its own principal and
   point the agent's `ANTHROPIC_BASE_URL` at it.
6. Create the agent account with **no credentials at all**, add it to
   `repos-agent`, and clone the bare mirror anonymously as that account — the
   repository is public, so reads need no token. Verify the boundary holds: as
   the agent user the Resend key, webhook URL, SSH identity, GitHub token,
   database and model credential must all be unreadable, while the broker socket
   and the model proxy answer.
7. Install the systemd user timer under the agent account.
8. First sweep processes the three existing rows. One of them — the programs
   page rendering badly on mobile — is a real bug, and plausibly one the
   2026-08-10 visual pass already fixed, which makes it a genuine first exercise
   of `check-shipped` rather than a synthetic one.

## Open items

- ~~Confirm the at-most-once choice.~~ **Confirmed 2026-09-04**, for
  *ambiguous* outcomes specifically. The refinement that came with it is now in
  *Delivery model*: an authentication failure is not ambiguous and must not
  consume the queue, and a dead letter must alert rather than wait to be found.
- Revisit the no-rules tone policy when someone Jason does not know personally
  is invited. Note that the **trust boundary above does not depend on this** —
  it was written to survive the cohort changing.
