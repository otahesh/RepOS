// api/tests/services/stalledPrEvaluator.test.ts
//
// Beta W3.1 — tests for stalledPrEvaluator. Five scenarios:
//   1. stalled       — 3 identical RIR-0 sessions, hypertrophy reps → fires
//   2. progressing   — last session jumps load → does NOT fire
//   3. rir-mixed     — middle session not max effort (RIR=2) → does NOT fire
//   4. deload        — last week of mesocycle (FIX-24 ADAPTED) → does NOT fire
//   5. low-rep       — strength-range reps (FIX-25 gate) → does NOT fire

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { stalledPrEvaluator } from '../../src/services/stalledPrEvaluator.js';
import { seedStalledPr, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

describe('stalledPrEvaluator (spec §7.2 — W3.1)', () => {
  it('fires when last 3 sessions same exercise have same load/reps, all RIR-0', async () => {
    const seed = await seedStalledPr({ pattern: 'stalled' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(true);
    if (r.triggered) {
      expect(r.payload?.exercise_id).toBe(seed.exerciseId);
    }
  });

  it('does NOT fire when most recent session shows weight increase', async () => {
    const seed = await seedStalledPr({ pattern: 'progressing' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  it('does NOT fire when any set in the 3-session streak has RIR > 0', async () => {
    const seed = await seedStalledPr({ pattern: 'rir-mixed' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  // [FIX-24 ADAPTED] Last week of mesocycle = deload by convention. The
  // canonical deload signal (day_workouts.is_deload) is owned by W2 and not
  // yet in the schema; we infer from mesocycle_runs.current_week === weeks.
  it('does NOT fire during the last week of a mesocycle (deload, current_week === weeks)', async () => {
    const seed = await seedStalledPr({ pattern: 'deload' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  // [FIX-25] Strength-range work (2-3 reps) legitimately stalls numerically;
  // this evaluator is hypertrophy-focused and gates on max_reps >= 5.
  it('does NOT fire for low-rep (strength block) sessions', async () => {
    const seed = await seedStalledPr({ pattern: 'low-rep' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  // W3 backend-reviewer Important #3 — null runId must fail-closed.
  // Without an active run, the prior code's deload guard short-circuited
  // but the stagnation query still ran across the user's entire history.
  it('does NOT fire when runId is null (fail-closed)', async () => {
    const seed = await seedStalledPr({ pattern: 'stalled' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: null, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  // W3 backend-reviewer Important #1 — stagnation in a prior, completed
  // mesocycle must not bleed into the current run's evaluation. The query
  // now anchors on dw.mesocycle_run_id, so sessions in an older run are
  // out of scope even if they form a perfect 3-session RIR-0 streak.
  it('does NOT fire when the stalled streak is in a prior mesocycle_run', async () => {
    // 'stalled' seed gives us 3 identical RIR-0 sessions in mesocycleRunId.
    const seed = await seedStalledPr({ pattern: 'stalled' });
    handles.push(seed);
    // Mark the seeded run as completed so we can create a fresh active run
    // for the same user (the unique idx_meso_one_active_per_user partial index
    // forbids two active runs per user).
    await db.query(
      `UPDATE mesocycle_runs SET status = 'completed' WHERE id = $1`,
      [seed.mesocycleRunId],
    );
    const { rows: [freshRun] } = await db.query<{ id: string }>(
      `INSERT INTO mesocycle_runs
         (user_id, user_program_id, status, weeks, current_week, start_date, start_tz)
       SELECT user_id, user_program_id, 'active', 4, 1, current_date, start_tz
       FROM mesocycle_runs WHERE id = $1
       RETURNING id`,
      [seed.mesocycleRunId],
    );
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: freshRun.id, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
    await db.query(`DELETE FROM mesocycle_runs WHERE id = $1`, [freshRun.id]);
  });

  // W3 backend-reviewer Important #2 — a session with internal load variance
  // (top-set + back-off sets at lower load) should NOT collapse to its
  // top-set tuple and falsely match a uniform-load session.
  it('does NOT fire when a session has internal load variance (top-set + back-offs)', async () => {
    const seed = await seedStalledPr({ pattern: 'stalled' });
    handles.push(seed);
    // Add a 4th set_log to the most-recent session at a different load — that
    // session becomes non-uniform (max_load ≠ min_load) and the streak check
    // should drop it as ineligible.
    await db.query(
      `INSERT INTO set_logs
         (user_id, exercise_id, planned_set_id, client_request_id,
          performed_load_lbs, performed_reps, performed_rir, performed_at)
       VALUES ($1, $2, $3, gen_random_uuid(),
          $4, 8, 0,
          now() - INTERVAL '1 day' + INTERVAL '5 minutes')`,
      [seed.userId, seed.exerciseId, seed.plannedSetId, 185], // back-off load vs 225 base
    );
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });
});
