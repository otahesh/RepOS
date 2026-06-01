import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, mintBearer, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — weight (bearer health:weight:write)', () => {
  it('POST stamps the token owner; B GET never returns A samples', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { bearer: tokenA } = await mintBearer({ userId: pair.userA.userId, scopes: ['health:weight:write'], label: 'w-a' });
    const { bearer: tokenB } = await mintBearer({ userId: pair.userB.userId, scopes: ['health:weight:write'], label: 'w-b' });

    // A writes one sample.
    const postA = await app.inject({
      method: 'POST', url: '/api/health/weight',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { weight_lbs: 185.4, date: '2026-05-20', time: '07:00:00', source: 'Manual' },
    });
    expect([201, 200]).toContain(postA.statusCode);

    // Row is owned by A.
    const { rows: aRows } = await db.query(
      `SELECT 1 FROM health_weight_samples WHERE user_id=$1`, [pair.userA.userId]);
    expect(aRows.length).toBe(1);

    // B's GET returns NO samples (B has written none; A's are not visible).
    const getB = await app.inject({
      method: 'GET', url: '/api/health/weight?range=all',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getB.statusCode).toBe(200);
    expect(getB.json<{ samples: unknown[] }>().samples).toEqual([]);
  });

  it('POST /backfill by B writes only B rows', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { bearer: tokenB } = await mintBearer({ userId: pair.userB.userId, scopes: ['health:weight:write'], label: 'w-b2' });

    const res = await app.inject({
      method: 'POST', url: '/api/health/weight/backfill',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { samples: [
        { weight_lbs: 190.0, date: '2026-05-18', time: '06:30:00', source: 'Manual' },
        { weight_lbs: 189.5, date: '2026-05-19', time: '06:30:00', source: 'Manual' },
      ] },
    });
    expect(res.statusCode).toBe(200);
    const { rows: bRows } = await db.query(
      `SELECT 1 FROM health_weight_samples WHERE user_id=$1`, [pair.userB.userId]);
    expect(bRows.length).toBe(2);
    const { rows: aRows } = await db.query(
      `SELECT 1 FROM health_weight_samples WHERE user_id=$1`, [pair.userA.userId]);
    expect(aRows.length).toBe(0);
  });

  it('GET /sync/status returns B own default; never A sync state', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { bearer: tokenB } = await mintBearer({ userId: pair.userB.userId, scopes: ['health:weight:write'], label: 'w-b3' });

    // A has a real, FRESH sync row with a distinctive source. B has none.
    await db.query(
      `INSERT INTO health_sync_status
         (user_id, source, last_fired_at, last_success_at, consecutive_failures)
       VALUES ($1, 'Withings', now(), now(), 0)`,
      [pair.userA.userId],
    );

    // The route is registered under prefix '/api/health' (app.ts), so the
    // full path is /api/health/sync/status.
    const getB = await app.inject({
      method: 'GET', url: '/api/health/sync/status',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getB.statusCode).toBe(200);
    const body = getB.json<{ source: string | null; last_success_at: string | null; state: string }>();
    // B sees its OWN empty default — never A's row.
    expect(body.source).toBeNull();
    expect(body.last_success_at).toBeNull();
    expect(body.state).toBe('broken');
    expect(body.source).not.toBe('Withings');
  });
});
