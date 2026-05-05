// api/tests/volumeRollup.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { computeVolumeRollup } from '../src/services/volumeRollup.js';
import { materializeMesocycle } from '../src/services/materializeMesocycle.js';

let userId: string; let templateId: string; let runId: string;

const TEMPLATE = {
  _v: 1,
  days: [
    {
      idx: 0, day_offset: 0, kind: 'hybrid', name: 'Strength + Z2',
      blocks: [
        { exercise_slug: 'barbell-bench-press',  mev: 6, mav: 10, target_reps_low: 5, target_reps_high: 8, target_rir: 2, rest_sec: 180 },
        // SUBSTITUTION: plan said 'cable-crossover'; not seeded. Using
        // 'dumbbell-bench-press' as the second chest block; same
        // primary_muscle, same chest contribution=1.0.
        { exercise_slug: 'dumbbell-bench-press', mev: 4, mav: 6,  target_reps_low: 10, target_reps_high: 15, target_rir: 1, rest_sec: 90 },
        // SUBSTITUTION: plan said 'outdoor-walking'; the seeded slug is
        // 'outdoor-walking-z2'. Test assertion below uses the seeded slug.
        { exercise_slug: 'outdoor-walking-z2',   mev: 0, mav: 0,  target_reps_low: 0, target_reps_high: 0, target_rir: 1, rest_sec: 0,
          cardio: { target_duration_sec: 30 * 60, target_zone: 2 } },
      ],
    },
  ],
};

beforeAll(async () => {
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.rollup.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const { rows: [t] } = await db.query(
    `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure, version, created_by)
     VALUES ($1, $2, 5, 1, $3::jsonb, 1, 'system') RETURNING id`,
    [`vitest-rollup-${Date.now()}`, 'Rollup', JSON.stringify(TEMPLATE)],
  );
  templateId = t.id;
  const { rows: [up] } = await db.query(
    `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
     VALUES ($1, $2, 1, 'Rollup run', 'draft') RETURNING id`,
    [userId, templateId],
  );
  const r = await materializeMesocycle({ userProgramId: up.id, startDate: '2026-05-04', startTz: 'UTC' });
  runId = r.run_id;
});

afterAll(async () => {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  if (templateId) await db.query(`DELETE FROM program_templates WHERE id=$1`, [templateId]);
  await db.end();
});

describe('computeVolumeRollup (spec §3.3, §3.4)', () => {
  it('returns sets-per-muscle-per-week as fractional sums (chest credits)', async () => {
    const r = await computeVolumeRollup(runId);
    expect(r.weeks.length).toBe(5);
    const w1 = r.weeks.find(w => w.week_idx === 1)!;
    // chest contribution from bench-press (~1.0) + dumbbell-bench-press (~1.0)
    // summed across this day's planned_sets
    const chest = w1.muscles.find(m => m.muscle === 'chest');
    expect(chest).toBeDefined();
    expect(chest!.sets).toBeGreaterThan(0);
    // landmarks attached
    expect(chest!.mev).toBe(10);
    expect(chest!.mav).toBe(14);
    expect(chest!.mrv).toBe(22);
  });

  it('week 1 chest sums to MEV; week 4 chest sums to MRV-1', async () => {
    const r = await computeVolumeRollup(runId);
    const chestW1 = r.weeks.find(w => w.week_idx === 1)!.muscles.find(m => m.muscle === 'chest')!;
    const chestW4 = r.weeks.find(w => w.week_idx === 4)!.muscles.find(m => m.muscle === 'chest')!;
    // Both bench-press and dumbbell-bench-press have full chest contribution,
    // so the raw planned_sets count and the contribution-weighted count agree.
    expect(chestW1.sets).toBeGreaterThanOrEqual(9.5);
    expect(chestW1.sets).toBeLessThanOrEqual(10.5);
    expect(chestW4.sets).toBeGreaterThanOrEqual(20);
    expect(chestW4.sets).toBeLessThanOrEqual(22);
  });

  it('cardio emits minutes_by_modality, not strength sets', async () => {
    const r = await computeVolumeRollup(runId);
    const w1 = r.weeks.find(w => w.week_idx === 1)!;
    expect(w1.minutes_by_modality).toBeDefined();
    // 30 min walking, once per week, under the seeded slug.
    expect(w1.minutes_by_modality['outdoor-walking-z2'] ?? 0).toBe(30);
  });

  it('deload week (5) chest sets = round(MEV/2)', async () => {
    const r = await computeVolumeRollup(runId);
    const chestW5 = r.weeks.find(w => w.week_idx === 5)!.muscles.find(m => m.muscle === 'chest');
    // round(10/2) = 5; allow ±0.5 for fractional contribution drift
    expect(chestW5!.sets).toBeGreaterThanOrEqual(4.5);
    expect(chestW5!.sets).toBeLessThanOrEqual(5.5);
  });

  it('week boundaries: each set is counted in exactly one week', async () => {
    const r = await computeVolumeRollup(runId);
    const totalRollupSets = r.weeks.flatMap(w => w.muscles).reduce((s, m) => s + m.sets, 0);
    const { rows: [{ raw }] } = await db.query<{ raw: number }>(
      `SELECT COALESCE(SUM(emc.contribution), 0)::float AS raw
       FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       JOIN exercise_muscle_contributions emc ON emc.exercise_id=ps.exercise_id
       WHERE dw.mesocycle_run_id=$1`,
      [runId],
    );
    expect(Math.abs(totalRollupSets - raw)).toBeLessThan(0.1);
  });
});
