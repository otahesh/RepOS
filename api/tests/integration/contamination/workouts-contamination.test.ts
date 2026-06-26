import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import {
  mkUserPair,
  mintBearer,
  cleanupUserPair,
  type UserPairHandle,
} from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupUserPair(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

describe('W8.2 contamination — workouts ingest', () => {
  it('POST /health/workouts stamps the token owner, never another user', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { bearer: bearerB } = await mintBearer({
      userId: pair.userB.userId,
      scopes: ['health:workouts:write'],
      label: 'wk-b',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/health/workouts',
      headers: { authorization: `Bearer ${bearerB}` },
      payload: {
        started_at: '2026-05-20T07:00:00-04:00',
        ended_at: '2026-05-20T07:35:00-04:00',
        modality: 'run', // VALID_MODALITIES (healthWorkouts.ts)
        duration_sec: 2100,
        source: 'Apple Health', // VALID_WORKOUT_SOURCES
      },
    });
    expect([201, 200]).toContain(res.statusCode);

    // The row is owned by B; A has none.
    const { rows: bRows } = await db.query(`SELECT 1 FROM health_workouts WHERE user_id=$1`, [
      pair.userB.userId,
    ]);
    expect(bRows.length).toBeGreaterThan(0);
    const { rows: aRows } = await db.query(`SELECT 1 FROM health_workouts WHERE user_id=$1`, [
      pair.userA.userId,
    ]);
    expect(aRows.length).toBe(0);
  });
});
