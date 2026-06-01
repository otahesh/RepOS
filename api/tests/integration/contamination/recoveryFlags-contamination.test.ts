import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — recovery-flags', () => {
  it('GET /recovery-flags for B does not surface flags or dismissals from A', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    // Give A an active run; B has none → B sees no run-anchored flags.
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5, currentWeek: 2 });

    // Seed A a known dismissal in the CURRENT ISO week (mirror the dismiss
    // test's table). The week_start formula matches the route (date_trunc).
    const { rows: [{ week_start }] } = await db.query<{ week_start: string }>(
      `SELECT to_char(date_trunc('week', current_date)::date, 'YYYY-MM-DD') AS week_start`,
    );
    await db.query(
      `INSERT INTO recovery_flag_dismissals (user_id, flag, week_start)
       VALUES ($1, 'overreaching', $2)`,
      [pair.userA.userId, week_start],
    );

    const res = await app.inject({
      method: 'GET', url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ flags: Array<{ flag: string; message: string }> }>();
    expect(Array.isArray(body.flags)).toBe(true);

    // B has no run and no dismissals of its own; its response is computed from
    // B's userId alone. A's seeded run + 'overreaching' dismissal must not
    // surface in B's payload, and B's GET must not have written a dismissal
    // (or any other row) into A's identity space.
    expect(body.flags.some((f) => f.flag === 'overreaching')).toBe(false);
    const { rows: bDismissals } = await db.query(
      `SELECT 1 FROM recovery_flag_dismissals WHERE user_id=$1`, [pair.userB.userId]);
    expect(bDismissals.length).toBe(0);
    const { rows: aDismissals } = await db.query(
      `SELECT 1 FROM recovery_flag_dismissals WHERE user_id=$1 AND flag='overreaching'`,
      [pair.userA.userId]);
    expect(aDismissals.length).toBe(1); // A's dismissal untouched by B's GET
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
