// Beta W4.4 Task 13 — overreachingEvaluator must NOT fire in a deload context.
//
// [I-OVERREACHING-DELOAD-GUARD] Guard on BOTH mesocycle_runs.is_deload
// (run-level — W4) AND day_workouts.is_deload (week-level — W2.5) per the
// [C-IS-DELOAD] joint contract. Either being true means "deload context — do
// not fire the overreaching toast". The whole point of a deload is reduced
// load; an overreaching advisory there is a false alarm.
import 'dotenv/config';
import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../../src/db/client.js';
import { overreachingEvaluator } from '../../src/services/overreachingEvaluator.js';
import { seedUserOverreaching, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';

const seeds: SeedHandle[] = [];
afterEach(async () => {
  for (const s of seeds.splice(0)) {
    await db.query(`DELETE FROM recovery_flag_events WHERE user_id=$1`, [s.userId]);
    await cleanupSeeded(s);
  }
});

describe('overreachingEvaluator — deload guard [I-OVERREACHING-DELOAD-GUARD]', () => {
  it('FIRES on a normal run when the AND-gate conditions hold (control)', async () => {
    const seed = await seedUserOverreaching(); seeds.push(seed);
    const r = await overreachingEvaluator.evaluate({ userId: seed.userId, runId: seed.mesocycleRunId });
    expect(r.triggered).toBe(true);
  });

  it('does NOT fire on a deload mesocycle (run-level is_deload=true) even if signals would otherwise fire', async () => {
    const seed = await seedUserOverreaching(); seeds.push(seed);
    await db.query(`UPDATE mesocycle_runs SET is_deload=true WHERE id=$1`, [seed.mesocycleRunId]);
    const r = await overreachingEvaluator.evaluate({ userId: seed.userId, runId: seed.mesocycleRunId });
    expect(r.triggered).toBe(false);
  });

  it('does NOT fire when day_workouts.is_deload=true for the current week (week-level guard)', async () => {
    const seed = await seedUserOverreaching(); seeds.push(seed);
    // Run stays non-deload; mark the current week's day_workouts as a deload week.
    await db.query(
      `UPDATE day_workouts SET is_deload=true
       WHERE mesocycle_run_id=$1 AND week_idx=(SELECT current_week FROM mesocycle_runs WHERE id=$1)`,
      [seed.mesocycleRunId],
    );
    const r = await overreachingEvaluator.evaluate({ userId: seed.userId, runId: seed.mesocycleRunId });
    expect(r.triggered).toBe(false);
  });
});
