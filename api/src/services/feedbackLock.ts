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
import type pg from 'pg';
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

type pgClient = pg.PoolClient;

async function acquire(client: pgClient, objId: number, deadline: number): Promise<void> {
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
export async function withFeedbackLock<T>(
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
export async function withFeedbackPairLock<T>(
  a: string | number,
  b: string | number,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const ids = [toObjId(a), toObjId(b)];
  const ordered = ids[0] === ids[1] ? [ids[0]] : ids.sort((x, y) => x - y);
  return withObjIds(ordered, fn, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}
