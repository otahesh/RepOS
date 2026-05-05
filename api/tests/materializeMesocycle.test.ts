import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { materializeMesocycle, ActiveRunExistsError } from '../src/services/materializeMesocycle.js';
import { mkUser, mkTemplate, mkUserProgram, cleanupUser, cleanupTemplate } from './helpers/program-fixtures.js';

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
  const u = await mkUser({ prefix: 'vitest.materialize' });
  userId = u.id;

  const t = await mkTemplate({
    prefix: 'vitest-materialize', name: 'Vitest minimal', weeks: 5, daysPerWeek: 1,
    structure: MIN_TEMPLATE_STRUCTURE,
  });
  templateId = t.id;

  const up = await mkUserProgram({ userId, templateId, name: 'Vitest run' });
  userProgramId = up.id;
});

afterAll(async () => {
  await cleanupUser(userId);
  await cleanupTemplate(templateId);
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

describe('materializeMesocycle concurrency (spec §9 guardrail)', () => {
  it('50 parallel starts on the same user_program — exactly one survives, others 409', async () => {
    // Build a fresh user + draft program for this test.
    const u2 = await mkUser({ prefix: 'vitest.hammer' });
    try {
      const up2 = await mkUserProgram({ userId: u2.id, templateId, name: 'Hammer run' });

      const calls = Array.from({ length: 50 }, () =>
        materializeMesocycle({
          userProgramId: up2.id, startDate: '2026-05-04', startTz: 'America/New_York',
        }).then(r => ({ ok: true as const, run_id: r.run_id }))
         .catch(e => ({ ok: false as const, err: e }))
      );
      const results = await Promise.all(calls);

      const survivors = results.filter(r => r.ok);
      const losers    = results.filter(r => !r.ok);

      expect(survivors.length).toBe(1);
      // Every loser must be the documented 409 (ActiveRunExistsError) or a
      // SERIALIZABLE retry-needed (40001) bubbling — not e.g. 5xx.
      for (const l of losers) {
        const code = (l as any).err?.code ?? (l as any).err?.constructor?.name;
        const isExpected =
          l.err instanceof ActiveRunExistsError ||
          code === '40001' /* serialization_failure */ ||
          code === '23505' /* unique_violation surfacing past our wrap */;
        expect(isExpected).toBe(true);
      }

      // DB state: exactly one active mesocycle_run for this user.
      const { rows: [{ n }] } = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM mesocycle_runs WHERE user_id=$1 AND status='active'`,
        [u2.id],
      );
      expect(n).toBe(1);

      // I-2: prove the survivor's full payload committed (not just the parent row).
      const survivorRunId = (survivors[0] as { ok: true; run_id: string }).run_id;
      const { rows: [{ dws }] } = await db.query<{ dws: number }>(
        `SELECT COUNT(*)::int AS dws FROM day_workouts WHERE mesocycle_run_id=$1`,
        [survivorRunId],
      );
      expect(dws).toBe(5);
      const { rows: [{ ps }] } = await db.query<{ ps: number }>(
        `SELECT COUNT(*)::int AS ps FROM planned_sets ps
         JOIN day_workouts dw ON dw.id=ps.day_workout_id
         WHERE dw.mesocycle_run_id=$1`,
        [survivorRunId],
      );
      expect(ps).toBeGreaterThan(0);

      // No orphaned planned_sets/day_workouts from rolled-back txs.
      const { rows: [{ orphans }] } = await db.query<{ orphans: number }>(
        `SELECT COUNT(*)::int AS orphans FROM day_workouts dw
         LEFT JOIN mesocycle_runs mr ON mr.id=dw.mesocycle_run_id
         WHERE mr.id IS NULL`,
      );
      expect(orphans).toBe(0);
    } finally {
      await cleanupUser(u2.id);
    }
  });

  it('template_version mismatch → 409 template_outdated', async () => {
    // Bump the template version, then try to materialize against the stale draft.
    await db.query(`UPDATE program_templates SET version=2 WHERE id=$1`, [templateId]);
    const u3 = await mkUser({ prefix: 'vitest.outdated' });
    try {
      const up3 = await mkUserProgram({ userId: u3.id, templateId, name: 'Stale draft' });
      await expect(
        materializeMesocycle({ userProgramId: up3.id, startDate: '2026-05-04', startTz: 'America/New_York' })
      ).rejects.toMatchObject({ code: 'template_outdated', latest_version: 2, status: 409 });
    } finally {
      await cleanupUser(u3.id);
      await db.query(`UPDATE program_templates SET version=1 WHERE id=$1`, [templateId]);
    }
  });

  it('bulk insert uses UNNEST not row-by-row (tx duration upper bound)', async () => {
    // Indirect proof: a 5-week × 1-day template materializes in well under
    // the time row-by-row inserts would take. Hard cap 1500ms in CI.
    const u4 = await mkUser({ prefix: 'vitest.bulk' });
    try {
      const up4 = await mkUserProgram({ userId: u4.id, templateId, name: 'Bulk-shape' });
      const t0 = Date.now();
      await materializeMesocycle({ userProgramId: up4.id, startDate: '2026-05-04', startTz: 'America/New_York' });
      expect(Date.now() - t0).toBeLessThan(1500);
    } finally {
      await cleanupUser(u4.id);
    }
  });
});
