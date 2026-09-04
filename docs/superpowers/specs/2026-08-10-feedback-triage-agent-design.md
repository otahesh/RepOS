# Feedback triage agent — design

**Status:** revised 2026-09-04 after review. Not implemented.
**Revision 2026-09-04:** closes seven review findings — a trust boundary for the
prompt-injection surface, a feedback-level advisory lock, queue membership by
`category` rather than `triaged_at`, an explicit at-most-once delivery model,
disposable worktrees for agent git work, effective-fix-SHA selection for
duplicates, and validation of persisted email requests before replay.
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
(`api/src/schemas/feedback.ts:8`), and a headless coding agent then reads it
while holding repository write access. Text written by someone else, read by an
agent that can act, is a prompt-injection surface regardless of who that someone
is. *"Only people I know get invited"* is a **tone** policy — it was Jason's
answer to how snarky the replies may be. It is not a security boundary, and this
section does not treat it as one. The cohort will also change; the boundary
should not have to.

The design already splits work by judgment: mechanical verbs are tested code,
and only classification, copy and fixes are left to the agent. Extending that
split to *capability* is what closes the injection surface:

- **The agent process holds no production credentials.** No `RESEND_API_KEY`,
  no `CF_API_TOKEN`, no Unraid SSH key, no admin key in its environment. It runs
  as a dedicated user account, not as Jason.
- **Every production-touching operation is a CLI verb, never a capability.**
  `check-shipped` is the only thing that reads `APP_SHA` from the container, and
  it holds the SSH identity itself. The agent invokes the verb and receives an
  answer; it cannot open its own connection to production, and no prompt can
  make it do so because the ability is absent rather than forbidden.
- **The GitHub credential is scoped to push branches and open pull requests on
  this repository only.** No merge, no `workflow` scope, no secrets, no admin,
  no other repository. `main` is protected and requires 8 passing checks, so the
  worst case of a poisoned agent is a bad PR that a human declines — which is
  already the normal review path, not a new one.
- **The skill frames the body as data.** It is passed inside an explicit
  delimiter and labelled untrusted, with the standing rule that instructions
  found *inside* a feedback body are content to be classified, never directions
  to follow. A body that tries to issue instructions is itself a strong `noise`
  signal, and the snark reply handles it.
- **The agent never sends mail directly.** It writes a body file; `email`
  validates the category transition, the recipient and the sender, and holds the
  Resend key.

What this deliberately does not do: sandbox the machine, sign commits, or vet
the agent's diffs mechanically. The protection against a malicious *diff* is CI
plus Jason's review on a protected branch. The protection here is against a
malicious *instruction* reaching a capability, and it works by not granting the
capability.

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

Duplicates keep their own ack. When the canonical row's fix ships, the resolved
email is sent to the duplicate's submitter too, traversing `dedupe_of`.
`triage` only accepts a canonical row (`dedupe_of IS NULL`) as the target and
rejects self-references, chains, and cycles in the same transaction.

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
| `list --dead-lettered` | sends that were abandoned, so nobody is silently unanswered |
| `triage --id --category --severity --note [--dedupe-of]` | writes classification, sets `triaged_at` |
| `email --id --kind ack\|reply --body-file` | validates the category transition, freezes the request, commits the row, sends, records `message_id` |
| `link --id --sha` | records a full merged/squash commit reachable from `origin/main` |
| `check-shipped` | the only code path that creates and sends `resolved` emails |

**The CLI owning `email` is what makes autonomy safe.** It permits `reply` only
for `noise`/`question` and `ack` only for `bug`/`ux`/`feature`; there is no
general-purpose command for sending a resolved notice. The agent cannot
double-send even if it misbehaves or a run dies partway, because the constraint,
transition checks, and commit-before-send ordering live in code with tests, not
in the agent's reasoning.

The CLI must build its own `DATABASE_URL` from `POSTGRES_*` when absent, exactly
as `002-w9-cf-baseline.sh` now does. It is not ambient under `docker exec`.

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

A sweep is **stateless**: read queue, act, write back. A missed run costs
nothing — the next picks up the same queue. This is the direct payoff of putting
state in the database, and it is what makes a workstation runtime acceptable
despite the machine not always being awake.

## Per-item flow

1. Classify → `triage`
2. Then, by category:
   - `noise` / `question` → draft copy → `email --kind reply`. Terminal.
   - `bug` / `ux` / `feature` → draft copy → `email --kind ack`
3. Fixable bug → **disposable worktree** → failing test that reproduces it →
   fix → PR (see below)
4. `check-shipped` runs every sweep regardless of new feedback

### Fixes run in a disposable worktree, never the shared checkout

`/var/home/jason/Projects/RepOS` is Jason's working checkout and is **routinely
dirty**: `.gitignore` is permanently modified-and-uncommitted there by design,
and any work in progress lives alongside it. An agent committing in that
directory would sooner or later sweep human work into a PR, and `git add -A` is
already banned in this repository for exactly that reason.

Each fix therefore gets its own throwaway worktree, created from a **pinned
`origin/main` SHA** resolved once at the start of the sweep, so every item in a
sweep builds on the same known base and none of them observe each other's
half-finished state. The worktree is removed when the PR is opened or the
attempt is abandoned. The agent never runs a git write command in the shared
checkout.

**The fetch must name its transport explicitly.** The workstation's git config
carries `url.git@github.com:.insteadOf https://github.com/`, which silently
rewrites every HTTPS remote to SSH — and SSH to `github.com:22` is currently
timing out from this machine, which broke a push during the 2026-09-04 session.
An unattended sweep would hang or fail opaquely on that. Fetch and push
therefore override the rewrite and authenticate over HTTPS with the scoped
credential, rather than inheriting whichever transport the ambient config
prefers.

## Failure handling

| Failure | Resting state |
|---|---|
| Resend fails, retryable, inside 24h | Row persists, `error` set, `attempts` incremented, `sent_at` NULL. Next sweep validates and replays the same key and bytes |
| Resend fails past 24h, or permanently (4xx ≠ 429) | Dead-lettered: `dead_lettered_at` stamped, never retried, listed by `list --dead-lettered` |
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
- Retries are attempted on the next sweep, so the natural backoff is the ~4-hour
  sweep interval — roughly five chances inside the window. No sub-sweep retry
  loop; a sweep never sits and spins on a failing provider.
- A **permanent** failure — Resend 4xx other than 429, e.g. an invalid or
  suppressed recipient — is dead-lettered immediately rather than retried five
  times to no purpose.
- Dead-lettered rows are surfaced in `list --dead-lettered` so a human can see
  who never heard back. They are not a silent gap.

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
  abandoned rather than retried; a permanent 4xx is abandoned on the first
  response; a 429 is not; a dead-lettered `ack` still permits a later
  `resolved`.
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
3. Create the agent's own workstation user account, with: a GitHub credential
   scoped to push-branch and open-PR on this repository only; no Resend key, no
   Cloudflare token, no Unraid SSH key, no admin key in its environment. The
   `check-shipped` verb holds the SSH identity separately. Confirm by running a
   sweep and asserting the agent's environment cannot reach production directly.
4. Install the systemd user timer under that account.
5. First sweep processes the three existing rows. One of them — the programs
   page rendering badly on mobile — is a real bug, and plausibly one the
   2026-08-10 visual pass already fixed, which makes it a genuine first exercise
   of `check-shipped` rather than a synthetic one.

## Open items

- **Confirm the at-most-once choice.** Dead-lettering past 24 hours means a
  submitter may occasionally never receive an acknowledgement, rather than
  occasionally receiving two. That trades a visible annoyance for an invisible
  silence, which is the right trade for the stated goal but is a judgement call
  and reverses the previous "accept the duplicate" position. `list
  --dead-lettered` exists so the silence is at least visible to a human.
- Revisit the no-rules tone policy when someone Jason does not know personally
  is invited. Note that the **trust boundary above does not depend on this** —
  it was written to survive the cohort changing.
