# Feedback Triage — Plan 1 of 3: Data Model, Triage Core, and Mail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable state and the tested, mechanical service layer that the feedback triage agent will later drive — classification, the email ledger, at-most-once delivery, and an operator CLI — with no agent, no broker, and no network daemon yet.

**Architecture:** Everything lives in the database and in plain services under `api/src/services/`. Migration 094 adds classification and fix-lifecycle columns to `feedback` plus a `feedback_emails` ledger whose `UNIQUE (feedback_id, kind)` makes "never email the same person twice about the same item" a schema guarantee. A feedback-level advisory lock serializes every mutation. The mailer freezes its request bytes before committing, then sends — so a crash leaves evidence rather than a silent gap.

**Tech Stack:** TypeScript (ESM — every relative import ends in `.js`), Fastify 5 app context, `pg` Pool via `src/db/client.js`, Vitest, Resend HTTP API via native `fetch`.

**Spec:** `docs/superpowers/specs/2026-08-10-feedback-triage-agent-design.md` (merged as PR #86). Read it before starting; this plan argues from it.

## Scope of this plan, and what it excludes

The spec covers several subsystems. This is the first of three plans:

| Plan | Covers | Status |
|---|---|---|
| **1 (this one)** | Migration 094, feedback lock, triage/defer/dedupe, the four queues, mailer, ledger, delivery model, alerts, operator CLI | ready |
| 2 | Ship detection (`check-shipped`), the fix lifecycle verbs, `repos-git`, patch approval signing, `reconcile-fixes` | not written |
| 3 | The broker daemon and its socket, the agent-facing thin client, the `feedback-sweep` skill, sweep script, systemd timer, model proxy, deployment | not written |

**On the CLI in this plan.** The spec requires that *the agent* reach the database only through a broker socket. This plan builds an **operator** CLI that Jason runs directly, at the same trust level as `psql`. That is not a violation — the boundary the spec draws is around the agent, which does not exist yet. Plan 3 adds the broker and the agent-facing client on top of the same service functions built here.

## Global Constraints

Copied verbatim from the spec and from `CLAUDE.md`. Every task's requirements implicitly include these.

- **Migration number must be `094`.** The 08x range is shared and collides; production is applied through `093_cardio_logs`.
- **ESM:** all relative imports inside `api/src` end in `.js` even though the source is `.ts`.
- **Never `git add -A`.** `.gitignore` is permanently modified-and-uncommitted in this repo. Stage by explicit path in every commit step.
- **Advisory locks are feedback-level**, keyed on `feedback_id` alone — never on `(feedback_id, kind)`.
- **Queue membership is `category IS NULL`**, never `triaged_at IS NULL`.
- **Delivery is at-most-once.** Ambiguous outcomes are dead-lettered rather than retried past 24 hours.
- **401/403 pauses; it never dead-letters.** An auth failure applies to every message.
- **`from` is `FEEDBACK_FROM_EMAIL`; `Reply-To` is `jason@jpmtech.com`.**
- **Idempotency key is `fb-{kind}-{feedback_id}`** — deterministic and stable across retries.
- **No `@font-face` in email HTML** (Gmail strips it). Inline CSS, table layout, system font stack, brand palette.
- **Missing credentials fail at USE time, never at boot**, matching `inviteMailer.ts`.
- Brand palette for email: accent `#4D8DFF`, good `#6BE28B`, surface `#10141C`, background `#0A0D12`.

---

### Task 1: Migration 094 — classification, fix lifecycle, and the email ledger

**Files:**
- Create: `api/src/db/migrations/094_feedback_triage.sql`
- Create: `api/tests/db/migration-094.test.ts`

**Interfaces:**
- Consumes: the existing `feedback` table from `070_feedback.sql`.
- Produces: columns `feedback.category`, `severity`, `triage_note`, `dedupe_of`, `fix_commit_sha`, `fix_status`, `fix_base_sha`, `fix_patch_digest`, `fix_branch`, `fix_pr_number`; table `feedback_emails` with columns `id, feedback_id, kind, request, idempotency_key, message_id, sent_at, error, attempts, first_attempt_at, last_attempt_at, dead_lettered_at` and `UNIQUE (feedback_id, kind)`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/db/migration-094.test.ts`:

```ts
// Migration 094 — the schema guarantees the triage design leans on. The unique
// constraint and the CHECKs are load-bearing: they are what make "never email
// the same person twice" a property of the database rather than of the agent's
// memory, so each is asserted directly rather than inferred from behaviour.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const c of cleanups) await c();
});

async function freshDb(name: string) {
  const eph = await createEphemeralDb(name);
  const pool = new pg.Pool({ connectionString: eph.url, max: 2 });
  // One cleanup, pool first: DROP DATABASE fails while a connection is live.
  cleanups.push(async () => {
    await pool.end();
    await eph.drop();
  });
  await runMigrations(pool);
  return pool;
}

async function seedFeedback(pool: pg.Pool, body = 'it broke'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ($1, 'sub@example.test') RETURNING id`,
    [body],
  );
  return rows[0].id;
}

describe('migration 094', () => {
  it('adds the classification and fix-lifecycle columns with their CHECKs', async () => {
    const pool = await freshDb('mig094-cols');
    const id = await seedFeedback(pool);

    await pool.query(
      `UPDATE feedback SET category='bug', severity='p2', triage_note='real', fix_status='needed' WHERE id=$1`,
      [id],
    );

    await expect(
      pool.query(`UPDATE feedback SET category='nonsense' WHERE id=$1`, [id]),
    ).rejects.toThrow(/feedback_category_check/);
    await expect(
      pool.query(`UPDATE feedback SET severity='p9' WHERE id=$1`, [id]),
    ).rejects.toThrow(/feedback_severity_check/);
    await expect(
      pool.query(`UPDATE feedback SET fix_status='shipped' WHERE id=$1`, [id]),
    ).rejects.toThrow(/feedback_fix_status_check/);
    await expect(
      pool.query(`UPDATE feedback SET fix_commit_sha='NOTASHA' WHERE id=$1`, [id]),
    ).rejects.toThrow(/feedback_fix_commit_sha_check/);
  });

  it('defaults fix_status to n/a so untouched rows are not in the fix queue', async () => {
    const pool = await freshDb('mig094-default');
    const id = await seedFeedback(pool);
    const { rows } = await pool.query<{ fix_status: string; category: string | null }>(
      `SELECT fix_status, category FROM feedback WHERE id=$1`,
      [id],
    );
    expect(rows[0].fix_status).toBe('n/a');
    expect(rows[0].category).toBeNull();
  });

  it('rejects a self-referencing dedupe_of', async () => {
    const pool = await freshDb('mig094-self');
    const id = await seedFeedback(pool);
    await expect(
      pool.query(`UPDATE feedback SET dedupe_of=$1 WHERE id=$1`, [id]),
    ).rejects.toThrow(/feedback_dedupe_of_not_self/);
  });

  it('enforces one email per (feedback_id, kind)', async () => {
    const pool = await freshDb('mig094-unique');
    const id = await seedFeedback(pool);
    await pool.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'ack','{}',$2)`,
      [id, `fb-ack-${id}`],
    );
    await expect(
      pool.query(
        `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
         VALUES ($1,'ack','{}',$2)`,
        [id, `fb-ack-${id}`],
      ),
    ).rejects.toThrow(/feedback_emails_feedback_id_kind_key/);

    // A different kind is allowed by the constraint. Cross-kind exclusivity is
    // a service rule enforced by the feedback-level lock, not by the schema.
    await pool.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'resolved','{}',$2)`,
      [id, `fb-resolved-${id}`],
    );
  });

  it('rejects an unknown email kind', async () => {
    const pool = await freshDb('mig094-kind');
    const id = await seedFeedback(pool);
    await expect(
      pool.query(
        `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
         VALUES ($1,'nudge','{}','k')`,
        [id],
      ),
    ).rejects.toThrow(/feedback_emails_kind_check/);
  });

  it('cascades email rows when the feedback row is deleted', async () => {
    const pool = await freshDb('mig094-cascade');
    const id = await seedFeedback(pool);
    await pool.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
       VALUES ($1,'reply','{}','k')`,
      [id],
    );
    await pool.query(`DELETE FROM feedback WHERE id=$1`, [id]);
    const { rows } = await pool.query(`SELECT 1 FROM feedback_emails WHERE feedback_id=$1`, [id]);
    expect(rows).toHaveLength(0);
  });

  it('leaves a previously admin-triaged row in the queue', async () => {
    // adminFeedback.ts sets ONLY triaged_at. Such a row has no category, so it
    // must still be queued — this is the silent-drop the spec calls out.
    const pool = await freshDb('mig094-backfill');
    const id = await seedFeedback(pool);
    await pool.query(`UPDATE feedback SET triaged_at=now() WHERE id=$1`, [id]);
    const { rows } = await pool.query(
      `SELECT id FROM feedback WHERE category IS NULL AND id=$1`,
      [id],
    );
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/migration-094.test.ts`
Expected: FAIL — `column "category" of relation "feedback" does not exist`.

- [ ] **Step 3: Write the migration**

Create `api/src/db/migrations/094_feedback_triage.sql`:

```sql
-- Feedback triage agent — classification, fix lifecycle, and the email ledger.
--
-- Range: 094+. The 08x range is shared between W9 and origin's own migrations
-- and already collided once; production is applied through 093_cardio_logs.
--
-- `triaged_at` (from 070) deliberately keeps its old meaning of "somebody
-- looked at this". It CANNOT gate the agent's queue: PATCH /admin/feedback/:id
-- /triage sets only triaged_at and no category, so a row clicked in the admin
-- UI would leave a triaged_at-based queue while never being classified or
-- answered. Queue membership is `category IS NULL`.

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS category    TEXT NULL,
  ADD COLUMN IF NOT EXISTS severity    TEXT NULL,
  ADD COLUMN IF NOT EXISTS triage_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS dedupe_of   BIGINT NULL REFERENCES feedback(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fix_commit_sha   TEXT NULL,
  ADD COLUMN IF NOT EXISTS fix_status       TEXT NOT NULL DEFAULT 'n/a',
  ADD COLUMN IF NOT EXISTS fix_base_sha     TEXT NULL,
  ADD COLUMN IF NOT EXISTS fix_patch_digest TEXT NULL,
  ADD COLUMN IF NOT EXISTS fix_branch       TEXT NULL,
  ADD COLUMN IF NOT EXISTS fix_pr_number    INT NULL;

ALTER TABLE feedback
  DROP CONSTRAINT IF EXISTS feedback_category_check,
  DROP CONSTRAINT IF EXISTS feedback_severity_check,
  DROP CONSTRAINT IF EXISTS feedback_fix_status_check,
  DROP CONSTRAINT IF EXISTS feedback_fix_commit_sha_check,
  DROP CONSTRAINT IF EXISTS feedback_fix_base_sha_check,
  DROP CONSTRAINT IF EXISTS feedback_dedupe_of_not_self;

ALTER TABLE feedback
  ADD CONSTRAINT feedback_category_check
    CHECK (category IS NULL OR category IN ('bug','ux','feature','question','noise')),
  -- Noise carries no severity; the service enforces that pairing. The schema
  -- only constrains the vocabulary.
  ADD CONSTRAINT feedback_severity_check
    CHECK (severity IS NULL OR severity IN ('p1','p2','p3')),
  ADD CONSTRAINT feedback_fix_status_check
    CHECK (fix_status IN ('n/a','needed','patch_submitted','pr_open','merged','deferred')),
  ADD CONSTRAINT feedback_fix_commit_sha_check
    CHECK (fix_commit_sha IS NULL OR fix_commit_sha ~ '^[0-9a-f]{40}$'),
  ADD CONSTRAINT feedback_fix_base_sha_check
    CHECK (fix_base_sha IS NULL OR fix_base_sha ~ '^[0-9a-f]{40}$'),
  ADD CONSTRAINT feedback_dedupe_of_not_self
    CHECK (dedupe_of IS NULL OR dedupe_of <> id);

-- The agent's queue: unclassified rows, oldest first.
CREATE INDEX IF NOT EXISTS feedback_untriaged_idx
  ON feedback (created_at) WHERE category IS NULL;

-- The fix queue: acknowledged canonical items whose fix is unfinished.
CREATE INDEX IF NOT EXISTS feedback_fix_pending_idx
  ON feedback (created_at)
  WHERE fix_status IN ('needed','patch_submitted','pr_open') AND dedupe_of IS NULL;

-- One row per email we intend to send. The row is written and COMMITTED before
-- the network call, so a crash mid-send leaves durable evidence rather than a
-- silent gap; `request` holds the frozen bytes so a retry replays verbatim
-- under the same key instead of re-rendering (the Q30 lesson from
-- inviteMailer.ts). UNIQUE (feedback_id, kind) is what makes same-kind
-- double-send impossible regardless of what the agent believes.
CREATE TABLE IF NOT EXISTS feedback_emails (
  id               BIGSERIAL   PRIMARY KEY,
  feedback_id      BIGINT      NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  kind             TEXT        NOT NULL,
  request          TEXT        NOT NULL,
  idempotency_key  TEXT        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  message_id       TEXT        NULL,
  sent_at          TIMESTAMPTZ NULL,
  error            TEXT        NULL,
  attempts         INT         NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ NULL,
  last_attempt_at  TIMESTAMPTZ NULL,
  dead_lettered_at TIMESTAMPTZ NULL,
  CONSTRAINT feedback_emails_kind_check CHECK (kind IN ('ack','resolved','reply')),
  CONSTRAINT feedback_emails_feedback_id_kind_key UNIQUE (feedback_id, kind)
);

-- replay-pending selects on this: written, not sent, not abandoned.
CREATE INDEX IF NOT EXISTS feedback_emails_unsent_idx
  ON feedback_emails (first_attempt_at)
  WHERE sent_at IS NULL AND dead_lettered_at IS NULL;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/db/migration-094.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Confirm the migration gate is satisfied**

Run: `cd /var/home/jason/Projects/RepOS && bash scripts/check-migration-dryrun.sh`
Expected: exit 0. This migration is purely additive (new nullable columns, a defaulted column, a new table), so the D10 two-step destructive rule does not apply.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/db/migrations/094_feedback_triage.sql api/tests/db/migration-094.test.ts
git commit -m "feat(feedback): migration 094 — triage columns and the email ledger"
```

---

### Task 2: The feedback-level advisory lock

**Files:**
- Create: `api/src/services/feedbackLock.ts`
- Create: `api/tests/services/feedback-lock.test.ts`

**Interfaces:**
- Consumes: `db` from `../db/client.js`.
- Produces:
  - `FEEDBACK_LOCK_CLASS: number`
  - `withFeedbackLock<T>(feedbackId: string | number, fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>`
  - `withFeedbackPairLock<T>(a: string | number, b: string | number, fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>`
  - `LockTimeoutError` (re-exported from `membershipLock.js`)

**Why this exists:** the spec's central concurrency rule. A lock keyed on `(feedback_id, kind)` would not serialize `ack` against `reply` — they are mutually exclusive but hash to different keys, so both could commit while still satisfying `UNIQUE (feedback_id, kind)`. Dedupe additionally needs *both* rows locked, in a fixed order, or `A.dedupe_of = B` can race `B.dedupe_of = C` and form the chain the rules forbid.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-lock.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-lock');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { withFeedbackLock, withFeedbackPairLock, FEEDBACK_LOCK_CLASS, LockTimeoutError } =
  await import('../../src/services/feedbackLock.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

async function heldCount(objid: number): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_locks
      WHERE locktype='advisory' AND classid=$1 AND objid=$2 AND granted`,
    [FEEDBACK_LOCK_CLASS, objid],
  );
  return Number(rows[0].n);
}

describe('withFeedbackLock', () => {
  it('holds the lock during the callback and releases it after', async () => {
    let inside = -1;
    await withFeedbackLock(7, async () => {
      inside = await heldCount(7);
    });
    expect(inside).toBe(1);
    expect(await heldCount(7)).toBe(0);
  });

  it('releases the lock when the callback throws', async () => {
    await expect(
      withFeedbackLock(8, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await heldCount(8)).toBe(0);
  });

  it('serializes two concurrent holders of the same id', async () => {
    const order: string[] = [];
    const slow = withFeedbackLock(9, async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 120));
      order.push('a-end');
    });
    await new Promise((r) => setTimeout(r, 20));
    const fast = withFeedbackLock(9, async () => {
      order.push('b-start');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
  });

  it('does not serialize different ids', async () => {
    const order: string[] = [];
    const a = withFeedbackLock(10, async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 120));
      order.push('a-end');
    });
    await new Promise((r) => setTimeout(r, 20));
    const b = withFeedbackLock(11, async () => {
      order.push('b-start');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'b-start', 'a-end']);
  });

  it('times out rather than blocking forever', async () => {
    const holder = withFeedbackLock(12, async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      withFeedbackLock(12, async () => undefined, { timeoutMs: 60 }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    await holder;
  });

  it('rejects an id outside int4, rather than silently colliding', async () => {
    await expect(withFeedbackLock('4294967296', async () => undefined)).rejects.toThrow(
      /feedback id out of advisory-lock range/,
    );
  });
});

describe('withFeedbackPairLock', () => {
  it('takes both locks regardless of the order given', async () => {
    let seen: number[] = [];
    await withFeedbackPairLock(21, 20, async () => {
      const { rows } = await db.query<{ objid: number }>(
        `SELECT objid FROM pg_locks
          WHERE locktype='advisory' AND classid=$1 AND granted AND objid IN (20,21)
          ORDER BY objid`,
        [FEEDBACK_LOCK_CLASS],
      );
      seen = rows.map((r) => Number(r.objid));
    });
    expect(seen).toEqual([20, 21]);
    expect(await heldCount(20)).toBe(0);
    expect(await heldCount(21)).toBe(0);
  });

  it('does not deadlock when two callers take the same pair in opposite orders', async () => {
    // Both acquire in ascending order internally, so this cannot deadlock.
    const a = withFeedbackPairLock(30, 31, async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    const b = withFeedbackPairLock(31, 30, async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    await expect(Promise.all([a, b])).resolves.toBeDefined();
  });

  it('locks once when both ids are the same', async () => {
    await withFeedbackPairLock(40, 40, async () => {
      expect(await heldCount(40)).toBe(1);
    });
    expect(await heldCount(40)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-lock.test.ts`
Expected: FAIL — cannot resolve `../../src/services/feedbackLock.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/feedbackLock.ts`:

```ts
// Feedback triage — the concurrency primitive the whole design rests on.
//
// The lock is keyed on the FEEDBACK ID ALONE, never on (feedback_id, kind).
// `ack` and `reply` are mutually exclusive but hash to different keys, so a
// per-kind lock would let two concurrent calls each see no conflicting row and
// both commit — defeating the exclusivity rule while still satisfying
// UNIQUE (feedback_id, kind). The unique constraint stops same-kind
// duplication; only a feedback-level lock stops cross-kind duplication.
//
// Session-level, and polled rather than blocking, for the same reasons as
// membershipLock.ts: a blocking acquire sits inside one statement and is killed
// by statement_timeout with no way to tell it from a real failure.
import { db } from '../db/client.js';
import { LockTimeoutError } from './membershipLock.js';

export { LockTimeoutError };

/** Arbitrary but stable classid: 0x46424B31 == 'FBK1'. */
export const FEEDBACK_LOCK_CLASS = 0x46424b31;

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_MS = 25;

/**
 * pg_advisory_lock's two-key form takes int4s, so the feedback id must fit.
 * At beta volume it always will; failing loudly is still better than silently
 * truncating two different rows onto one lock.
 */
function toObjId(feedbackId: string | number): number {
  const n = Number(feedbackId);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) {
    throw new Error(`feedback id out of advisory-lock range: ${feedbackId}`);
  }
  return n;
}

async function acquire(
  client: pgClient,
  objId: number,
  deadline: number,
): Promise<void> {
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [FEEDBACK_LOCK_CLASS, objId],
    );
    if (rows[0].locked) return;
    if (Date.now() >= deadline) throw new LockTimeoutError(`feedback lock ${objId} timed out`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

type pgClient = Awaited<ReturnType<typeof db.connect>>;

async function withObjIds<T>(
  objIds: number[],
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const client = await db.connect();
  const held: number[] = [];
  try {
    for (const id of objIds) {
      await acquire(client, id, deadline);
      held.push(id);
    }
    return await fn();
  } finally {
    for (const id of held.reverse()) {
      await client
        .query('SELECT pg_advisory_unlock($1, $2)', [FEEDBACK_LOCK_CLASS, id])
        .catch(() => {
          /* connection already dead — session end released it */
        });
    }
    client.release();
  }
}

/** Run `fn` while holding the lock for one feedback row. */
export function withFeedbackLock<T>(
  feedbackId: string | number,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return withObjIds([toObjId(feedbackId)], fn, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

/**
 * Run `fn` while holding BOTH rows' locks — required by dedupe.
 *
 * Setting A.dedupe_of = B while locking only A is racy: a concurrent call can
 * point B at C, and both commit having each seen a valid canonical target,
 * producing the A -> B -> C chain the rules forbid. Acquisition is always in
 * ascending id order so two callers touching the same pair cannot deadlock.
 */
export function withFeedbackPairLock<T>(
  a: string | number,
  b: string | number,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const ids = [toObjId(a), toObjId(b)];
  const ordered = ids[0] === ids[1] ? [ids[0]] : ids.sort((x, y) => x - y);
  return withObjIds(ordered, fn, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-lock.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Prove the test can fail (mutation check)**

Temporarily change `FEEDBACK_LOCK_CLASS` usage in `withFeedbackLock` to key on `[FEEDBACK_LOCK_CLASS, objId + Math.random() * 0]`… no — instead make the real mutation: change `acquire`'s key to include the kind by replacing `objId` with a constant `1` in `withFeedbackLock` only.

Run the suite. Expected: "does not serialize different ids" FAILS. Revert the mutation and re-run to confirm green.

This is the check that matters: it proves the test would notice if the lock stopped distinguishing rows.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackLock.ts api/tests/services/feedback-lock.test.ts
git commit -m "feat(feedback): feedback-level advisory lock with ordered pair acquisition"
```

---

### Task 3: Classification — `triage` and `defer`

**Files:**
- Create: `api/src/services/feedbackTriage.ts`
- Create: `api/tests/services/feedback-triage.test.ts`

**Interfaces:**
- Consumes: `withFeedbackLock`, `withFeedbackPairLock` from `./feedbackLock.js`; `db` from `../db/client.js`.
- Produces:
  - `type FeedbackCategory = 'bug' | 'ux' | 'feature' | 'question' | 'noise'`
  - `type FeedbackSeverity = 'p1' | 'p2' | 'p3'`
  - `type FixStatus = 'n/a' | 'needed' | 'patch_submitted' | 'pr_open' | 'merged' | 'deferred'`
  - `class TriageError extends Error { readonly code: TriageErrorCode }`
  - `triage(input: TriageInput): Promise<void>` where `TriageInput = { id: string; category: FeedbackCategory; severity?: FeedbackSeverity | null; note: string; dedupeOf?: string | null }`
  - `defer(id: string, reason: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-triage.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-triage');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { triage, defer, TriageError } = await import('../../src/services/feedbackTriage.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

async function mkFeedback(body = 'it broke'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ($1,'sub@example.test') RETURNING id`,
    [body],
  );
  return rows[0].id;
}

async function row(id: string) {
  const { rows } = await db.query(`SELECT * FROM feedback WHERE id=$1`, [id]);
  return rows[0];
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
});

describe('triage', () => {
  it('classifies a bug, sets triaged_at, and puts it in the fix queue', async () => {
    const id = await mkFeedback();
    await triage({ id, category: 'bug', severity: 'p2', note: 'reproduced' });
    const r = await row(id);
    expect(r.category).toBe('bug');
    expect(r.severity).toBe('p2');
    expect(r.triage_note).toBe('reproduced');
    expect(r.triaged_at).not.toBeNull();
    expect(r.fix_status).toBe('needed');
  });

  it('leaves noise out of the fix queue and refuses a severity for it', async () => {
    const id = await mkFeedback('yo dawg');
    await triage({ id, category: 'noise', note: 'conversational' });
    expect((await row(id)).fix_status).toBe('n/a');

    const other = await mkFeedback('yo dawg again');
    await expect(
      triage({ id: other, category: 'noise', severity: 'p3', note: 'x' }),
    ).rejects.toMatchObject({ code: 'severity_not_allowed' });
  });

  it('requires a severity for bug, ux and feature', async () => {
    const id = await mkFeedback();
    await expect(triage({ id, category: 'bug', note: 'x' })).rejects.toMatchObject({
      code: 'severity_required',
    });
  });

  it('requires a non-empty note', async () => {
    const id = await mkFeedback();
    await expect(
      triage({ id, category: 'question', note: '   ' }),
    ).rejects.toMatchObject({ code: 'note_required' });
  });

  it('is idempotent-by-overwrite: re-running replaces the classification', async () => {
    const id = await mkFeedback();
    await triage({ id, category: 'bug', severity: 'p1', note: 'first' });
    const firstTriagedAt = (await row(id)).triaged_at;
    await triage({ id, category: 'ux', severity: 'p3', note: 'second' });
    const r = await row(id);
    expect(r.category).toBe('ux');
    expect(r.severity).toBe('p3');
    // triaged_at is a "somebody looked" stamp; it does not move on re-triage.
    expect(r.triaged_at).toEqual(firstTriagedAt);
  });

  it('404s on an unknown id', async () => {
    await expect(
      triage({ id: '999999', category: 'bug', severity: 'p2', note: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('triage with dedupe_of', () => {
  it('marks a duplicate n/a so it never enters the fix queue', async () => {
    const canonical = await mkFeedback('programs page broken on mobile');
    const dup = await mkFeedback('programs page looks wrong on my phone');
    await triage({ id: canonical, category: 'bug', severity: 'p2', note: 'canonical' });
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'same thing', dedupeOf: canonical });

    const r = await row(dup);
    expect(r.dedupe_of).toBe(canonical);
    // A duplicate's canonical row owns the fix. Two rows describing one bug
    // would otherwise each get a worktree, a patch and a pull request.
    expect(r.fix_status).toBe('n/a');
    expect((await row(canonical)).fix_status).toBe('needed');
  });

  it('drops an already-needed row to n/a when it is later found to be a duplicate', async () => {
    const canonical = await mkFeedback('a');
    const dup = await mkFeedback('b');
    await triage({ id: canonical, category: 'bug', severity: 'p2', note: 'canonical' });
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'looked new' });
    expect((await row(dup)).fix_status).toBe('needed');

    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'dup after all', dedupeOf: canonical });
    expect((await row(dup)).fix_status).toBe('n/a');
  });

  it('rejects a self-reference', async () => {
    const id = await mkFeedback();
    await expect(
      triage({ id, category: 'bug', severity: 'p2', note: 'x', dedupeOf: id }),
    ).rejects.toMatchObject({ code: 'dedupe_self' });
  });

  it('rejects pointing at a row that is itself a duplicate (no chains)', async () => {
    const a = await mkFeedback('a');
    const b = await mkFeedback('b');
    const c = await mkFeedback('c');
    await triage({ id: a, category: 'bug', severity: 'p2', note: 'canonical' });
    await triage({ id: b, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: a });
    await expect(
      triage({ id: c, category: 'bug', severity: 'p2', note: 'chain', dedupeOf: b }),
    ).rejects.toMatchObject({ code: 'dedupe_not_canonical' });
  });

  it('rejects making a row a duplicate while other rows point at it', async () => {
    const a = await mkFeedback('a');
    const b = await mkFeedback('b');
    const c = await mkFeedback('c');
    await triage({ id: a, category: 'bug', severity: 'p2', note: 'canonical' });
    await triage({ id: b, category: 'bug', severity: 'p2', note: 'dup', dedupeOf: a });
    await triage({ id: c, category: 'bug', severity: 'p2', note: 'canonical too' });
    // `a` has a dependant, so it cannot become a duplicate itself.
    await expect(
      triage({ id: a, category: 'bug', severity: 'p2', note: 'oops', dedupeOf: c }),
    ).rejects.toMatchObject({ code: 'dedupe_has_dependants' });
  });

  it('rejects an unknown canonical id', async () => {
    const id = await mkFeedback();
    await expect(
      triage({ id, category: 'bug', severity: 'p2', note: 'x', dedupeOf: '999999' }),
    ).rejects.toMatchObject({ code: 'dedupe_target_not_found' });
  });
});

describe('defer', () => {
  it('is terminal and records the reason', async () => {
    const id = await mkFeedback('please add dark mode for my toaster');
    await triage({ id, category: 'feature', severity: 'p3', note: 'a feature request' });
    await defer(id, 'out of scope for beta');
    const r = await row(id);
    expect(r.fix_status).toBe('deferred');
    expect(r.triage_note).toContain('out of scope for beta');
  });

  it('requires a reason', async () => {
    const id = await mkFeedback();
    await triage({ id, category: 'bug', severity: 'p3', note: 'x' });
    await expect(defer(id, '  ')).rejects.toMatchObject({ code: 'reason_required' });
  });

  it('refuses to defer an unclassified row', async () => {
    const id = await mkFeedback();
    await expect(defer(id, 'nope')).rejects.toMatchObject({ code: 'not_classified' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-triage.test.ts`
Expected: FAIL — cannot resolve `../../src/services/feedbackTriage.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/feedbackTriage.ts`:

```ts
// Feedback triage — classification. The mechanical half of the design: this is
// tested code so that the agent's only job is judgement, never bookkeeping.
import { db } from '../db/client.js';
import { withFeedbackLock, withFeedbackPairLock } from './feedbackLock.js';

export type FeedbackCategory = 'bug' | 'ux' | 'feature' | 'question' | 'noise';
export type FeedbackSeverity = 'p1' | 'p2' | 'p3';
export type FixStatus =
  | 'n/a'
  | 'needed'
  | 'patch_submitted'
  | 'pr_open'
  | 'merged'
  | 'deferred';

/** Categories that can produce a fix, and therefore an ack/resolved pair. */
export const FIXABLE: readonly FeedbackCategory[] = ['bug', 'ux', 'feature'];
/** Categories that get exactly one terminal `reply`. */
export const TERMINAL: readonly FeedbackCategory[] = ['question', 'noise'];

export type TriageErrorCode =
  | 'not_found'
  | 'note_required'
  | 'severity_required'
  | 'severity_not_allowed'
  | 'dedupe_self'
  | 'dedupe_target_not_found'
  | 'dedupe_not_canonical'
  | 'dedupe_has_dependants'
  | 'not_classified'
  | 'reason_required';

export class TriageError extends Error {
  readonly code: TriageErrorCode;
  constructor(code: TriageErrorCode, message: string) {
    super(message);
    this.name = 'TriageError';
    this.code = code;
  }
}

export interface TriageInput {
  id: string;
  category: FeedbackCategory;
  severity?: FeedbackSeverity | null;
  note: string;
  dedupeOf?: string | null;
}

/**
 * Classify a row.
 *
 * Re-runnable: a misclassification is corrected by running this again. It never
 * un-sends an email, so the email rules are evaluated against whatever the
 * category is at send time.
 *
 * `triaged_at` uses COALESCE deliberately — it means "somebody looked at this",
 * matching the admin UI's meaning from 070, and must not creep forward on every
 * re-triage. Queue membership is `category IS NULL`, never this column.
 */
export async function triage(input: TriageInput): Promise<void> {
  const note = input.note.trim();
  if (note === '') throw new TriageError('note_required', 'a triage note is required');

  const wantsSeverity = FIXABLE.includes(input.category);
  if (wantsSeverity && !input.severity) {
    throw new TriageError('severity_required', `${input.category} requires a severity`);
  }
  if (!wantsSeverity && input.severity) {
    throw new TriageError('severity_not_allowed', `${input.category} takes no severity`);
  }
  if (input.dedupeOf && String(input.dedupeOf) === String(input.id)) {
    throw new TriageError('dedupe_self', 'a row cannot be its own duplicate');
  }

  const run = async () => {
    const { rows: self } = await db.query<{ id: string }>(
      `SELECT id FROM feedback WHERE id=$1`,
      [input.id],
    );
    if (self.length === 0) throw new TriageError('not_found', `feedback ${input.id} not found`);

    if (input.dedupeOf) {
      const { rows: target } = await db.query<{ id: string; dedupe_of: string | null }>(
        `SELECT id, dedupe_of FROM feedback WHERE id=$1`,
        [input.dedupeOf],
      );
      if (target.length === 0) {
        throw new TriageError('dedupe_target_not_found', `feedback ${input.dedupeOf} not found`);
      }
      // Only a canonical row may be a dedupe target: chains are forbidden, and
      // check-shipped resolves exactly one hop through dedupe_of.
      if (target[0].dedupe_of !== null) {
        throw new TriageError('dedupe_not_canonical', 'dedupe target is itself a duplicate');
      }
      const { rows: dependants } = await db.query(
        `SELECT 1 FROM feedback WHERE dedupe_of=$1 LIMIT 1`,
        [input.id],
      );
      if (dependants.length > 0) {
        throw new TriageError(
          'dedupe_has_dependants',
          'other rows point at this one; it cannot become a duplicate',
        );
      }
    }

    // A duplicate's canonical row owns the fix, so the duplicate never enters
    // the fix queue — including a row that was already `needed` when the
    // duplication was spotted.
    const fixStatus: FixStatus = input.dedupeOf
      ? 'n/a'
      : FIXABLE.includes(input.category)
        ? 'needed'
        : 'n/a';

    await db.query(
      `UPDATE feedback
          SET category    = $2,
              severity    = $3,
              triage_note = $4,
              dedupe_of   = $5,
              fix_status  = $6,
              triaged_at  = COALESCE(triaged_at, now())
        WHERE id = $1`,
      [input.id, input.category, input.severity ?? null, note, input.dedupeOf ?? null, fixStatus],
    );
  };

  // Both rows are locked when a dedupe target is involved, in ascending id
  // order, so `A.dedupe_of = B` cannot race `B.dedupe_of = C` into a chain.
  return input.dedupeOf
    ? withFeedbackPairLock(input.id, input.dedupeOf, run)
    : withFeedbackLock(input.id, run);
}

/**
 * Terminal "no fix is planned". Without this a feature request nobody intends
 * to build sits in the fix queue forever.
 */
export async function defer(id: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed === '') throw new TriageError('reason_required', 'a defer reason is required');

  return withFeedbackLock(id, async () => {
    const { rows } = await db.query<{ category: string | null; triage_note: string | null }>(
      `SELECT category, triage_note FROM feedback WHERE id=$1`,
      [id],
    );
    if (rows.length === 0) throw new TriageError('not_found', `feedback ${id} not found`);
    if (rows[0].category === null) {
      throw new TriageError('not_classified', 'classify the row before deferring it');
    }
    const note = `${rows[0].triage_note ?? ''}\n\nDeferred: ${trimmed}`.trim();
    await db.query(`UPDATE feedback SET fix_status='deferred', triage_note=$2 WHERE id=$1`, [
      id,
      note,
    ]);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-triage.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Mutation-check the duplicate rule**

In `feedbackTriage.ts`, temporarily change the `fixStatus` ternary to ignore `input.dedupeOf`:

```ts
const fixStatus: FixStatus = FIXABLE.includes(input.category) ? 'needed' : 'n/a';
```

Run: `npx vitest run tests/services/feedback-triage.test.ts`
Expected: FAIL — "marks a duplicate n/a so it never enters the fix queue" and "drops an already-needed row to n/a" both fail.

Revert the mutation and re-run. Expected: PASS. This proves the test would catch two PRs being opened for one bug.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackTriage.ts api/tests/services/feedback-triage.test.ts
git commit -m "feat(feedback): triage and defer with ordered dedupe locking"
```

---

### Task 4: The four queues

**Files:**
- Modify: `api/src/services/feedbackTriage.ts` (append)
- Create: `api/tests/services/feedback-queues.test.ts`

**Interfaces:**
- Consumes: `db`, and the types from Task 3.
- Produces:
  - `interface QueueRow { id: string; body: string; route: string | null; created_at: Date; category: FeedbackCategory | null; severity: FeedbackSeverity | null; user_email_at_submit: string | null; fix_status: FixStatus; dedupe_of: string | null }`
  - `listUntriaged(): Promise<QueueRow[]>`
  - `listPending(): Promise<QueueRow[]>`
  - `listFixPending(): Promise<QueueRow[]>`
  - `listDeadLettered(): Promise<Array<{ feedback_id: string; kind: string; error: string | null; dead_lettered_at: Date; user_email_at_submit: string | null }>>`

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-queues.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-queues');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 4 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;

const { db } = await import('../../src/db/client.js');
const { triage, defer, listUntriaged, listPending, listFixPending, listDeadLettered } =
  await import('../../src/services/feedbackTriage.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

async function mkFeedback(body: string, email: string | null = 'sub@example.test'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ($1,$2) RETURNING id`,
    [body, email],
  );
  return rows[0].id;
}

async function mkEmail(
  feedbackId: string,
  kind: 'ack' | 'reply' | 'resolved',
  over: { sent?: boolean; deadLettered?: boolean; error?: string } = {},
) {
  await db.query(
    `INSERT INTO feedback_emails
       (feedback_id, kind, request, idempotency_key, sent_at, dead_lettered_at, error, attempts, first_attempt_at)
     VALUES ($1,$2,'{}',$3,$4,$5,$6,1,now())`,
    [
      feedbackId,
      kind,
      `fb-${kind}-${feedbackId}`,
      over.sent ? new Date() : null,
      over.deadLettered ? new Date() : null,
      over.error ?? null,
    ],
  );
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
});

describe('listUntriaged', () => {
  it('returns unclassified rows oldest first', async () => {
    const a = await mkFeedback('first');
    const b = await mkFeedback('second');
    const rows = await listUntriaged();
    expect(rows.map((r) => r.id)).toEqual([a, b]);
  });

  it('still returns a row the admin UI merely stamped triaged_at on', async () => {
    // adminFeedback.ts sets ONLY triaged_at. Keying the queue on that column
    // would drop this row silently, unclassified and unanswered.
    const id = await mkFeedback('clicked in the admin UI');
    await db.query(`UPDATE feedback SET triaged_at=now() WHERE id=$1`, [id]);
    expect((await listUntriaged()).map((r) => r.id)).toEqual([id]);
  });

  it('excludes classified rows', async () => {
    const id = await mkFeedback('x');
    await triage({ id, category: 'noise', note: 'junk' });
    expect(await listUntriaged()).toHaveLength(0);
  });
});

describe('listPending', () => {
  it('returns a classified row whose first email was never written', async () => {
    const id = await mkFeedback('x');
    await triage({ id, category: 'bug', severity: 'p2', note: 'real' });
    expect((await listPending()).map((r) => r.id)).toEqual([id]);
  });

  it('excludes a row that already has its ledger row, even unsent', async () => {
    // The written-but-unsent case belongs to replayPending, not here.
    const id = await mkFeedback('x');
    await triage({ id, category: 'bug', severity: 'p2', note: 'real' });
    await mkEmail(id, 'ack');
    expect(await listPending()).toHaveLength(0);
  });

  it('expects reply for noise and question, ack for the rest', async () => {
    const noisy = await mkFeedback('yo');
    await triage({ id: noisy, category: 'noise', note: 'junk' });
    await mkEmail(noisy, 'ack'); // wrong kind for noise
    expect((await listPending()).map((r) => r.id)).toEqual([noisy]);

    await db.query('DELETE FROM feedback_emails');
    await mkEmail(noisy, 'reply');
    expect(await listPending()).toHaveLength(0);
  });

  it('excludes rows with no submitter address', async () => {
    const id = await mkFeedback('anonymous', null);
    await triage({ id, category: 'bug', severity: 'p3', note: 'no address' });
    expect(await listPending()).toHaveLength(0);
  });
});

describe('listFixPending', () => {
  it('returns needed, patch_submitted and pr_open canonical rows', async () => {
    const a = await mkFeedback('a');
    await triage({ id: a, category: 'bug', severity: 'p1', note: 'x' });
    const b = await mkFeedback('b');
    await triage({ id: b, category: 'ux', severity: 'p3', note: 'x' });
    await db.query(`UPDATE feedback SET fix_status='pr_open' WHERE id=$1`, [b]);
    expect((await listFixPending()).map((r) => r.id).sort()).toEqual([a, b].sort());
  });

  it('excludes duplicates, deferred, merged, and unclassified rows', async () => {
    const canonical = await mkFeedback('canonical');
    await triage({ id: canonical, category: 'bug', severity: 'p2', note: 'x' });
    const dup = await mkFeedback('dup');
    await triage({ id: dup, category: 'bug', severity: 'p2', note: 'x', dedupeOf: canonical });

    const deferred = await mkFeedback('deferred');
    await triage({ id: deferred, category: 'feature', severity: 'p3', note: 'x' });
    await defer(deferred, 'not now');

    const merged = await mkFeedback('merged');
    await triage({ id: merged, category: 'bug', severity: 'p2', note: 'x' });
    await db.query(`UPDATE feedback SET fix_status='merged' WHERE id=$1`, [merged]);

    await mkFeedback('untouched');

    expect((await listFixPending()).map((r) => r.id)).toEqual([canonical]);
  });
});

describe('listDeadLettered', () => {
  it('returns abandoned sends with their reason and recipient', async () => {
    const id = await mkFeedback('x');
    await triage({ id, category: 'bug', severity: 'p2', note: 'x' });
    await mkEmail(id, 'ack', { deadLettered: true, error: 'recipient suppressed' });
    const rows = await listDeadLettered();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feedback_id: id,
      kind: 'ack',
      error: 'recipient suppressed',
      user_email_at_submit: 'sub@example.test',
    });
  });

  it('excludes sent and still-retrying rows', async () => {
    const id = await mkFeedback('x');
    await triage({ id, category: 'bug', severity: 'p2', note: 'x' });
    await mkEmail(id, 'ack', { sent: true });
    await mkEmail(id, 'resolved', { error: 'timeout' });
    expect(await listDeadLettered()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-queues.test.ts`
Expected: FAIL — `listUntriaged is not a function`.

- [ ] **Step 3: Append the implementation to `feedbackTriage.ts`**

```ts
export interface QueueRow {
  id: string;
  body: string;
  route: string | null;
  created_at: Date;
  category: FeedbackCategory | null;
  severity: FeedbackSeverity | null;
  user_email_at_submit: string | null;
  fix_status: FixStatus;
  dedupe_of: string | null;
}

const QUEUE_COLS = `id, body, route, created_at, category, severity,
                    user_email_at_submit, fix_status, dedupe_of`;

/**
 * The agent's intake queue.
 *
 * `category IS NULL`, never `triaged_at IS NULL`. PATCH /admin/feedback/:id/
 * triage sets only triaged_at, so a triaged_at-based queue would silently drop
 * any row a human clicked in the admin UI — classified by nobody, answered by
 * nobody.
 */
export async function listUntriaged(): Promise<QueueRow[]> {
  const { rows } = await db.query<QueueRow>(
    `SELECT ${QUEUE_COLS} FROM feedback WHERE category IS NULL ORDER BY created_at, id`,
  );
  return rows;
}

/**
 * Classified rows whose required first email was never written at all.
 *
 * This is the crash gap: the moment `triage` commits a category the row leaves
 * listUntriaged, and if the run dies before the ledger row is written nothing
 * else selects it. The written-but-unsent case is NOT here — that is
 * replayPending's job, and the two are stranded by different mechanisms.
 */
export async function listPending(): Promise<QueueRow[]> {
  const { rows } = await db.query<QueueRow>(
    `SELECT ${QUEUE_COLS}
       FROM feedback f
      WHERE f.category IS NOT NULL
        AND f.user_email_at_submit IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM feedback_emails e
           WHERE e.feedback_id = f.id
             AND e.kind = CASE WHEN f.category IN ('noise','question') THEN 'reply' ELSE 'ack' END
        )
      ORDER BY f.created_at, f.id`,
  );
  return rows;
}

/**
 * Acknowledged items whose fix is unfinished.
 *
 * `dedupe_of IS NULL` matters: a duplicate's canonical row owns the fix, so
 * including duplicates would open two pull requests for one defect.
 */
export async function listFixPending(): Promise<QueueRow[]> {
  const { rows } = await db.query<QueueRow>(
    `SELECT ${QUEUE_COLS}
       FROM feedback
      WHERE fix_status IN ('needed','patch_submitted','pr_open')
        AND dedupe_of IS NULL
      ORDER BY created_at, id`,
  );
  return rows;
}

/** Sends that were abandoned, so a human can see who never heard back. */
export async function listDeadLettered(): Promise<
  Array<{
    feedback_id: string;
    kind: string;
    error: string | null;
    dead_lettered_at: Date;
    user_email_at_submit: string | null;
  }>
> {
  const { rows } = await db.query<{
    feedback_id: string;
    kind: string;
    error: string | null;
    dead_lettered_at: Date;
    user_email_at_submit: string | null;
  }>(
    `SELECT e.feedback_id, e.kind, e.error, e.dead_lettered_at, f.user_email_at_submit
       FROM feedback_emails e
       JOIN feedback f ON f.id = e.feedback_id
      WHERE e.dead_lettered_at IS NOT NULL
      ORDER BY e.dead_lettered_at DESC`,
  );
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-queues.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Mutation-check the queue predicate**

In `listUntriaged`, temporarily change `WHERE category IS NULL` to `WHERE triaged_at IS NULL`.

Run: `npx vitest run tests/services/feedback-queues.test.ts`
Expected: FAIL — "still returns a row the admin UI merely stamped triaged_at on".

Revert and re-run. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackTriage.ts api/tests/services/feedback-queues.test.ts
git commit -m "feat(feedback): the four triage queues"
```

---

### Task 5: Mail copy and the frozen request

**Files:**
- Create: `api/src/services/feedbackMailer.ts`
- Create: `api/tests/services/feedback-mailer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure functions).
- Produces:
  - `const FEEDBACK_REPLY_TO = 'jason@jpmtech.com'`
  - `type EmailKind = 'ack' | 'resolved' | 'reply'`
  - `interface FeedbackRequest { from: string; to: string[]; reply_to: string; subject: string; html: string; text: string }`
  - `interface CopyInput { kind: EmailKind; toEmail: string; feedbackId: string; bodyText: string }`
  - `escapeHtml(s: string): string`
  - `idempotencyKeyFor(kind: EmailKind, feedbackId: string): string`
  - `buildFeedbackRequest(input: CopyInput): FeedbackRequest`
  - `serializeFeedbackRequest(r: FeedbackRequest): string`
  - `assertFeedbackRequest(r: unknown, expectedTo: string, expectedFrom: string): asserts r is FeedbackRequest`
  - `parseFeedbackRequest(stored: string, expectedTo: string, expectedFrom: string): FeedbackRequest`
  - `class MailerError extends Error { readonly code: FeedbackMailerErrorCode }`

**Why the agent's prose is escaped:** the agent writes the words; it does not write markup. The prose it writes is downstream of a feedback body an attacker controls.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-mailer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildFeedbackRequest,
  serializeFeedbackRequest,
  parseFeedbackRequest,
  assertFeedbackRequest,
  idempotencyKeyFor,
  escapeHtml,
  FEEDBACK_REPLY_TO,
} from '../../src/services/feedbackMailer.js';

const FROM = 'feedback@send.jpmtech.com';

function req(over: Partial<Parameters<typeof buildFeedbackRequest>[0]> = {}) {
  return buildFeedbackRequest({
    kind: 'ack',
    toEmail: 'sub@example.test',
    feedbackId: '5',
    bodyText: 'Thanks — logged it.',
    ...over,
  });
}

describe('idempotencyKeyFor', () => {
  it('is deterministic and inside Resend’s 1-256 character limit', () => {
    expect(idempotencyKeyFor('ack', '5')).toBe('fb-ack-5');
    expect(idempotencyKeyFor('ack', '5')).toBe(idempotencyKeyFor('ack', '5'));
    expect(idempotencyKeyFor('resolved', '5')).not.toBe(idempotencyKeyFor('ack', '5'));
    expect(idempotencyKeyFor('reply', '5').length).toBeLessThanOrEqual(256);
  });
});

describe('buildFeedbackRequest', () => {
  it('addresses the submitter, sends from FEEDBACK_FROM_EMAIL, and replies to a human', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    const r = req();
    expect(r.to).toEqual(['sub@example.test']);
    expect(r.from).toBe(FROM);
    expect(r.reply_to).toBe(FEEDBACK_REPLY_TO);
    expect(r.subject).toContain('RepOS');
  });

  it('escapes agent-authored prose rather than trusting it', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    const r = req({ bodyText: 'pwn <img src=x onerror=alert(1)> & "quoted"' });
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('&lt;img');
    expect(r.html).toContain('&amp;');
    // The text part needs no escaping and keeps the original characters.
    expect(r.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('carries no @font-face, since Gmail strips it', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    expect(req().html).not.toContain('@font-face');
  });

  it('renders identically across a wall-clock jump', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    const a = serializeFeedbackRequest(req());
    const b = serializeFeedbackRequest(req());
    expect(a).toBe(b);
  });

  it('fails at use time when FEEDBACK_FROM_EMAIL is unset', () => {
    delete process.env.FEEDBACK_FROM_EMAIL;
    expect(() => req()).toThrow(/FEEDBACK_FROM_EMAIL/);
  });
});

describe('assertFeedbackRequest', () => {
  const good = () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    return JSON.parse(serializeFeedbackRequest(req())) as unknown;
  };

  it('accepts a well-formed request for the right recipient', () => {
    expect(() => assertFeedbackRequest(good(), 'sub@example.test', FROM)).not.toThrow();
  });

  it('rejects a recipient that is not the lifecycle target', () => {
    // The one field where being wrong is actively harmful: a corrupted or
    // tampered row must never mail a third party.
    const r = good() as { to: string[] };
    r.to = ['attacker@example.test'];
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/recipient/);
  });

  it('rejects more than one recipient', () => {
    const r = good() as { to: string[] };
    r.to = ['sub@example.test', 'attacker@example.test'];
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/recipient/);
  });

  it('rejects a rewritten sender', () => {
    const r = good() as { from: string };
    r.from = 'spoofed@elsewhere.test';
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/sender/);
  });

  it('validates rather than defaulting a missing field', () => {
    const r = good() as Record<string, unknown>;
    delete r.subject;
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/subject/);
  });

  it('rejects an empty field', () => {
    const r = good() as Record<string, unknown>;
    r.html = '';
    expect(() => assertFeedbackRequest(r, 'sub@example.test', FROM)).toThrow(/html/);
  });
});

describe('parseFeedbackRequest', () => {
  it('round-trips byte-identically so a replay reuses the same bytes', () => {
    process.env.FEEDBACK_FROM_EMAIL = FROM;
    const original = serializeFeedbackRequest(req());
    const parsed = parseFeedbackRequest(original, 'sub@example.test', FROM);
    expect(serializeFeedbackRequest(parsed)).toBe(original);
  });

  it('rejects unparseable stored bytes', () => {
    expect(() => parseFeedbackRequest('not json', 'sub@example.test', FROM)).toThrow(
      /mail_request_invalid|JSON/,
    );
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-mailer.test.ts`
Expected: FAIL — cannot resolve `../../src/services/feedbackMailer.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/feedbackMailer.ts`:

```ts
// Feedback triage — outbound mail.
//
// Distinct from INVITE_FROM_EMAIL so the two streams can be filtered apart,
// with Reply-To pointing at a human because inbound email is a non-goal: a
// reply must reach a person, not a mailbox nobody reads.
//
// Every constraint from inviteMailer.ts applies and is repeated here rather
// than shared, because the two messages have different lifecycles and coupling
// them would make a change to one silently alter the other.

export const FEEDBACK_REPLY_TO = 'jason@jpmtech.com';
export const APP_URL = 'https://repos.jpmtech.com';

const DEFAULT_TIMEOUT_MS = 10_000;

export type EmailKind = 'ack' | 'resolved' | 'reply';

export type FeedbackMailerErrorCode =
  | 'mail_not_configured'
  | 'mail_http_error'
  | 'mail_timeout'
  | 'mail_request_invalid';

export class MailerError extends Error {
  readonly code: FeedbackMailerErrorCode;
  readonly detail?: string;
  /** Present for HTTP failures; drives the retry/dead-letter classification. */
  readonly status?: number;
  constructor(
    code: FeedbackMailerErrorCode,
    message: string,
    detail?: string,
    status?: number,
  ) {
    super(message);
    this.name = 'MailerError';
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

let mailFetch: typeof fetch | null = null;
export function __setMailFetchForTesting(f: typeof fetch | null): void {
  mailFetch = f;
}

/**
 * Deterministic and stable across retries, so a transport timeout that is
 * replayed cannot double-send inside Resend's 24-hour window. Well inside the
 * 1-256 character limit.
 */
export function idempotencyKeyFor(kind: EmailKind, feedbackId: string): string {
  return `fb-${kind}-${feedbackId}`;
}

/**
 * Agent-authored prose lands inside markup, and it is written downstream of a
 * feedback body an attacker controls. The agent writes words; it does not write
 * markup. The text part needs no equivalent.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface FeedbackRequest {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  html: string;
  text: string;
}

export interface CopyInput {
  kind: EmailKind;
  toEmail: string;
  feedbackId: string;
  /** The agent's prose. Plain text; never markup. */
  bodyText: string;
}

const SUBJECTS: Record<EmailKind, string> = {
  ack: 'RepOS — we got your feedback',
  resolved: 'RepOS — the thing you reported is fixed',
  reply: 'RepOS — about your feedback',
};

export function fromAddress(): string {
  const from = process.env.FEEDBACK_FROM_EMAIL;
  if (!from) {
    // Use time, never boot — matching inviteMailer.ts and the feedback webhook.
    throw new MailerError(
      'mail_not_configured',
      'FEEDBACK_FROM_EMAIL must be set to send feedback mail',
    );
  }
  return from;
}

/**
 * Gmail strips @font-face, so the brand typefaces cannot be relied on:
 * system-font stack, inline CSS, table layout, brand palette.
 *
 * Deliberately contains no timestamp and no random id — the rendered bytes are
 * frozen and replayed verbatim, so anything time-varying would make a replay a
 * different request under the same idempotency key.
 */
function renderHtml(input: CopyInput, from: string): string {
  const body = escapeHtml(input.bodyText).replace(/\n/g, '<br>');
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#0A0D12;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"',
    ' style="background:#0A0D12;padding:24px 0;"><tr><td align="center">',
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"',
    ' style="background:#10141C;border-radius:12px;padding:32px;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',system-ui,sans-serif;',
    'color:#E6EAF2;font-size:15px;line-height:1.55;">',
    '<tr><td>',
    `<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#4D8DFF;">RepOS</div>`,
    `<p style="margin:16px 0 0;">${body}</p>`,
    `<p style="margin:24px 0 0;"><a href="${APP_URL}" style="color:#4D8DFF;">Open RepOS</a></p>`,
    `<p style="margin:24px 0 0;font-size:13px;color:#8A93A6;">`,
    `Reply to this email and it reaches a person.`,
    '</p>',
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
}

function renderText(input: CopyInput): string {
  return [input.bodyText, '', `Open RepOS: ${APP_URL}`, '', 'Reply to this email and it reaches a person.'].join(
    '\n',
  );
}

export function buildFeedbackRequest(input: CopyInput): FeedbackRequest {
  const from = fromAddress();
  return {
    from,
    to: [input.toEmail],
    reply_to: FEEDBACK_REPLY_TO,
    subject: SUBJECTS[input.kind],
    html: renderHtml(input, from),
    text: renderText(input),
  };
}

/**
 * Key order is fixed by hand. Postgres does not preserve JSONB key order, and a
 * replay reconstructed from a round-trip would otherwise stringify differently
 * and be treated by Resend as a new request under the same key.
 */
export function serializeFeedbackRequest(request: FeedbackRequest): string {
  return JSON.stringify({
    from: request.from,
    to: request.to,
    reply_to: request.reply_to,
    subject: request.subject,
    html: request.html,
    text: request.text,
  });
}

/**
 * A persisted request has round-tripped through storage and is untrusted by the
 * time it comes back. Validate, never default: sending a half-shaped body under
 * the original key is how a "replay" quietly becomes a different request.
 *
 * The recipient and the sender are the two fields where being wrong is actively
 * harmful, so both are checked against values derived outside the row.
 */
export function assertFeedbackRequest(
  r: unknown,
  expectedTo: string,
  expectedFrom: string,
): asserts r is FeedbackRequest {
  const o = r as Record<string, unknown> | null;
  const str = (v: unknown) => typeof v === 'string' && v !== '';
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    throw new MailerError('mail_request_invalid', 'stored request is not an object');
  }
  if (!Array.isArray(o.to) || o.to.length !== 1 || o.to[0] !== expectedTo) {
    throw new MailerError(
      'mail_request_invalid',
      `stored request recipient is not the lifecycle target (${expectedTo})`,
    );
  }
  if (o.from !== expectedFrom) {
    throw new MailerError('mail_request_invalid', 'stored request sender is not FEEDBACK_FROM_EMAIL');
  }
  for (const field of ['reply_to', 'subject', 'html', 'text'] as const) {
    if (!str(o[field])) {
      throw new MailerError('mail_request_invalid', `stored request ${field} is missing or empty`);
    }
  }
}

export function parseFeedbackRequest(
  stored: string,
  expectedTo: string,
  expectedFrom: string,
): FeedbackRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (err) {
    throw new MailerError('mail_request_invalid', 'stored request is not valid JSON', String(err));
  }
  assertFeedbackRequest(parsed, expectedTo, expectedFrom);
  return parsed;
}

/** POST to Resend. Throws MailerError; the caller classifies it. */
export async function sendFeedbackRequest(
  request: FeedbackRequest,
  idempotencyKey: string,
  expectedTo: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ messageId: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new MailerError('mail_not_configured', 'RESEND_API_KEY must be set to send feedback mail');
  }
  assertFeedbackRequest(request, expectedTo, fromAddress());

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await (mailFetch ?? fetch)('https://api.resend.com/emails', {
        method: 'POST',
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: serializeFeedbackRequest(request),
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new MailerError('mail_timeout', `Resend send timed out after ${timeoutMs}ms`);
      }
      throw new MailerError('mail_http_error', 'Resend send failed', String(err));
    }

    // The deadline covers the body too: a stalled body would otherwise hold the
    // feedback lock open indefinitely.
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new MailerError('mail_timeout', `Resend body stalled past ${timeoutMs}ms`);
      }
      throw new MailerError('mail_http_error', 'Resend body read failed', String(err));
    }

    if (!res.ok) {
      throw new MailerError(
        'mail_http_error',
        `Resend returned HTTP ${res.status}`,
        text.slice(0, 300),
        res.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MailerError('mail_http_error', 'Resend returned unparseable JSON', text.slice(0, 300));
    }
    const id = (parsed as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') {
      throw new MailerError('mail_http_error', 'Resend response had no message id');
    }
    return { messageId: id };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-mailer.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Mutation-check the recipient guard**

In `assertFeedbackRequest`, temporarily relax the recipient check to `if (!Array.isArray(o.to) || o.to.length === 0)`.

Run: `npx vitest run tests/services/feedback-mailer.test.ts`
Expected: FAIL — "rejects a recipient that is not the lifecycle target" and "rejects more than one recipient".

Revert and re-run. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackMailer.ts api/tests/services/feedback-mailer.test.ts
git commit -m "feat(feedback): mail copy, frozen request, and replay validation"
```

---

### Task 6: The ledger — commit before send

**Files:**
- Create: `api/src/services/feedbackEmails.ts`
- Create: `api/tests/services/feedback-emails.test.ts`

**Interfaces:**
- Consumes: `withFeedbackLock` (Task 2); `FIXABLE`, `TERMINAL`, `TriageError` (Task 3); the mailer (Task 5).
- Produces:
  - `class EmailGateError extends Error { readonly code: EmailGateErrorCode }`
  - `type SendableKind = 'ack' | 'reply'`
  - `sendFeedbackEmail(input: { id: string; kind: SendableKind; bodyText: string }): Promise<SendResult>` where `SendResult = { status: 'sent' | 'already_sent' | 'failed'; messageId?: string; error?: string }`

**The two rules this task enforces in code rather than in the agent's head:**
1. `reply` only for `noise`/`question`; `ack` only for `bug`/`ux`/`feature`; `resolved` is never callable here at all.
2. The ledger row is written **and committed** before the network call.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-emails.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-emails');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 6 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;
process.env.FEEDBACK_FROM_EMAIL = 'feedback@send.jpmtech.com';
process.env.RESEND_API_KEY = 'test-key';

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const mailer = await import('../../src/services/feedbackMailer.js');
const { sendFeedbackEmail } = await import('../../src/services/feedbackEmails.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

function okFetch(id = 'msg-1') {
  return vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200 }));
}

async function mkClassified(
  category: 'bug' | 'noise' | 'question',
  email: string | null = 'sub@example.test',
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x',$1) RETURNING id`,
    [email],
  );
  const id = rows[0].id;
  await triage(
    category === 'bug'
      ? { id, category: 'bug', severity: 'p2', note: 'real' }
      : { id, category, note: 'terminal' },
  );
  return id;
}

async function ledger(id: string) {
  const { rows } = await db.query(`SELECT * FROM feedback_emails WHERE feedback_id=$1`, [id]);
  return rows;
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
  mailer.__setMailFetchForTesting(null);
});

describe('category / kind gating', () => {
  it('sends an ack for a bug', async () => {
    mailer.__setMailFetchForTesting(okFetch());
    const id = await mkClassified('bug');
    const res = await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'logged it' });
    expect(res.status).toBe('sent');
    const rows = await ledger(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('ack');
    expect(rows[0].message_id).toBe('msg-1');
    expect(rows[0].sent_at).not.toBeNull();
  });

  it('refuses an ack for noise, and a reply for a bug', async () => {
    const noisy = await mkClassified('noise');
    await expect(
      sendFeedbackEmail({ id: noisy, kind: 'ack', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'kind_not_allowed_for_category' });

    const bug = await mkClassified('bug');
    await expect(
      sendFeedbackEmail({ id: bug, kind: 'reply', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'kind_not_allowed_for_category' });
  });

  it('offers no way to send a resolved email', async () => {
    const id = await mkClassified('bug');
    await expect(
      // @ts-expect-error 'resolved' is deliberately outside the accepted union
      sendFeedbackEmail({ id, kind: 'resolved', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'kind_not_allowed_for_category' });
  });

  it('refuses to email an unclassified row', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x','sub@example.test') RETURNING id`,
    );
    await expect(
      sendFeedbackEmail({ id: rows[0].id, kind: 'ack', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'not_classified' });
  });

  it('refuses a row with no submitter address and writes no ledger row', async () => {
    const id = await mkClassified('bug', null);
    await expect(
      sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'no_recipient' });
    expect(await ledger(id)).toHaveLength(0);
  });
});

describe('exclusivity', () => {
  it('refuses a reply once an ack exists, and an ack once a reply exists', async () => {
    mailer.__setMailFetchForTesting(okFetch());
    const bug = await mkClassified('bug');
    await sendFeedbackEmail({ id: bug, kind: 'ack', bodyText: 'x' });
    // Reclassify so the category gate would otherwise allow a reply.
    await triage({ id: bug, category: 'noise', note: 'actually junk' });
    await expect(
      sendFeedbackEmail({ id: bug, kind: 'reply', bodyText: 'x' }),
    ).rejects.toMatchObject({ code: 'exclusive_kind_present' });
  });

  it('treats a second send of the same kind as already_sent, not an error', async () => {
    const fetchMock = okFetch();
    mailer.__setMailFetchForTesting(fetchMock);
    const id = await mkClassified('bug');
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' });
    const again = await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'different prose' });
    expect(again.status).toBe('already_sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await ledger(id)).toHaveLength(1);
  });
});

describe('commit before send', () => {
  it('leaves the row durable when the send throws', async () => {
    const id = await mkClassified('bug');
    let observedFromAnotherConnection: unknown = null;

    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        // A SEPARATE pool: the point is that the row is COMMITTED, not merely
        // visible inside an open transaction.
        const probe = new pg.Pool({ connectionString: eph.url, max: 1 });
        const { rows } = await probe.query(
          `SELECT kind, sent_at, message_id, attempts FROM feedback_emails WHERE feedback_id=$1`,
          [id],
        );
        observedFromAnotherConnection = rows[0] ?? null;
        await probe.end();
        throw new Error('network down');
      }),
    );

    const res = await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'logged it' });
    expect(res.status).toBe('failed');

    // Seeded from a non-default value: a test asserting a field ends at its
    // default proves nothing about the path meant to set it.
    expect(observedFromAnotherConnection).toMatchObject({ kind: 'ack', sent_at: null });

    const rows = await ledger(id);
    expect(rows[0].sent_at).toBeNull();
    expect(rows[0].message_id).toBeNull();
    expect(rows[0].error).toContain('network down');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].first_attempt_at).not.toBeNull();
  });

  it('replays byte-identical bytes under the same key after a failure', async () => {
    const id = await mkClassified('bug');
    const bodies: string[] = [];
    const keys: string[] = [];
    const capture = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      keys.push(String((init.headers as Record<string, string>)['Idempotency-Key']));
      throw new Error('still down');
    });
    mailer.__setMailFetchForTesting(capture as unknown as typeof fetch);

    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'first prose' });
    // Different prose on the retry: the frozen bytes must win, not a re-render.
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'COMPLETELY different prose' });

    expect(bodies[0]).toBe(bodies[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(`fb-ack-${id}`);
    expect((await ledger(id))[0].attempts).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-emails.test.ts`
Expected: FAIL — cannot resolve `../../src/services/feedbackEmails.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/feedbackEmails.ts`:

```ts
// Feedback triage — the email ledger.
//
// This module is what makes full autonomy safe. The category/kind gate, the
// exclusivity rule and the commit-before-send ordering live here, in tested
// code, rather than in the agent's reasoning — so the agent cannot double-send
// even if it misbehaves or a run dies partway.
//
// There is deliberately NO way to send a `resolved` email from here. That kind
// is created only by deployment verification (check-shipped, Plan 2).
import { db } from '../db/client.js';
import { withFeedbackLock } from './feedbackLock.js';
import { FIXABLE, TERMINAL } from './feedbackTriage.js';
import type { FeedbackCategory } from './feedbackTriage.js';
import {
  buildFeedbackRequest,
  fromAddress,
  idempotencyKeyFor,
  parseFeedbackRequest,
  sendFeedbackRequest,
  serializeFeedbackRequest,
  MailerError,
} from './feedbackMailer.js';

/** Only the two kinds the agent may ever ask for. */
export type SendableKind = 'ack' | 'reply';

export type EmailGateErrorCode =
  | 'not_found'
  | 'not_classified'
  | 'no_recipient'
  | 'kind_not_allowed_for_category'
  | 'exclusive_kind_present';

export class EmailGateError extends Error {
  readonly code: EmailGateErrorCode;
  constructor(code: EmailGateErrorCode, message: string) {
    super(message);
    this.name = 'EmailGateError';
    this.code = code;
  }
}

function kindAllowed(kind: string, category: FeedbackCategory): kind is SendableKind {
  if (kind === 'ack') return FIXABLE.includes(category);
  if (kind === 'reply') return TERMINAL.includes(category);
  return false;
}

export interface SendResult {
  status: 'sent' | 'already_sent' | 'failed';
  messageId?: string;
  error?: string;
}

/**
 * Write the ledger row, COMMIT, then send.
 *
 * The ordering is the whole point: a crash between the commit and the response
 * leaves durable evidence that the attempt happened, which is recoverable. The
 * reverse ordering leaves a silent gap, which is not.
 *
 * An existing row with `sent_at` is a no-op. An existing unsent row REPLAYS its
 * persisted bytes under its persisted key — never a re-render, because deriving
 * the key from re-rendered content is the same bug wearing a hash.
 */
export async function sendFeedbackEmail(input: {
  id: string;
  kind: SendableKind;
  bodyText: string;
}): Promise<SendResult> {
  return withFeedbackLock(input.id, async () => {
    const { rows } = await db.query<{
      category: FeedbackCategory | null;
      user_email_at_submit: string | null;
    }>(`SELECT category, user_email_at_submit FROM feedback WHERE id=$1`, [input.id]);
    if (rows.length === 0) {
      throw new EmailGateError('not_found', `feedback ${input.id} not found`);
    }
    const { category, user_email_at_submit: to } = rows[0];
    if (category === null) {
      throw new EmailGateError('not_classified', 'classify the row before emailing');
    }
    if (!kindAllowed(input.kind, category)) {
      throw new EmailGateError(
        'kind_not_allowed_for_category',
        `kind '${input.kind}' is not permitted for category '${category}'`,
      );
    }
    if (!to) {
      // Classified and triaged, email skipped — no ledger row is written, so
      // listPending's address predicate keeps it out of the queue forever.
      throw new EmailGateError('no_recipient', 'row has no submitter address');
    }

    // `reply` is exclusive with `ack`/`resolved`, and vice versa. The unique
    // constraint cannot express this; the feedback-level lock is what makes
    // checking it safe.
    const exclusive = input.kind === 'reply' ? ['ack', 'resolved'] : ['reply'];
    const { rows: conflicting } = await db.query<{ kind: string }>(
      `SELECT kind FROM feedback_emails WHERE feedback_id=$1 AND kind = ANY($2)`,
      [input.id, exclusive],
    );
    if (conflicting.length > 0) {
      throw new EmailGateError(
        'exclusive_kind_present',
        `a '${conflicting[0].kind}' email already exists for this row`,
      );
    }

    const key = idempotencyKeyFor(input.kind, input.id);
    const from = fromAddress();

    const { rows: existing } = await db.query<{
      id: string;
      request: string;
      sent_at: Date | null;
      dead_lettered_at: Date | null;
    }>(
      `SELECT id, request, sent_at, dead_lettered_at
         FROM feedback_emails WHERE feedback_id=$1 AND kind=$2`,
      [input.id, input.kind],
    );

    let rowId: string;
    let requestJson: string;

    if (existing.length > 0) {
      if (existing[0].sent_at !== null) return { status: 'already_sent' };
      if (existing[0].dead_lettered_at !== null) {
        return { status: 'failed', error: 'dead-lettered; not retried' };
      }
      rowId = existing[0].id;
      requestJson = existing[0].request;
    } else {
      const request = buildFeedbackRequest({
        kind: input.kind,
        toEmail: to,
        feedbackId: input.id,
        bodyText: input.bodyText,
      });
      requestJson = serializeFeedbackRequest(request);
      const { rows: inserted } = await db.query<{ id: string }>(
        `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [input.id, input.kind, requestJson, key],
      );
      rowId = inserted[0].id;
    }

    // `db` is a Pool and each query auto-commits, so the row above is durable
    // before the call below. Nothing here opens a transaction on purpose.
    await db.query(
      `UPDATE feedback_emails
          SET attempts = attempts + 1,
              first_attempt_at = COALESCE(first_attempt_at, now()),
              last_attempt_at = now()
        WHERE id = $1`,
      [rowId],
    );

    try {
      const request = parseFeedbackRequest(requestJson, to, from);
      const { messageId } = await sendFeedbackRequest(request, key, to);
      await db.query(
        `UPDATE feedback_emails SET sent_at=now(), message_id=$2, error=NULL WHERE id=$1`,
        [rowId, messageId],
      );
      return { status: 'sent', messageId };
    } catch (err) {
      const detail =
        err instanceof MailerError
          ? `${err.code}: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
          : String(err);
      await db.query(`UPDATE feedback_emails SET error=$2 WHERE id=$1`, [
        rowId,
        detail.slice(0, 500),
      ]);
      return { status: 'failed', error: detail };
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-emails.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Mutation-check commit-before-send**

Wrap the insert and the send in a single transaction: change the `INSERT` and the subsequent send to run on one `db.connect()` client inside `BEGIN`/`COMMIT`.

Run: `npx vitest run tests/services/feedback-emails.test.ts`
Expected: FAIL — "leaves the row durable when the send throws" fails, because the separate pool sees no row.

Revert and re-run. Expected: PASS. This is the check that proves the ordering, not merely the outcome.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackEmails.ts api/tests/services/feedback-emails.test.ts
git commit -m "feat(feedback): email ledger with commit-before-send and kind gating"
```

---

### Task 7: Delivery model — retry, pause, dead-letter, replay

**Files:**
- Modify: `api/src/services/feedbackEmails.ts` (append)
- Create: `api/tests/services/feedback-delivery.test.ts`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces:
  - `const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000`
  - `type FailureClass = 'retryable' | 'auth' | 'recipient'`
  - `classifyFailure(err: unknown): FailureClass`
  - `replayPending(opts?: { now?: Date }): Promise<{ sent: number; deadLettered: number; paused: boolean }>`

**The distinction this task exists for:** a 401/403 says nothing about the message and applies to *every* message. Dead-lettering on it would abandon the whole queue in response to an expired key.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-delivery.test.ts`:

```ts
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pg from 'pg';
import { createEphemeralDb } from '../helpers/ephemeral-db.js';
import { runMigrations } from '../../src/db/runMigrations.js';

const eph = await createEphemeralDb('fb-delivery');
{
  const bootstrap = new pg.Pool({ connectionString: eph.url, max: 6 });
  await runMigrations(bootstrap);
  await bootstrap.end();
}
process.env.DATABASE_URL = eph.url;
process.env.FEEDBACK_FROM_EMAIL = 'feedback@send.jpmtech.com';
process.env.RESEND_API_KEY = 'test-key';

const { db } = await import('../../src/db/client.js');
const { triage } = await import('../../src/services/feedbackTriage.js');
const mailer = await import('../../src/services/feedbackMailer.js');
const { sendFeedbackEmail, replayPending, classifyFailure, IDEMPOTENCY_WINDOW_MS } =
  await import('../../src/services/feedbackEmails.js');

afterAll(async () => {
  await db.end();
  await eph.drop();
});

const status = (code: number) =>
  vi.fn(async () => new Response(JSON.stringify({ message: 'no' }), { status: code }));
const ok = () => vi.fn(async () => new Response(JSON.stringify({ id: 'msg-ok' }), { status: 200 }));

async function mkBug(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feedback (body, user_email_at_submit) VALUES ('x','sub@example.test') RETURNING id`,
  );
  await triage({ id: rows[0].id, category: 'bug', severity: 'p2', note: 'real' });
  return rows[0].id;
}

async function ledgerRow(id: string) {
  const { rows } = await db.query(`SELECT * FROM feedback_emails WHERE feedback_id=$1`, [id]);
  return rows[0];
}

beforeEach(async () => {
  await db.query('DELETE FROM feedback_emails');
  await db.query('DELETE FROM feedback');
  mailer.__setMailFetchForTesting(null);
});

describe('classifyFailure', () => {
  it('separates transient, auth and recipient failures', () => {
    const mk = (s: number) => new mailer.MailerError('mail_http_error', 'x', undefined, s);
    expect(classifyFailure(mk(429))).toBe('retryable');
    expect(classifyFailure(mk(500))).toBe('retryable');
    expect(classifyFailure(mk(503))).toBe('retryable');
    expect(classifyFailure(new mailer.MailerError('mail_timeout', 'x'))).toBe('retryable');
    expect(classifyFailure(mk(401))).toBe('auth');
    expect(classifyFailure(mk(403))).toBe('auth');
    expect(classifyFailure(mk(422))).toBe('recipient');
    expect(classifyFailure(mk(400))).toBe('recipient');
  });
});

describe('replayPending', () => {
  it('re-sends a written-but-unsent row using its original bytes and key', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'original prose' });
    const before = await ledgerRow(id);
    expect(before.sent_at).toBeNull();

    const bodies: string[] = [];
    mailer.__setMailFetchForTesting(
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(JSON.stringify({ id: 'msg-replay' }), { status: 200 });
      }) as unknown as typeof fetch,
    );

    const res = await replayPending();
    expect(res).toMatchObject({ sent: 1, deadLettered: 0, paused: false });
    expect(bodies[0]).toBe(before.request);
    const after = await ledgerRow(id);
    expect(after.sent_at).not.toBeNull();
    expect(after.message_id).toBe('msg-replay');
  });

  it('dead-letters a send that is still unsent 24 hours after its first attempt', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' });
    await db.query(
      `UPDATE feedback_emails SET first_attempt_at = now() - interval '25 hours' WHERE feedback_id=$1`,
      [id],
    );

    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    const res = await replayPending();

    expect(res).toMatchObject({ sent: 0, deadLettered: 1 });
    // Ambiguous outcome: it may already have been delivered. Do not risk twice.
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await ledgerRow(id);
    expect(row.dead_lettered_at).not.toBeNull();
    expect(row.sent_at).toBeNull();
  });

  it('dead-letters a recipient-level rejection on the first response', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(status(422));
    const res = await replayPendingAfterInitial(id);
    expect(res.deadLettered).toBe(1);
    expect((await ledgerRow(id)).dead_lettered_at).not.toBeNull();
  });

  it('does NOT dead-letter a 429', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(status(429));
    const res = await replayPendingAfterInitial(id);
    expect(res.deadLettered).toBe(0);
    expect((await ledgerRow(id)).dead_lettered_at).toBeNull();
  });

  it('pauses on 401 and consumes nothing', async () => {
    // An auth failure applies to EVERY message. Dead-lettering on it would burn
    // the whole queue over an expired key.
    const a = await mkBug();
    const b = await mkBug();
    mailer.__setMailFetchForTesting(
      vi.fn(async () => {
        throw new Error('seed');
      }) as unknown as typeof fetch,
    );
    await sendFeedbackEmail({ id: a, kind: 'ack', bodyText: 'x' });
    await sendFeedbackEmail({ id: b, kind: 'ack', bodyText: 'x' });

    const unauthorized = status(401);
    mailer.__setMailFetchForTesting(unauthorized);
    const res = await replayPending();

    expect(res.paused).toBe(true);
    expect(res.sent).toBe(0);
    expect(res.deadLettered).toBe(0);
    // Halted: it did not go on to try the second row.
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect((await ledgerRow(a)).dead_lettered_at).toBeNull();
    expect((await ledgerRow(b)).dead_lettered_at).toBeNull();

    // Once the key is fixed the queue drains intact.
    mailer.__setMailFetchForTesting(ok());
    const after = await replayPending();
    expect(after.sent).toBe(2);
  });

  it('skips rows that are already sent or already dead-lettered', async () => {
    const id = await mkBug();
    mailer.__setMailFetchForTesting(ok());
    await sendFeedbackEmail({ id, kind: 'ack', bodyText: 'x' });
    const fetchMock = ok();
    mailer.__setMailFetchForTesting(fetchMock);
    const res = await replayPending();
    expect(res.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Helper: seed an unsent row, then run one replay pass.
  async function replayPendingAfterInitial(id: string) {
    await db.query(
      `INSERT INTO feedback_emails (feedback_id, kind, request, idempotency_key, attempts, first_attempt_at)
       VALUES ($1,'ack',$2,$3,1,now())`,
      [
        id,
        JSON.stringify({
          from: 'feedback@send.jpmtech.com',
          to: ['sub@example.test'],
          reply_to: 'jason@jpmtech.com',
          subject: 'RepOS — we got your feedback',
          html: '<p>hi</p>',
          text: 'hi',
        }),
        `fb-ack-${id}`,
      ],
    );
    return replayPending();
  }
});

describe('the 24-hour window is the spec value', () => {
  it('is exactly 24 hours', () => {
    expect(IDEMPOTENCY_WINDOW_MS).toBe(86_400_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-delivery.test.ts`
Expected: FAIL — `replayPending is not a function`.

- [ ] **Step 3: Append the implementation to `feedbackEmails.ts`**

```ts
/** Resend forgets an idempotency key after 24 hours. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type FailureClass = 'retryable' | 'auth' | 'recipient';

/**
 * Failures are classified by WHOSE fault they are, because "4xx that is not
 * 429" lumps together two opposite situations.
 *
 * 401/403 says nothing about the message and applies to every message: it is
 * never a reason to abandon a recipient. Everything else 4xx is about this
 * recipient and will not improve with retrying.
 */
export function classifyFailure(err: unknown): FailureClass {
  if (err instanceof MailerError) {
    if (err.code === 'mail_timeout' || err.code === 'mail_not_configured') return 'retryable';
    const status = err.status;
    if (status === undefined) return 'retryable'; // transport/network
    if (status === 401 || status === 403) return 'auth';
    if (status === 429 || status >= 500) return 'retryable';
    return 'recipient';
  }
  return 'retryable';
}

interface PendingRow {
  id: string;
  feedback_id: string;
  kind: string;
  request: string;
  idempotency_key: string;
  first_attempt_at: Date | null;
  user_email_at_submit: string | null;
}

/**
 * Re-attempt every ledger row that is written but unsent.
 *
 * This verb is why the retry policy is real. `listPending` deliberately
 * excludes rows that already have a ledger row, and `listUntriaged` never
 * returns a classified row, so without this nothing would ever select a
 * network-failed send: it would sit untouched until it aged past 24 hours and
 * was dead-lettered with zero retries actually attempted.
 *
 * Sending halts entirely on an auth failure — nothing is consumed, so the queue
 * drains intact once the key is fixed.
 */
export async function replayPending(
  opts: { now?: Date } = {},
): Promise<{ sent: number; deadLettered: number; paused: boolean }> {
  const now = opts.now ?? new Date();
  const { rows } = await db.query<PendingRow>(
    `SELECT e.id, e.feedback_id, e.kind, e.request, e.idempotency_key, e.first_attempt_at,
            f.user_email_at_submit
       FROM feedback_emails e
       JOIN feedback f ON f.id = e.feedback_id
      WHERE e.sent_at IS NULL AND e.dead_lettered_at IS NULL
      ORDER BY e.first_attempt_at NULLS FIRST, e.id`,
  );

  let sent = 0;
  let deadLettered = 0;

  for (const row of rows) {
    const expired =
      row.first_attempt_at !== null &&
      now.getTime() - row.first_attempt_at.getTime() > IDEMPOTENCY_WINDOW_MS;

    if (expired) {
      // Ambiguous: the message may well have been delivered and only the
      // response lost. Past the window there is no way to tell, and this design
      // would rather a submitter miss an acknowledgement than receive it twice.
      await db.query(
        `UPDATE feedback_emails
            SET dead_lettered_at=now(),
                error=COALESCE(error,'') || ' | abandoned: past the 24h idempotency window'
          WHERE id=$1`,
        [row.id],
      );
      deadLettered += 1;
      continue;
    }

    if (!row.user_email_at_submit) {
      await db.query(
        `UPDATE feedback_emails
            SET dead_lettered_at=now(), error='recipient address is gone'
          WHERE id=$1`,
        [row.id],
      );
      deadLettered += 1;
      continue;
    }

    const to = row.user_email_at_submit;
    const outcome = await withFeedbackLock(row.feedback_id, async () => {
      await db.query(
        `UPDATE feedback_emails
            SET attempts = attempts + 1,
                first_attempt_at = COALESCE(first_attempt_at, now()),
                last_attempt_at = now()
          WHERE id = $1`,
        [row.id],
      );
      try {
        const request = parseFeedbackRequest(row.request, to, fromAddress());
        const { messageId } = await sendFeedbackRequest(request, row.idempotency_key, to);
        await db.query(
          `UPDATE feedback_emails SET sent_at=now(), message_id=$2, error=NULL WHERE id=$1`,
          [row.id, messageId],
        );
        return { kind: 'sent' as const };
      } catch (err) {
        const cls = classifyFailure(err);
        const detail = err instanceof Error ? err.message : String(err);
        await db.query(`UPDATE feedback_emails SET error=$2 WHERE id=$1`, [
          row.id,
          detail.slice(0, 500),
        ]);
        if (cls === 'recipient') {
          await db.query(`UPDATE feedback_emails SET dead_lettered_at=now() WHERE id=$1`, [row.id]);
          return { kind: 'dead' as const };
        }
        if (cls === 'auth') return { kind: 'auth' as const };
        return { kind: 'retry' as const };
      }
    });

    if (outcome.kind === 'sent') sent += 1;
    else if (outcome.kind === 'dead') deadLettered += 1;
    else if (outcome.kind === 'auth') {
      // Halt. Nothing further is attempted or consumed this run.
      return { sent, deadLettered, paused: true };
    }
  }

  return { sent, deadLettered, paused: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-delivery.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Mutation-check the auth/recipient split**

In `classifyFailure`, temporarily merge the classes: change the `401 || 403` branch to `return 'recipient';`.

Run: `npx vitest run tests/services/feedback-delivery.test.ts`
Expected: FAIL — "pauses on 401 and consumes nothing" and the `classifyFailure` case both fail.

Revert and re-run. Expected: PASS. This is the test that stops the two failure classes silently being merged back together.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackEmails.ts api/tests/services/feedback-delivery.test.ts
git commit -m "feat(feedback): at-most-once delivery with replay, pause and dead-lettering"
```

---

### Task 8: Active alerts for dead letters and pauses

**Files:**
- Create: `api/src/services/feedbackAlerts.ts`
- Create: `api/tests/services/feedback-alerts.test.ts`

**Interfaces:**
- Consumes: `validateFeedbackWebhookUrl` from `../lib/feedbackWebhook.js` (already exists, added by the 2026-09-04 hardening).
- Produces:
  - `alertDeadLetter(input: { feedbackId: string; kind: string; recipient: string; error: string | null }): Promise<void>`
  - `alertSendingPaused(input: { reason: string }): Promise<void>`
  - `assertAlertingConfigured(): void`

**Why:** a list nobody opens is a silent failure with extra steps. `FEEDBACK_WEBHOOK_URL` is already configured in production and already restricted to `discord.com` by the hardening, so this reuses a working, guarded channel rather than inventing one.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-alerts.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  alertDeadLetter,
  alertSendingPaused,
  assertAlertingConfigured,
  __setAlertFetchForTesting,
} from '../../src/services/feedbackAlerts.js';

const HOOK = 'https://discord.com/api/webhooks/123/abc';

beforeEach(() => {
  process.env.FEEDBACK_WEBHOOK_URL = HOOK;
  __setAlertFetchForTesting(null);
});

describe('assertAlertingConfigured', () => {
  it('throws loudly when the webhook is unset, rather than degrading to silence', () => {
    delete process.env.FEEDBACK_WEBHOOK_URL;
    expect(() => assertAlertingConfigured()).toThrow(/FEEDBACK_WEBHOOK_URL/);
  });

  it('rejects a non-Discord destination', () => {
    process.env.FEEDBACK_WEBHOOK_URL = 'https://evil.example/api/webhooks/1/2';
    expect(() => assertAlertingConfigured()).toThrow(/discord/i);
  });

  it('accepts the configured Discord webhook', () => {
    expect(() => assertAlertingConfigured()).not.toThrow();
  });
});

describe('alertDeadLetter', () => {
  it('posts the feedback id and kind, and never the error body verbatim beyond a cap', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    __setAlertFetchForTesting(
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: String(init.body) });
        return new Response('', { status: 204 });
      }) as unknown as typeof fetch,
    );

    await alertDeadLetter({
      feedbackId: '5',
      kind: 'ack',
      recipient: 'sub@example.test',
      error: 'x'.repeat(5000),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(HOOK);
    expect(calls[0].body).toContain('feedback 5');
    expect(calls[0].body).toContain('ack');
    expect(calls[0].body.length).toBeLessThan(2000);
  });

  it('does not throw when the webhook call fails — alerting is advisory', async () => {
    __setAlertFetchForTesting(
      vi.fn(async () => {
        throw new Error('discord down');
      }) as unknown as typeof fetch,
    );
    await expect(
      alertDeadLetter({ feedbackId: '5', kind: 'ack', recipient: 'a@b.test', error: null }),
    ).resolves.toBeUndefined();
  });
});

describe('alertSendingPaused', () => {
  it('names the reason so an expired key is recognisable', async () => {
    const bodies: string[] = [];
    __setAlertFetchForTesting(
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response('', { status: 204 });
      }) as unknown as typeof fetch,
    );
    await alertSendingPaused({ reason: 'Resend returned HTTP 401' });
    expect(bodies[0]).toContain('401');
    expect(bodies[0]).toMatch(/paused/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-alerts.test.ts`
Expected: FAIL — cannot resolve `../../src/services/feedbackAlerts.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/feedbackAlerts.ts`:

```ts
// Feedback triage — active alerting.
//
// Dead letters and auth pauses must ANNOUNCE themselves. A `list
// --dead-lettered` that nobody opens is a silent failure with extra steps.
//
// This reuses FEEDBACK_WEBHOOK_URL — already configured in production and
// already restricted to discord.com by validateFeedbackWebhookUrl (the
// 2026-09-04 hardening) — rather than introducing a second destination.
import { validateFeedbackWebhookUrl } from '../lib/feedbackWebhook.js';

const TIMEOUT_MS = 5_000;
/** Discord rejects content over 2000 characters. */
const MAX_CONTENT = 1_900;

let alertFetch: typeof fetch | null = null;
export function __setAlertFetchForTesting(f: typeof fetch | null): void {
  alertFetch = f;
}

/**
 * Called at sweep start. If alerting is not configured the run should say so
 * loudly rather than proceed and degrade to silence — an unmonitored dead
 * letter is exactly the outcome this design set out to avoid.
 */
export function assertAlertingConfigured(): void {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  if (!url) {
    throw new Error(
      'FEEDBACK_WEBHOOK_URL must be set: dead letters and auth pauses would otherwise be silent',
    );
  }
  validateFeedbackWebhookUrl(url);
}

/** Advisory: a failed alert must never fail the operation it is reporting on. */
async function post(content: string): Promise<void> {
  const raw = process.env.FEEDBACK_WEBHOOK_URL;
  if (!raw) return;
  let url: string;
  try {
    url = validateFeedbackWebhookUrl(raw);
  } catch {
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    await (alertFetch ?? fetch)(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, MAX_CONTENT) }),
    });
  } catch {
    /* advisory */
  } finally {
    clearTimeout(timer);
  }
}

export async function alertDeadLetter(input: {
  feedbackId: string;
  kind: string;
  recipient: string;
  error: string | null;
}): Promise<void> {
  await post(
    [
      `**Feedback email abandoned** — feedback ${input.feedbackId}, kind \`${input.kind}\`.`,
      `Nobody replied to ${input.recipient}.`,
      input.error ? `Reason: ${input.error.slice(0, 400)}` : 'Reason: unrecorded.',
      'Run `feedback-triage list --dead-lettered` for the full set.',
    ].join('\n'),
  );
}

export async function alertSendingPaused(input: { reason: string }): Promise<void> {
  await post(
    [
      '**Feedback mail is paused** — the provider rejected our credentials.',
      `Reason: ${input.reason.slice(0, 400)}`,
      'Nothing was abandoned; the queue drains once the key is fixed.',
    ].join('\n'),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-alerts.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Wire the alerts into `replayPending`**

In `api/src/services/feedbackEmails.ts`, add the import:

```ts
import { alertDeadLetter, alertSendingPaused } from './feedbackAlerts.js';
```

Then, in `replayPending`, after each place that sets `dead_lettered_at`, fire the alert; and before the `paused` return, fire the pause alert. Add to the expired branch:

```ts
      deadLettered += 1;
      await alertDeadLetter({
        feedbackId: row.feedback_id,
        kind: row.kind,
        recipient: row.user_email_at_submit ?? '(address gone)',
        error: 'past the 24h idempotency window',
      });
      continue;
```

Apply the equivalent to the missing-address branch and the `outcome.kind === 'dead'` branch, and for the pause:

```ts
    else if (outcome.kind === 'auth') {
      await alertSendingPaused({ reason: 'Resend rejected our credentials (401/403)' });
      return { sent, deadLettered, paused: true };
    }
```

- [ ] **Step 6: Run the delivery suite to confirm no regression**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-delivery.test.ts tests/services/feedback-alerts.test.ts`
Expected: PASS. `FEEDBACK_WEBHOOK_URL` is unset in the delivery suite, so `post` returns early and the alerts are inert there.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackAlerts.ts api/tests/services/feedback-alerts.test.ts api/src/services/feedbackEmails.ts
git commit -m "feat(feedback): alert actively on dead letters and auth pauses"
```

---

### Task 9: The operator CLI

**Files:**
- Create: `api/src/services/feedbackTriage-cli.ts`
- Create: `api/tests/services/feedback-cli.test.ts`
- Modify: `api/package.json` (add the `feedback` script)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `buildDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined`
  - `runCli(argv: string[], out: (s: string) => void): Promise<number>` — returns the process exit code.

**Trust note:** this is the **operator** entry point, run by Jason at the same trust level as `psql`. Plan 3 replaces the agent's path with a broker socket and a thin client; this file is not that client.

- [ ] **Step 1: Write the failing test**

Create `api/tests/services/feedback-cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDatabaseUrl } from '../../src/services/feedbackTriage-cli.js';

describe('buildDatabaseUrl', () => {
  it('prefers an explicit DATABASE_URL', () => {
    expect(buildDatabaseUrl({ DATABASE_URL: 'postgres://a/b' })).toBe('postgres://a/b');
  });

  it('builds one from POSTGRES_* when absent, as 002-w9-cf-baseline.sh does', () => {
    // DATABASE_URL is NOT in the container environment: the three s6 scripts
    // each build it into their own service, and `docker exec` inherits none of
    // that. A CLI that assumes it is ambient fails with FATAL 28000.
    expect(
      buildDatabaseUrl({
        POSTGRES_USER: 'repos',
        POSTGRES_PASSWORD: 'pw',
        POSTGRES_DB: 'repos',
      }),
    ).toBe('postgres://repos:pw@127.0.0.1:5432/repos');
  });

  it('applies the same defaults the shell scripts do', () => {
    expect(buildDatabaseUrl({ POSTGRES_PASSWORD: 'pw' })).toBe(
      'postgres://repos:pw@127.0.0.1:5432/repos',
    );
  });

  it('percent-encodes a password containing URL metacharacters', () => {
    const url = buildDatabaseUrl({ POSTGRES_PASSWORD: 'p@ss:word/#1' });
    expect(url).toBe('postgres://repos:p%40ss%3Aword%2F%231@127.0.0.1:5432/repos');
  });

  it('returns undefined when there is nothing to build from', () => {
    expect(buildDatabaseUrl({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-cli.test.ts`
Expected: FAIL — cannot resolve `../../src/services/feedbackTriage-cli.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/services/feedbackTriage-cli.ts`:

```ts
#!/usr/bin/env node
// Feedback triage — the OPERATOR command line.
//
// Run by a human at the same trust level as psql. The agent does NOT use this:
// its path is a broker socket with no credentials on the agent side (Plan 3).
//
// DATABASE_URL is not ambient under `docker exec` — the three s6 scripts each
// build it into their own service — so this builds its own exactly as
// scripts/cutover/002-w9-cf-baseline.sh now does.

// Type-only, so it is erased at compile time and does NOT pull db/client.js in
// before DATABASE_URL is set. `await import()` gives a value binding, which
// cannot be used in type position.
import type { FeedbackCategory, FeedbackSeverity } from './feedbackTriage.js';

/** Built before any module that opens a pool is imported. */
export function buildDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.POSTGRES_PASSWORD) return undefined;
  const user = encodeURIComponent(env.POSTGRES_USER ?? 'repos');
  const pw = encodeURIComponent(env.POSTGRES_PASSWORD);
  const dbName = env.POSTGRES_DB ?? 'repos';
  return `postgres://${user}:${pw}@127.0.0.1:5432/${dbName}`;
}

const USAGE = `feedback-triage — operator commands

  list --untriaged | --pending | --fix-pending | --dead-lettered
  triage --id ID --category bug|ux|feature|question|noise
         [--severity p1|p2|p3] --note TEXT [--dedupe-of ID]
  defer  --id ID --reason TEXT
  email  --id ID --kind ack|reply --body TEXT
  replay-pending

Every verb is idempotent. 'email' cannot send a 'resolved' notice; that kind is
created only by deployment verification.
`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function runCli(argv: string[], out: (s: string) => void): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    out(USAGE);
    return cmd ? 0 : 1;
  }

  const url = buildDatabaseUrl(process.env);
  if (!url) {
    out('DATABASE_URL is unset and POSTGRES_PASSWORD is not available to build one.');
    return 2;
  }
  process.env.DATABASE_URL = url;

  // Imported AFTER DATABASE_URL is set: db/client.js opens its pool on import.
  const triageSvc = await import('./feedbackTriage.js');
  const emailSvc = await import('./feedbackEmails.js');
  const { db } = await import('../db/client.js');

  try {
    switch (cmd) {
      case 'list': {
        const rows = argv.includes('--pending')
          ? await triageSvc.listPending()
          : argv.includes('--fix-pending')
            ? await triageSvc.listFixPending()
            : argv.includes('--dead-lettered')
              ? await triageSvc.listDeadLettered()
              : await triageSvc.listUntriaged();
        out(JSON.stringify(rows, null, 2));
        return 0;
      }
      case 'triage': {
        const id = flag(argv, 'id');
        const category = flag(argv, 'category');
        const note = flag(argv, 'note');
        if (!id || !category || !note) {
          out('triage requires --id, --category and --note');
          return 2;
        }
        await triageSvc.triage({
          id,
          category: category as FeedbackCategory,
          severity: (flag(argv, 'severity') as FeedbackSeverity) ?? null,
          note,
          dedupeOf: flag(argv, 'dedupe-of') ?? null,
        });
        out(`triaged ${id} as ${category}`);
        return 0;
      }
      case 'defer': {
        const id = flag(argv, 'id');
        const reason = flag(argv, 'reason');
        if (!id || !reason) {
          out('defer requires --id and --reason');
          return 2;
        }
        await triageSvc.defer(id, reason);
        out(`deferred ${id}`);
        return 0;
      }
      case 'email': {
        const id = flag(argv, 'id');
        const kind = flag(argv, 'kind');
        const body = flag(argv, 'body');
        if (!id || !kind || !body) {
          out('email requires --id, --kind and --body');
          return 2;
        }
        if (kind !== 'ack' && kind !== 'reply') {
          out(`kind must be 'ack' or 'reply' — 'resolved' is created only by check-shipped`);
          return 2;
        }
        const res = await emailSvc.sendFeedbackEmail({ id, kind, bodyText: body });
        out(JSON.stringify(res));
        return res.status === 'failed' ? 1 : 0;
      }
      case 'replay-pending': {
        const res = await emailSvc.replayPending();
        out(JSON.stringify(res));
        return res.paused ? 1 : 0;
      }
      default:
        out(`unknown command '${cmd}'\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    out(`error${code ? ` [${code}]` : ''}: ${(err as Error).message}`);
    return 1;
  } finally {
    await db.end().catch(() => {
      /* already closed */
    });
  }
}

// Only self-invoke when run directly, so the test can import the module.
if (process.argv[1] && process.argv[1].endsWith('feedbackTriage-cli.js')) {
  runCli(process.argv.slice(2), (s) => process.stdout.write(`${s}\n`)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(1);
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/jason/Projects/RepOS/api && npx vitest run tests/services/feedback-cli.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the npm script**

In `api/package.json`, add to `"scripts"`:

```json
    "feedback": "node dist/services/feedbackTriage-cli.js",
```

- [ ] **Step 6: Verify the whole plan's suites together, plus the gates**

```bash
cd /var/home/jason/Projects/RepOS/api
npx tsc --noEmit
npm run lint
npm run format:check
npx vitest run tests/db/migration-094.test.ts tests/services/feedback-*.test.ts
```

Expected: typecheck clean, lint 0 errors, format clean, all feedback suites pass.

Then the full API suite:

```bash
npx vitest run
```

Expected: pre-existing parallel-run flakiness may fail a small, *different* set each run. Any file you touched must pass in isolation. If something in `tests/services/feedback-*` fails, that is yours; anything else, confirm it also fails on a stashed clean tree before treating it as a regression.

- [ ] **Step 7: Commit**

```bash
cd /var/home/jason/Projects/RepOS
git add api/src/services/feedbackTriage-cli.ts api/tests/services/feedback-cli.test.ts api/package.json
git commit -m "feat(feedback): operator CLI for the triage verbs"
```

---

## Done criteria for this plan

- [ ] Migration 094 applies cleanly on a fresh database and on production's current schema (`093_cardio_logs`).
- [ ] `npx tsc --noEmit`, `npm run lint` (0 errors) and `npm run format:check` are clean in `api/`.
- [ ] All six new suites pass in isolation.
- [ ] Five mutation checks were each performed and each made the intended test fail: the lock's row distinction (Task 2), the duplicate fix-queue rule (Task 3), the queue predicate (Task 4), the recipient guard (Task 5), commit-before-send (Task 6), and the auth/recipient split (Task 7).
- [ ] Nothing in this plan sends a `resolved` email, reads production over SSH, opens a socket, or runs git. Those are Plans 2 and 3.

## Deferred to Plan 2

`check-shipped` and effective-fix-SHA resolution; `link`; `repos-git`, `submit-patch`, `open-pr`, `approve-patch` and the Ed25519 approval; `reconcile-fixes`; the fast-forward replacement commit.

## Deferred to Plan 3

The broker daemon and its socket; the agent-facing thin client; `.claude/skills/feedback-sweep/SKILL.md`; `scripts/feedback/sweep.sh`; the systemd timer; the model credential proxy; `FEEDBACK_FROM_EMAIL` in the container env and the recreate; the three-principal account setup.
