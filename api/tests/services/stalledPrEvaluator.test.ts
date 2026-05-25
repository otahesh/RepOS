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
});
