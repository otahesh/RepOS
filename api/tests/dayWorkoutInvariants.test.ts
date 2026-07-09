/**
 * Sequence-workouts Task 5 — DB-level invariant suite for the day-workout
 * status routes (api/src/routes/dayWorkouts.ts).
 *
 * Unlike dayWorkouts.test.ts (route-contract coverage: status codes, response
 * shapes, IDOR, validation), this suite drives the SAME real routes but
 * asserts the invariants those routes exist to protect, expressed as SQL
 * SELECTs against the resulting rows:
 *
 *   1. every completed day_workout has completed_at stamped
 *   2. reopen clears completed_at (no planned row ever carries a stamp)
 *   3. a skipped day_workout's completed_at stays NULL
 *   4. completing the final open workout never leaves an active run with
 *      zero planned/in_progress children (the run must flip to completed)
 *
 * These assert already-implemented behavior — they are guardrails against
 * regression, not TDD-red specs. Fixture builder + cleanup pattern copied
 * from dayWorkouts.test.ts so the shared repos_test DB stays clean.
 */

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from './helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from './helpers/seed-fixtures.js';
import { db } from '../src/db/client.js';

const handles: SeedHandle[] = [];

afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});

afterAll(async () => {
  await db.end();
});

/** seedUserWithMesocycle starts the run at CURRENT_DATE; backdate it a week
 *  so route validation (completed_on before start_date) has room either way. */
async function seedBackdatedRun(): Promise<SeedHandle> {
  const seed = await seedUserWithMesocycle();
  handles.push(seed);
  await db.query(`UPDATE mesocycle_runs SET start_date = CURRENT_DATE - 7 WHERE id = $1`, [
    seed.mesocycleRunId,
  ]);
  return seed;
}

/** Add another planned day_workout to the same run at the given day_idx, so a
 *  run can be built with N open workouts before driving routes against them. */
async function addDay(seed: SeedHandle, dayIdx: number): Promise<string> {
  const {
    rows: [dw],
  } = await db.query<{ id: string }>(
    `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
     VALUES ($1, 1, $2::int, CURRENT_DATE + $2::int, 'strength', 'Seed Day')
     RETURNING id`,
    [seed.mesocycleRunId, dayIdx],
  );
  return dw.id;
}

async function runState(runId: string) {
  const {
    rows: [r],
  } = await db.query<{ status: string; finished_at: Date | null }>(
    `SELECT status, finished_at FROM mesocycle_runs WHERE id = $1`,
    [runId],
  );
  return r;
}

describe('day_workout invariants', () => {
  it('every completed day_workout has completed_at stamped', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addDay(seed, 1); // keep the run open after this one completes

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {},
      });
      expect(resp.statusCode).toBe(200);

      // Positive: the row we just completed carries a stamp.
      const {
        rows: [dw],
      } = await db.query<{ status: string; completed_at: Date | null }>(
        `SELECT status, completed_at FROM day_workouts WHERE id = $1`,
        [seed.dayWorkoutId],
      );
      expect(dw.status).toBe('completed');
      expect(dw.completed_at).not.toBeNull();

      // Invariant: no completed row on this run is missing completed_at.
      const {
        rows: [inv],
      } = await db.query<{ count: string }>(
        `SELECT count(*) FROM day_workouts
          WHERE mesocycle_run_id = $1 AND status = 'completed' AND completed_at IS NULL`,
        [seed.mesocycleRunId],
      );
      expect(Number(inv.count)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('reopen clears completed_at — no planned row ever carries a stamp', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const auth = { authorization: `Bearer ${seed.bearer}` };

      const complete = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: auth,
        payload: {},
      });
      expect(complete.statusCode).toBe(200);

      const reopen = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/reopen`,
        headers: auth,
      });
      expect(reopen.statusCode).toBe(200);

      const {
        rows: [dw],
      } = await db.query<{ status: string; completed_at: Date | null }>(
        `SELECT status, completed_at FROM day_workouts WHERE id = $1`,
        [seed.dayWorkoutId],
      );
      expect(dw.status).toBe('planned');
      expect(dw.completed_at).toBeNull();

      // Invariant: no planned row on this run carries a completed_at stamp.
      const {
        rows: [inv],
      } = await db.query<{ count: string }>(
        `SELECT count(*) FROM day_workouts
          WHERE mesocycle_run_id = $1 AND status = 'planned' AND completed_at IS NOT NULL`,
        [seed.mesocycleRunId],
      );
      expect(Number(inv.count)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('a skipped day_workout has NULL completed_at', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      await addDay(seed, 1); // keep the run open after this one is skipped

      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/skip`,
        headers: { authorization: `Bearer ${seed.bearer}` },
      });
      expect(resp.statusCode).toBe(200);

      const {
        rows: [dw],
      } = await db.query<{ status: string; completed_at: Date | null }>(
        `SELECT status, completed_at FROM day_workouts WHERE id = $1`,
        [seed.dayWorkoutId],
      );
      expect(dw.status).toBe('skipped');
      expect(dw.completed_at).toBeNull();

      // Invariant: no skipped row on this run carries a completed_at stamp.
      const {
        rows: [inv],
      } = await db.query<{ count: string }>(
        `SELECT count(*) FROM day_workouts
          WHERE mesocycle_run_id = $1 AND status = 'skipped' AND completed_at IS NOT NULL`,
        [seed.mesocycleRunId],
      );
      expect(Number(inv.count)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('completing the final workout leaves no active run with zero open workouts', async () => {
    const app = await build();
    try {
      const seed = await seedBackdatedRun();
      const auth = { authorization: `Bearer ${seed.bearer}` };
      const day2 = await addDay(seed, 1);
      const day3 = await addDay(seed, 2);

      // Drive all-but-one workout to a terminal state via the real routes.
      const c2 = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${day2}/complete`,
        headers: auth,
        payload: {},
      });
      expect(c2.statusCode).toBe(200);
      const c3 = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${day3}/skip`,
        headers: auth,
      });
      expect(c3.statusCode).toBe(200);

      // Precondition: run is still active with exactly one open workout left.
      expect((await runState(seed.mesocycleRunId)).status).toBe('active');

      // Complete the last open workout — the route must close the run.
      const resp = await app.inject({
        method: 'POST',
        url: `/api/day-workouts/${seed.dayWorkoutId}/complete`,
        headers: auth,
        payload: {},
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().run_completed).toBe(true);

      const run = await runState(seed.mesocycleRunId);
      expect(run.status).toBe('completed');
      expect(run.finished_at).not.toBeNull();

      // Invariant: no run is active while it has zero planned/in_progress
      // children — scoped to this test's run so concurrent suites' fixtures
      // (e.g. the self-heal test's deliberately-stranded intermediate state)
      // can't make this assertion flaky.
      const {
        rows: [inv],
      } = await db.query<{ count: string }>(
        `SELECT count(*) FROM mesocycle_runs mr
          WHERE mr.id = $1
            AND mr.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM day_workouts dw
              WHERE dw.mesocycle_run_id = mr.id AND dw.status IN ('planned', 'in_progress')
            )`,
        [seed.mesocycleRunId],
      );
      expect(Number(inv.count)).toBe(0);
    } finally {
      await app.close();
    }
  });
});
