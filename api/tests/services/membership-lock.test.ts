// Q16 + Q38 — a session-scoped advisory lock on a dedicated pooled connection,
// released in a finally on EVERY path including throw and timeout.
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';
import {
  withMembershipLock,
  LockTimeoutError,
  MEMBERSHIP_LOCK_KEY,
} from '../../src/services/membershipLock.js';

// Verified against PG 16: pg_advisory_lock(bigint) splits the key as
// classid = key >> 32, objid = key & 0xFFFFFFFF. MEMBERSHIP_LOCK_KEY fits in
// 32 bits, so classid is 0 and objid is the key itself.
async function heldLockCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int n FROM pg_locks
      WHERE locktype='advisory' AND objid=$1 AND granted`,
    [MEMBERSHIP_LOCK_KEY],
  );
  return rows[0].n;
}

/** The connection state of whichever backend currently holds the lock. */
async function holderState(): Promise<string | null> {
  const { rows } = await db.query<{ state: string }>(
    `SELECT a.state
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype='advisory' AND l.objid=$1 AND l.granted`,
    [MEMBERSHIP_LOCK_KEY],
  );
  return rows.length ? rows[0].state : null;
}

describe('withMembershipLock', () => {
  it('serializes two concurrent critical sections', async () => {
    const order: string[] = [];
    const slow = withMembershipLock(async () => {
      order.push('a:enter');
      await new Promise((r) => setTimeout(r, 150));
      order.push('a:exit');
    });
    // Give A time to actually acquire before B contends.
    await new Promise((r) => setTimeout(r, 30));
    const fast = withMembershipLock(async () => {
      order.push('b:enter');
      order.push('b:exit');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:enter', 'a:exit', 'b:enter', 'b:exit']);
  });

  it('runs OUTSIDE any transaction — the LOCK-HOLDING backend has no open txn', async () => {
    // The plan's original form ran `txid_current_if_assigned()` through `db`,
    // which checks out a DIFFERENT pooled connection — it would report "no
    // transaction" even if withMembershipLock wrapped its own connection in
    // BEGIN, so it could not fail. Q7's actual requirement is about the
    // connection HOLDING the lock, since that is the one alive across the
    // Cloudflare round-trip. Inspect that backend directly: it must be plain
    // 'idle' between statements, never 'idle in transaction'.
    const observed = await withMembershipLock(async () => {
      const state = await holderState();
      const { rows } = await db.query<{ t: string | null }>(
        `SELECT txid_current_if_assigned()::text t`,
      );
      return { state, callerTxn: rows[0].t };
    });
    expect(observed.state).toBe('idle');
    expect(observed.state).not.toBe('idle in transaction');
    expect(observed.callerTxn).toBeNull();
  });

  it('releases the lock when the body throws', async () => {
    await expect(
      withMembershipLock(async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(await heldLockCount()).toBe(0);
  });

  it('releases the lock on the happy path', async () => {
    await withMembershipLock(async () => 'ok');
    expect(await heldLockCount()).toBe(0);
  });

  it('fails fast with LockTimeoutError rather than blocking the pool', async () => {
    let release!: () => void;
    const holder = withMembershipLock(async () => {
      await new Promise<void>((r) => { release = r; });
    });
    await new Promise((r) => setTimeout(r, 30));
    await expect(
      withMembershipLock(async () => 'never', { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    release();
    await holder;
    expect(await heldLockCount()).toBe(0);
  });
});
