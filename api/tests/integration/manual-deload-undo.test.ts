// api/tests/integration/manual-deload-undo.test.ts
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

describe('W2.5 — manual deload undo', () => {
  it('undo within 24h restores planned_sets to pre-deload state', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);
    const { rows: pre } = await db.query(
      `SELECT count(*)::int AS c FROM planned_sets ps JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= 2`,
      [seed.mesocycleRunId],
    );
    const auth = { authorization: `Bearer ${seed.bearer}` };
    await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: auth,
    });
    const undoRes = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now/undo`,
      headers: auth,
    });
    expect(undoRes.statusCode).toBe(200);

    const { rows: post } = await db.query(
      `SELECT count(*)::int AS c FROM planned_sets ps JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= 2`,
      [seed.mesocycleRunId],
    );
    expect(post[0].c).toBe(pre[0].c);

    // is_deload back to false on intermediate weeks, true only on final week.
    const { rows: dwRows } = await db.query<{ week_idx: number; is_deload: boolean }>(
      `SELECT week_idx, is_deload FROM day_workouts WHERE mesocycle_run_id=$1 AND week_idx >= 2`,
      [seed.mesocycleRunId],
    );
    for (const r of dwRows) {
      expect(r.is_deload).toBe(r.week_idx === 5); // weeks=5 → only week 5 stays deload
    }
  });

  it('undo past 24h returns 409 undo_window_expired', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);
    const auth = { authorization: `Bearer ${seed.bearer}` };
    await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now`,
      headers: auth,
    });

    // Backdate the event by 25 hours.
    await db.query(
      `UPDATE mesocycle_run_events SET occurred_at = now() - interval '25 hours'
        WHERE run_id=$1 AND event_type='manual_deload'`,
      [seed.mesocycleRunId],
    );

    const undoRes = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now/undo`,
      headers: auth,
    });
    expect(undoRes.statusCode).toBe(409);
    expect(undoRes.json().error).toBe('undo_window_expired');
  });

  it('undo with no prior deload returns 409 no_manual_deload', async () => {
    const app = await build();
    const seed = await seedUserWithFullMesocycle({ weeks: 5, currentWeek: 2 });
    handles.push(seed);
    const undoRes = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${seed.mesocycleRunId}/deload-now/undo`,
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(undoRes.statusCode).toBe(409);
    expect(undoRes.json().error).toBe('no_manual_deload');
  });
});
