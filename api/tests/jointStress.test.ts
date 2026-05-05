// api/tests/jointStress.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { computeWeeklyJointStress, JointStressWarning } from '../src/services/jointStress.js';

let userId: string; let runId: string; let dwId: string;
let benchId: string; let deadliftId: string;

beforeAll(async () => {
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.joint.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const { rows: [up] } = await db.query(
    `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
     VALUES ($1, NULL, NULL, 'Joint test', 'draft') RETURNING id`,
    [userId],
  );
  const { rows: [run] } = await db.query(
    `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, status)
     VALUES ($1, $2, '2026-05-04', 'UTC', 5, 'active') RETURNING id`,
    [up.id, userId],
  );
  runId = run.id;
  const { rows: [dw] } = await db.query(
    `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
     VALUES ($1, 1, 0, '2026-05-04', 'strength', 'Heavy Lower') RETURNING id`,
    [runId],
  );
  dwId = dw.id;

  // Insert two exercises with high-lumbar joint_stress_profile.
  const { rows: [b] } = await db.query(
    `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                            skill_complexity, loading_demand, systemic_fatigue, joint_stress_profile)
     VALUES ('vitest-deadlift', 'Vitest Deadlift',
             (SELECT id FROM muscles WHERE slug='hamstrings'),
             'hinge','long', 4, 5, 5,
             $1::jsonb)
     RETURNING id`,
    [JSON.stringify({ _v: 1, lumbar: { level: 'high', stress: 4 }, hip: { level: 'high', stress: 4 } })],
  );
  deadliftId = b.id;
  const { rows: [bp] } = await db.query(
    `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                            skill_complexity, loading_demand, systemic_fatigue, joint_stress_profile)
     VALUES ('vitest-good-morning', 'Vitest Good Morning',
             (SELECT id FROM muscles WHERE slug='hamstrings'),
             'hinge','long', 3, 4, 4,
             $1::jsonb)
     RETURNING id`,
    [JSON.stringify({ _v: 1, lumbar: { level: 'high', stress: 3 } })],
  );
  benchId = bp.id;

  // 3 sets each = 6 high-lumbar sets in one session.
  const inserts = [];
  for (let s = 0; s < 3; s++) inserts.push(db.query(
    `INSERT INTO planned_sets (day_workout_id, block_idx, set_idx, exercise_id, target_reps_low, target_reps_high, target_rir, rest_sec)
     VALUES ($1, 0, $2, $3, 3, 5, 2, 180)`, [dwId, s, deadliftId]));
  for (let s = 0; s < 3; s++) inserts.push(db.query(
    `INSERT INTO planned_sets (day_workout_id, block_idx, set_idx, exercise_id, target_reps_low, target_reps_high, target_rir, rest_sec)
     VALUES ($1, 1, $2, $3, 8, 12, 2, 120)`, [dwId, s, benchId]));
  await Promise.all(inserts);
});

afterAll(async () => {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  if (deadliftId) await db.query(`DELETE FROM exercises WHERE id IN ($1,$2)`, [deadliftId, benchId]);
  await db.end();
});

describe('computeWeeklyJointStress (spec §7.1)', () => {
  it('computes weekly per-joint score = Σ(sets × stress)', async () => {
    const r = await computeWeeklyJointStress(runId);
    const w1 = r.weeks.find(w => w.week_idx === 1)!;
    expect(w1.joints.lumbar).toBeDefined();
    // 3 sets * 4 (deadlift) + 3 sets * 3 (good-morning) = 21
    expect(w1.joints.lumbar.score).toBe(21);
    expect(w1.joints.lumbar.sets).toBe(6);
  });

  it('emits ≥2-high-lumbar-in-one-session warning', async () => {
    const r = await computeWeeklyJointStress(runId);
    const w1 = r.weeks.find(w => w.week_idx === 1)!;
    const warnings: JointStressWarning[] = w1.warnings;
    const hasMultiHighLumbar = warnings.some(w => w.kind === 'multi_high_lumbar_in_session');
    expect(hasMultiHighLumbar).toBe(true);
  });

  it('does NOT trip soft cap until threshold crossed', async () => {
    // 6 sets is well below the 16/wk lumbar soft cap.
    const r = await computeWeeklyJointStress(runId);
    const w1 = r.weeks.find(w => w.week_idx === 1)!;
    const hasSoftCap = w1.warnings.some(w => w.kind === 'soft_cap_lumbar');
    expect(hasSoftCap).toBe(false);
  });

  it('soft cap fires when high-stress lumbar sets > 16/wk', async () => {
    // Inflate by inserting 12 more high-lumbar sets to push past 16.
    for (let s = 3; s < 15; s++) {
      await db.query(
        `INSERT INTO planned_sets (day_workout_id, block_idx, set_idx, exercise_id, target_reps_low, target_reps_high, target_rir, rest_sec)
         VALUES ($1, 2, $2, $3, 5, 8, 2, 180)`, [dwId, s, deadliftId]);
    }
    const r = await computeWeeklyJointStress(runId);
    const w1 = r.weeks.find(w => w.week_idx === 1)!;
    expect(w1.warnings.some(w => w.kind === 'soft_cap_lumbar')).toBe(true);
  });
});
