// api/tests/integration/manual-deload.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import {
  seedUserWithFullMesocycle,
  cleanupSeeded,
  type FullMesocycleHandle,
} from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: FullMesocycleHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

describe('W2.5 — manual deload', () => {
  it('POST /api/mesocycles/:id/deload-now reduces remaining-week planned sets to floor(MAV * 0.5) and pins RIR=4', async () => {
    const app = await build();
    // Default fixture: 2 strength days/week (barbell-bench-press → chest,
    // dumbbell-curl → biceps). Seeded MAVs: chest=14, biceps=14.
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);

    // Capture pre-deload set counts per (day_workout, block). The deload only
    // DELETES trailing sets above floor(MAV*0.5); it never pads up. So the
    // expected post-deload count is min(preCount, floor(MAV*0.5)).
    const { rows: preRows } = await db.query<{ key: string; sets: number }>(
      `SELECT (ps.day_workout_id::text || '|' || ps.block_idx::text) AS key, count(*)::int AS sets
       FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE dw.mesocycle_run_id = $1 AND dw.week_idx >= 2
       GROUP BY ps.day_workout_id, ps.block_idx`,
      [seed.mesocycleRunId],
    );
    const preByKey = new Map(preRows.map((r) => [r.key, r.sets]));

    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(200);

    // Post-deload: every remaining block reduced to floor(muscle_mav * 0.5),
    // min 1. RIR pinned to 4. Resolve expected per block by reading the
    // block's primary exercise's muscle landmark.
    const { rows: post } = await db.query<{
      day_workout_id: string;
      block_idx: number;
      target_rir: number;
      sets: number;
      muscle_slug: string;
    }>(
      `SELECT dw.week_idx, ps.day_workout_id, ps.block_idx, ps.target_rir,
              count(*)::int AS sets,
              (SELECT m.slug FROM exercises e JOIN muscles m ON m.id=e.primary_muscle_id WHERE e.id = ps.exercise_id) AS muscle_slug
       FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE dw.mesocycle_run_id = $1 AND dw.week_idx >= 2
       GROUP BY dw.week_idx, ps.day_workout_id, ps.block_idx, ps.target_rir, ps.exercise_id`,
      [seed.mesocycleRunId],
    );
    expect(post.length).toBeGreaterThan(0);

    const { MUSCLE_LANDMARKS } = await import('../../src/services/_muscleLandmarks.js');
    const { MANUAL_DELOAD_MAV_FACTOR, MANUAL_DELOAD_RIR } =
      await import('../../src/services/_deloadConstants.js');
    for (const r of post) {
      const mav = (MUSCLE_LANDMARKS as any)[r.muscle_slug]?.mav ?? 10; // fallback
      const target = Math.max(1, Math.floor(mav * MANUAL_DELOAD_MAV_FACTOR));
      const preCount = preByKey.get(`${r.day_workout_id}|${r.block_idx}`) ?? target;
      // Deload only deletes excess — never pads up.
      const expected = Math.min(preCount, target);
      expect(r.sets, `block (${r.muscle_slug}) reduced sets`).toBe(expected);
      expect(r.target_rir).toBe(MANUAL_DELOAD_RIR);
    }

    // is_deload flipped on every remaining day_workout.
    const { rows: dwRows } = await db.query<{ is_deload: boolean; week_idx: number }>(
      `SELECT week_idx, is_deload FROM day_workouts WHERE mesocycle_run_id=$1 AND week_idx >= 2`,
      [seed.mesocycleRunId],
    );
    for (const r of dwRows) expect(r.is_deload).toBe(true);

    // weeks 1 (pre-current) NOT flipped.
    const { rows: wk1 } = await db.query<{ is_deload: boolean }>(
      `SELECT is_deload FROM day_workouts WHERE mesocycle_run_id=$1 AND week_idx = 1`,
      [seed.mesocycleRunId],
    );
    for (const r of wk1) expect(r.is_deload).toBe(false);

    // mesocycle_run_events row appended.
    const { rows: events } = await db.query(
      `SELECT event_type, payload FROM mesocycle_run_events
       WHERE run_id=$1 AND event_type='manual_deload'`,
      [seed.mesocycleRunId],
    );
    expect(events).toHaveLength(1);
  });

  it('every reduced block has at least 1 set (min-1 clamp holds)', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);
    await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    const { rows } = await db.query<{ sets: number }>(
      `SELECT count(*)::int AS sets
       FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= 2
       GROUP BY ps.day_workout_id, ps.block_idx`,
      [seed.mesocycleRunId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.sets).toBeGreaterThanOrEqual(1);
  });

  it('rejects deload-now on a non-active run with 409', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2, status: 'abandoned' });
    handles.push(seed);
    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a second deload-now while already deloaded (409 already_deloaded)', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);
    const auth = { authorization: `Bearer ${seed.bearer}` };
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: auth,
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: auth,
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error).toBe('already_deloaded');
  });
});
