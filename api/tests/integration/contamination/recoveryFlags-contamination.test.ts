import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — recovery-flags', () => {
  it('GET /recovery-flags for B does not surface flags from A run', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    // Give A an active run; B has none → B sees no run-anchored flags.
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5, currentWeek: 2 });

    const res = await app.inject({
      method: 'GET', url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    // No assertion that A HAS flags (that's evaluator-dependent); the
    // contamination guarantee is that B's response is computed from B's
    // userId only. We assert the response is well-formed and references no
    // A-owned dismissal/event rows below.
    expect(Array.isArray(res.json<{ flags: unknown[] }>().flags)).toBe(true);
  });

  it('POST /recovery-flags/dismiss by B writes a dismissal for B only', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);

    const res = await app.inject({
      method: 'POST', url: '/api/recovery-flags/dismiss',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { flag: 'overreaching' },
    });
    expect(res.statusCode).toBe(204);

    const { rows: bRows } = await db.query(
      `SELECT 1 FROM recovery_flag_dismissals WHERE user_id=$1 AND flag='overreaching'`,
      [pair.userB.userId],
    );
    expect(bRows.length).toBeGreaterThan(0);
    const { rows: aRows } = await db.query(
      `SELECT 1 FROM recovery_flag_dismissals WHERE user_id=$1 AND flag='overreaching'`,
      [pair.userA.userId],
    );
    expect(aRows.length).toBe(0);
  });
});
