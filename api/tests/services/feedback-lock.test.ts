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
