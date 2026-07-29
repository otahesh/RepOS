import { db } from '../db/client.js';

/**
 * Q16 — serialization for every transition that affects cohort membership.
 *
 * Session-level (pg_advisory_lock), NOT transaction-level. pg_advisory_xact_lock
 * releases at COMMIT, so it would serialize nothing once the transaction closes
 * — and keeping a transaction open across the Cloudflare HTTP call is exactly
 * what Q7 forbids. A session lock holds across statements without a transaction.
 *
 * Crash safety is free: session end releases the lock (Q16).
 *
 * Arbitrary but stable key: 0x5245504f == 'REPO'.
 */
export const MEMBERSHIP_LOCK_KEY = 0x5245504f;

/**
 * Q26 — role changes and last-admin checks additionally take a
 * TRANSACTION-level lock covering the count-and-mutate, because those are
 * read-then-write and race exactly like the cohort cap did.
 *
 * Lock order is fixed and single: session mutation lock -> BEGIN -> this.
 * 0x41444d4e == 'ADMN'.
 */
export const ADMIN_COUNT_LOCK_KEY = 0x41444d4e;

export class LockTimeoutError extends Error {
  readonly code = 'lock_timeout';
  constructor(message = 'membership lock acquisition timed out') {
    super(message);
    this.name = 'LockTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_MS = 25;

/**
 * Run `fn` while holding the global membership lock.
 *
 * Acquisition is bounded (Q16) so a wedged holder fails fast with 503 instead
 * of blocking the pool. Both the lock and its pooled connection are released
 * in a `finally` on every path — happy, throw, and timeout (Q38). `db` is a
 * Pool with max:20, so one held connection is acceptable at Beta volume, and
 * statement_timeout:5000 is per-statement so it never fires on an idle held
 * connection.
 *
 * We poll pg_try_advisory_lock rather than blocking in pg_advisory_lock
 * because a blocking acquire would sit inside a single statement and be killed
 * by statement_timeout with no way to distinguish it from a real failure.
 */
export async function withMembershipLock<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const client = await db.connect();
  let held = false;
  try {
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [MEMBERSHIP_LOCK_KEY],
      );
      if (rows[0].locked) { held = true; break; }
      if (Date.now() >= deadline) throw new LockTimeoutError();
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return await fn();
  } finally {
    if (held) {
      await client
        .query('SELECT pg_advisory_unlock($1)', [MEMBERSHIP_LOCK_KEY])
        .catch(() => { /* connection already dead — session end released it */ });
    }
    client.release();
  }
}
