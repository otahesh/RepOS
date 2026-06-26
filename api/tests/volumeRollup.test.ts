// api/tests/volumeRollup.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { computeVolumeRollup } from '../src/services/volumeRollup.js';
import { materializeMesocycle } from '../src/services/materializeMesocycle.js';
import {
  mkUser,
  mkTemplate,
  mkUserProgram,
  cleanupUser,
  cleanupTemplate,
} from './helpers/program-fixtures.js';

let userId: string;
let templateId: string;
let runId: string;

const TEMPLATE = {
  _v: 1,
  days: [
    {
      idx: 0,
      day_offset: 0,
      kind: 'hybrid',
      name: 'Strength + Z2',
      blocks: [
        {
          exercise_slug: 'barbell-bench-press',
          mev: 6,
          mav: 10,
          target_reps_low: 5,
          target_reps_high: 8,
          target_rir: 2,
          rest_sec: 180,
        },
        // SUBSTITUTION: plan said 'cable-crossover'; not seeded. Using
        // 'dumbbell-bench-press' as the second chest block; same
        // primary_muscle, same chest contribution=1.0.
        {
          exercise_slug: 'dumbbell-bench-press',
          mev: 4,
          mav: 6,
          target_reps_low: 10,
          target_reps_high: 15,
          target_rir: 1,
          rest_sec: 90,
        },
        // SUBSTITUTION: plan said 'outdoor-walking'; the seeded slug is
        // 'outdoor-walking-z2'. Test assertion below uses the seeded slug.
        {
          exercise_slug: 'outdoor-walking-z2',
          mev: 0,
          mav: 0,
          target_reps_low: 0,
          target_reps_high: 0,
          target_rir: 1,
          rest_sec: 0,
          cardio: { target_duration_sec: 30 * 60, target_zone: 2 },
        },
      ],
    },
  ],
};

beforeAll(async () => {
  const u = await mkUser({ prefix: 'vitest.rollup' });
  userId = u.id;
  const t = await mkTemplate({
    prefix: 'vitest-rollup',
    name: 'Rollup',
    weeks: 5,
    daysPerWeek: 1,
    structure: TEMPLATE,
  });
  templateId = t.id;
  const up = await mkUserProgram({ userId, templateId, name: 'Rollup run' });
  const r = await materializeMesocycle({
    userProgramId: up.id,
    startDate: '2026-05-04',
    startTz: 'UTC',
  });
  runId = r.run_id;
});

afterAll(async () => {
  await cleanupUser(userId);
  await cleanupTemplate(templateId);
  await db.end();
});

describe('computeVolumeRollup (spec §3.3, §3.4)', () => {
  it('returns sets-per-muscle-per-week as fractional sums (chest credits)', async () => {
    const r = await computeVolumeRollup(runId);
    expect(r.weeks.length).toBe(5);
    const w1 = r.weeks.find((w) => w.week_idx === 1)!;
    // chest contribution from bench-press (~1.0) + dumbbell-bench-press (~1.0)
    // summed across this day's planned_sets
    const chest = w1.muscles.find((m) => m.muscle === 'chest');
    expect(chest).toBeDefined();
    expect(chest!.sets).toBeGreaterThan(0);
    // landmarks attached
    expect(chest!.mev).toBe(10);
    expect(chest!.mav).toBe(14);
    expect(chest!.mrv).toBe(22);
  });

  it('week 1 chest sums to MEV; week 4 chest sums to MRV-1', async () => {
    const r = await computeVolumeRollup(runId);
    const chestW1 = r.weeks
      .find((w) => w.week_idx === 1)!
      .muscles.find((m) => m.muscle === 'chest')!;
    const chestW4 = r.weeks
      .find((w) => w.week_idx === 4)!
      .muscles.find((m) => m.muscle === 'chest')!;
    // Both bench-press and dumbbell-bench-press have full chest contribution,
    // so the raw planned_sets count and the contribution-weighted count agree.
    expect(chestW1.sets).toBeGreaterThanOrEqual(9.5);
    expect(chestW1.sets).toBeLessThanOrEqual(10.5);
    expect(chestW4.sets).toBeGreaterThanOrEqual(20);
    expect(chestW4.sets).toBeLessThanOrEqual(22);
  });

  it('cardio emits minutes_by_modality, not strength sets', async () => {
    const r = await computeVolumeRollup(runId);
    const w1 = r.weeks.find((w) => w.week_idx === 1)!;
    expect(w1.minutes_by_modality).toBeDefined();
    // 30 min walking, once per week, under the seeded slug.
    expect(w1.minutes_by_modality['outdoor-walking-z2'] ?? 0).toBe(30);
  });

  it('deload week (5) chest sets = round(MEV/2)', async () => {
    const r = await computeVolumeRollup(runId);
    const chestW5 = r.weeks
      .find((w) => w.week_idx === 5)!
      .muscles.find((m) => m.muscle === 'chest');
    // round(10/2) = 5; allow ±0.5 for fractional contribution drift
    expect(chestW5!.sets).toBeGreaterThanOrEqual(4.5);
    expect(chestW5!.sets).toBeLessThanOrEqual(5.5);
  });

  it('week boundaries: each set is counted in exactly one week', async () => {
    const r = await computeVolumeRollup(runId);
    const totalRollupSets = r.weeks.flatMap((w) => w.muscles).reduce((s, m) => s + m.sets, 0);
    const {
      rows: [{ raw }],
    } = await db.query<{ raw: number }>(
      `SELECT COALESCE(SUM(emc.contribution), 0)::float AS raw
       FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       JOIN exercise_muscle_contributions emc ON emc.exercise_id=ps.exercise_id
       WHERE dw.mesocycle_run_id=$1`,
      [runId],
    );
    expect(Math.abs(totalRollupSets - raw)).toBeLessThan(0.1);
  });

  // Reviewer Important: performed_sets ships on MuscleVolume in W1 but the
  // unit-level test never asserts it. The integration test in
  // set-logs-volume-rollup.test.ts covers behavior, but a refactor that
  // drops the performed-volume SQL from volumeRollup.ts would still pass
  // this file's assertions until the integration suite runs. Lock the
  // contract at the unit level too.

  it('performed_sets is 0 on every muscle when no set_logs exist', async () => {
    const r = await computeVolumeRollup(runId);
    for (const wk of r.weeks) {
      for (const m of wk.muscles) {
        expect(m.performed_sets).toBe(0);
      }
    }
  });

  it('performed_sets grows after a direct set_logs insert against a planned_set', async () => {
    // Use a chest planned_set from week 1. The performed-volume SQL JOINs
    // set_logs → planned_sets → day_workouts → emc; one set_log on a
    // bench-press planned_set should credit chest +1 (contribution=1.0)
    // and the back muscles by their respective contributions.
    const {
      rows: [ps],
    } = await db.query<{ id: string; exercise_id: string }>(
      `SELECT ps.id, ps.exercise_id
       FROM planned_sets ps
       JOIN day_workouts dw ON dw.id = ps.day_workout_id
       JOIN exercises e ON e.id = ps.exercise_id
       WHERE dw.mesocycle_run_id = $1
         AND dw.week_idx = 1
         AND e.slug = 'barbell-bench-press'
       LIMIT 1`,
      [runId],
    );
    expect(ps).toBeDefined();

    const before = await computeVolumeRollup(runId);
    const chestBeforeW1 = before.weeks
      .find((w) => w.week_idx === 1)!
      .muscles.find((m) => m.muscle === 'chest')!.performed_sets;
    expect(chestBeforeW1).toBe(0);

    try {
      await db.query(
        `INSERT INTO set_logs
           (user_id, exercise_id, planned_set_id, client_request_id,
            performed_load_lbs, performed_reps, performed_rir, performed_at)
         VALUES ($1, $2, $3, gen_random_uuid(),
                 185.0, 5, 2, now())`,
        [userId, ps.exercise_id, ps.id],
      );

      const after = await computeVolumeRollup(runId);
      const chestAfterW1 = after.weeks
        .find((w) => w.week_idx === 1)!
        .muscles.find((m) => m.muscle === 'chest')!.performed_sets;
      // contribution=1.0 for chest on bench-press → exactly +1.
      expect(chestAfterW1).toBe(chestBeforeW1 + 1);
    } finally {
      // Clean up so subsequent tests in this file see baseline = 0.
      await db.query(`DELETE FROM set_logs WHERE planned_set_id = $1`, [ps.id]);
    }
  });

  it('performed_sets attributes by planned week, not calendar week of performed_at', async () => {
    // A set_log against a Week-1 planned_set always credits Week 1, even
    // when performed_at is far away from the planned date. This is the
    // attribution invariant documented in volumeRollup.ts.
    const {
      rows: [ps],
    } = await db.query<{ id: string; exercise_id: string }>(
      `SELECT ps.id, ps.exercise_id
       FROM planned_sets ps
       JOIN day_workouts dw ON dw.id = ps.day_workout_id
       JOIN exercises e ON e.id = ps.exercise_id
       WHERE dw.mesocycle_run_id = $1
         AND dw.week_idx = 1
         AND e.slug = 'barbell-bench-press'
       LIMIT 1`,
      [runId],
    );

    try {
      // Insert with performed_at in the past (well outside the planned
      // Week 1 calendar slot — fixture's start_date is 2026-05-04).
      await db.query(
        `INSERT INTO set_logs
           (user_id, exercise_id, planned_set_id, client_request_id,
            performed_load_lbs, performed_reps, performed_rir, performed_at)
         VALUES ($1, $2, $3, gen_random_uuid(),
                 185.0, 5, 2, '2026-05-19T12:00:00Z')`,
        [userId, ps.exercise_id, ps.id],
      );

      const r = await computeVolumeRollup(runId);
      const w1 = r.weeks.find((w) => w.week_idx === 1)!.muscles.find((m) => m.muscle === 'chest')!;
      expect(w1.performed_sets).toBe(1);
      // No spillover into other weeks even though performed_at was much later.
      const w3 = r.weeks.find((w) => w.week_idx === 3)!.muscles.find((m) => m.muscle === 'chest')!;
      expect(w3.performed_sets).toBe(0);
    } finally {
      await db.query(`DELETE FROM set_logs WHERE planned_set_id = $1`, [ps.id]);
    }
  });
});
