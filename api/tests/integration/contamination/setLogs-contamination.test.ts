import 'dotenv/config';
import { randomUUID } from 'node:crypto';
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

// Resolve a planned_set id on A's run + insert a fresh (in-window) set_log on it.
async function seedAPlannedSetAndLog(
  userId: string,
): Promise<{ plannedSetId: string; setLogId: string; exerciseId: string }> {
  const runId = await seedFullMesocycleForUser(userId, { weeks: 4 });
  const { rows: psRows } = await db.query<{ id: string; exercise_id: string }>(
    `SELECT ps.id, ps.exercise_id
     FROM planned_sets ps
     JOIN day_workouts dw ON dw.id = ps.day_workout_id
     WHERE dw.mesocycle_run_id = $1
     ORDER BY ps.id LIMIT 1`,
    [runId],
  );
  const plannedSetId = psRows[0].id;
  const exerciseId = psRows[0].exercise_id;
  const { rows: logRows } = await db.query<{ id: string }>(
    `INSERT INTO set_logs
       (user_id, exercise_id, planned_set_id, client_request_id,
        performed_load_lbs, performed_reps, performed_rir, performed_at)
     VALUES ($1, $2, $3, gen_random_uuid(), 200.0, 5, 2, now())
     RETURNING id`,
    [userId, exerciseId, plannedSetId],
  );
  return { plannedSetId, setLogId: logRows[0].id, exerciseId };
}

describe('W8.2 contamination — set-logs', () => {
  it('POST /set-logs against A planned_set from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { plannedSetId } = await seedAPlannedSetAndLog(pair.userA.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/set-logs',
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: {
        planned_set_id: plannedSetId,
        // RFC-4122-valid UUID — Zod v4's .uuid() rejects the all-1s literal
        // (variant nibble must be 8/9/a/b), so mint a real one here.
        client_request_id: randomUUID(),
        weight_lbs: 100,
        reps: 5,
        rir: 2,
        performed_at: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /set-logs/:id on A log from B token returns 404 and does not mutate', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { setLogId } = await seedAPlannedSetAndLog(pair.userA.userId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/set-logs/${setLogId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { weight_lbs: 999 },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query<{ performed_load_lbs: string }>(
      `SELECT performed_load_lbs FROM set_logs WHERE id=$1`,
      [setLogId],
    );
    expect(Number(rows[0].performed_load_lbs)).toBe(200);
  });

  it('DELETE /set-logs/:id on A log from B token returns 404 and leaves row', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { setLogId } = await seedAPlannedSetAndLog(pair.userA.userId);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/set-logs/${setLogId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query(`SELECT 1 FROM set_logs WHERE id=$1`, [setLogId]);
    expect(rows.length).toBe(1);
  });

  it('GET /set-logs for A planned_set from B token returns an empty list', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { plannedSetId } = await seedAPlannedSetAndLog(pair.userA.userId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/set-logs?planned_set_id=${plannedSetId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ set_logs: unknown[] }>().set_logs).toEqual([]);
  });
});
