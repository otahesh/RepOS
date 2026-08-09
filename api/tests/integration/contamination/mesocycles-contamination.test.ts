import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import {
  mkUserPair,
  seedFullMesocycleForUser,
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

describe('W8.2 contamination — mesocycles', () => {
  it('GET /mesocycles/today for B reflects B (no active run), not A run', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5, currentWeek: 2 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesocycles/today',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ state: string }>().state).toBe('no_active_run');
  });

  it('GET /mesocycles/:id for A run from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5 });

    const res = await app.inject({
      method: 'GET',
      url: `/api/mesocycles/${runId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /mesocycles/:id/volume-rollup for A run from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5 });

    const res = await app.inject({
      method: 'GET',
      url: `/api/mesocycles/${runId}/volume-rollup`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /mesocycles/:id/recap-stats for A run from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5 });

    const res = await app.inject({
      method: 'GET',
      url: `/api/mesocycles/${runId}/recap-stats`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /mesocycles/:id/abandon on A run from B token returns 404 and leaves run active', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${runId}/abandon`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM mesocycle_runs WHERE id=$1`,
      [runId],
    );
    expect(rows[0].status).toBe('active');
  });
});
