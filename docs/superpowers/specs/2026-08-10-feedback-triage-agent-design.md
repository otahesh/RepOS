# Feedback triage agent — design

**Status:** design approved 2026-08-10. Not implemented.
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
  triaged, once when the fix is live.
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

`triaged_at` already exists and keeps its meaning.

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
  UNIQUE (feedback_id, kind)
);
```

**`UNIQUE (feedback_id, kind)` is a load-bearing part of this design.** It makes
same-kind deduplication a schema guarantee rather than something the agent has
to remember. The service additionally enforces the allowed state transitions:
`reply` is exclusive with `ack` and `resolved`, and `resolved` is only created
by deployment verification. Together those rules enforce the two-email maximum.

For each `(feedback_id, kind)`, the service takes a session-level advisory lock,
freezes the request, inserts the row, and **commits before** making the network
request. A crash mid-send therefore leaves durable evidence rather than a
silent gap. `request` holds the frozen bytes so a retry replays verbatim under
the same key instead of re-rendering. An existing row with `sent_at` set is a
no-op; an unsent row replays its persisted request.

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
2. Runs `git fetch origin main`, then for every row with a `fix_commit_sha` and
   no `resolved` email asks
   `git merge-base --is-ancestor <fix_commit_sha> <deployed_sha>`.
3. Sends only on a true answer.
4. Resolves each duplicate through `dedupe_of` and applies the same test to the
   **canonical** row's `fix_commit_sha`. A duplicate never carries its own
   `fix_commit_sha`, so without this traversal its submitter would be acked and
   then never told the fix shipped.

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
| `list --untriaged` | the queue, oldest first |
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
3. Fixable bug → branch, failing test that reproduces it, fix, PR
4. `check-shipped` runs every sweep regardless of new feedback

## Failure handling

| Failure | Resting state |
|---|---|
| Resend fails | Row persists, `error` set, `sent_at` NULL. Next sweep replays the same key and bytes |
| Workstation asleep / SSH fails | Sweep aborts before any write. Nothing partial |
| Deployed SHA unreadable | `check-shipped` no-ops |
| No submitter address | Classified, triaged, email skipped, reason recorded |
| Feedback row deleted | `ON DELETE CASCADE` removes its email rows |
| Misclassification | `triage` may be re-run to overwrite classification. It never un-sends an email |

**Accepted limitation:** beyond Resend's 24-hour idempotency window a retry of a
long-failed send could deliver twice. At this volume that is accepted rather
than solved with a second dedupe layer.

## Testing

Aimed at the failure modes this repository keeps producing.

- **Double-send is rejected by the constraint** — mutation-checked by dropping
  the constraint and confirming the test fails.
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
  fix ships; self-references, chains, and cycles are rejected.
- **Template render determinism** across a wall-clock jump, mirroring the
  existing invite-mailer guard.
- **Migration 094** — columns, CHECKs, and the unique constraint exist after a
  fresh `runMigrations`.

## Deployment

1. Merge. CI gates as usual.
2. Add `FEEDBACK_FROM_EMAIL` to `/mnt/user/appdata/repos/.env` and **recreate**
   the container — env is fixed at create time.
3. Install the systemd user timer on the workstation.
4. First sweep processes the three existing rows. One of them — the programs
   page rendering badly on mobile — is a real bug, and plausibly one the
   2026-08-10 visual pass already fixed, which makes it a genuine first exercise
   of `check-shipped` rather than a synthetic one.

## Open items

None blocking. Revisit the no-rules tone policy when someone Jason does not know
personally is invited.
