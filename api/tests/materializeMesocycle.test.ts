import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { materializeMesocycle } from '../src/services/materializeMesocycle.js';

let userId: string; let templateId: string; let userProgramId: string;

const MIN_TEMPLATE_STRUCTURE = {
  _v: 1,
  days: [
    {
      idx: 0, day_offset: 0, kind: 'strength', name: 'Full Body A',
      blocks: [
        // chest compound + chest isolation share the same chest landmark
        { exercise_slug: 'barbell-bench-press',  mev: 6, mav: 10, target_reps_low: 5, target_reps_high: 8, target_rir: 2, rest_sec: 180 },
        { exercise_slug: 'dumbbell-bench-press', mev: 4, mav: 6,  target_reps_low: 10, target_reps_high: 15, target_rir: 1, rest_sec: 90 },
      ],
    },
  ],
};

beforeAll(async () => {
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.materialize.${Date.now()}@repos.test`],
  );
  userId = u.id;

  const { rows: [t] } = await db.query(
    `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure, version, created_by)
     VALUES ($1, $2, 5, 1, $3::jsonb, 1, 'system') RETURNING id`,
    [`vitest-materialize-${Date.now()}`, 'Vitest minimal', JSON.stringify(MIN_TEMPLATE_STRUCTURE)],
  );
  templateId = t.id;

  const { rows: [up] } = await db.query(
    `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
     VALUES ($1, $2, 1, 'Vitest run', 'draft') RETURNING id`,
    [userId, templateId],
  );
  userProgramId = up.id;
});

afterAll(async () => {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  if (templateId) await db.query(`DELETE FROM program_templates WHERE id=$1`, [templateId]);
  await db.end();
});

describe('materializeMesocycle (spec §3.3 step list)', () => {
  it('happy path materializes day_workouts + planned_sets + a started event in one tx', async () => {
    const t0 = Date.now();
    const result = await materializeMesocycle({
      userProgramId, startDate: '2026-05-04', startTz: 'America/New_York',
    });
    const elapsed = Date.now() - t0;

    expect(result.run_id).toBeDefined();
    expect(elapsed).toBeLessThan(500); // generous CI budget; spec target ~30ms warm

    const { rows: [day] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM day_workouts WHERE mesocycle_run_id=$1`, [result.run_id],
    );
    // 5 weeks * 1 day_per_week
    expect(day.n).toBe(5);

    const { rows: [ps] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1`, [result.run_id],
    );
    expect(ps.n).toBeGreaterThan(0);

    const { rows: [evt] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM mesocycle_run_events
       WHERE run_id=$1 AND event_type='started'`, [result.run_id],
    );
    expect(evt.n).toBe(1);

    const { rows: [run] } = await db.query(
      `SELECT status, start_tz FROM mesocycle_runs WHERE id=$1`, [result.run_id],
    );
    expect(run.status).toBe('active');
    expect(run.start_tz).toBe('America/New_York');
  });

  it('week 1 sets_count uses MEV; last accumulation week uses MRV-1', async () => {
    const { rows } = await db.query(
      `SELECT dw.week_idx, ps.exercise_id, COUNT(*)::int AS sets
       FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       JOIN mesocycle_runs mr ON mr.id=dw.mesocycle_run_id
       WHERE mr.user_program_id=$1
       GROUP BY dw.week_idx, ps.exercise_id
       ORDER BY dw.week_idx, ps.exercise_id`,
      [userProgramId],
    );
    expect(rows.length).toBeGreaterThan(0);
    // Week 1 totals across both blocks should equal chest MEV (10)
    const w1Total = rows.filter(r => r.week_idx === 1).reduce((s, r) => s + r.sets, 0);
    expect(w1Total).toBe(10);
    // Week 4 (last accum, N=5) should equal MRV-1 = 21
    const w4Total = rows.filter(r => r.week_idx === 4).reduce((s, r) => s + r.sets, 0);
    expect(w4Total).toBe(21);
  });
});
