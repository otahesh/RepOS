import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser, mkTemplate, mkUserProgram, cleanupTemplate } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string; let upId: string;
let templateId: string;

beforeAll(async () => {
  app = await buildApp();
  userId = (await mkUser({ prefix: 'vitest.w4-rib' })).id;
  const tpl = await mkTemplate({
    prefix: 'vitest-w4-rib-tpl', weeks: 4,
    structure: { _v: 1, days: [
      { idx: 0, day_offset: 0, kind: 'strength', name: 'D', blocks: [
        { exercise_slug: 'barbell-bench-press', mev: 4, mav: 6, target_reps_low: 6, target_reps_high: 10, target_rir: 2, rest_sec: 180 },
      ]},
    ]},
  });
  templateId = tpl.id;
  upId = (await mkUserProgram({ userId, templateId: tpl.id, templateVersion: 1 })).id;
  const t = await app.inject({ method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 'a', scopes: ['program:write'] } });
  token = t.json<{ token: string }>().token;
});
afterAll(async () => {
  await cleanupUser(userId);
  await cleanupTemplate(templateId);
  await app.close();
});

describe('POST /api/user-programs/:id/start with intent param [C-RUN-IT-BACK-ROUTE + D3 + C-IS-DELOAD]', () => {
  it('intent=normal generates a non-deload mesocycle (is_deload=false on both run + day_workouts)', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${upId}/start?intent=normal`,
      headers: { authorization: `Bearer ${token}` },
      payload: { start_date: '2026-06-01', start_tz: 'UTC' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json<{ mesocycle_run_id: string }>();
    const { rows: [run] } = await db.query<{ is_deload: boolean }>(
      `SELECT is_deload FROM mesocycle_runs WHERE id=$1`, [body.mesocycle_run_id],
    );
    expect(run.is_deload).toBe(false);
    const { rows: dws } = await db.query<{ is_deload: boolean }>(
      `SELECT is_deload FROM day_workouts WHERE mesocycle_run_id=$1`, [body.mesocycle_run_id],
    );
    // [C-IS-DELOAD] every materialized day of a non-deload INTENT starts false.
    expect(dws.every((d) => d.is_deload === false)).toBe(true);
    await db.query(`UPDATE mesocycle_runs SET status='completed', finished_at=now() WHERE id=$1`, [body.mesocycle_run_id]);
  });

  it('intent=deload sets BOTH mesocycle_runs.is_deload=true AND day_workouts.is_deload=true [C-IS-DELOAD]', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${upId}/start?intent=deload`,
      headers: { authorization: `Bearer ${token}` },
      payload: { start_date: '2026-07-01', start_tz: 'UTC' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json<{ mesocycle_run_id: string }>();
    const { rows: [run] } = await db.query<{ is_deload: boolean }>(
      `SELECT is_deload FROM mesocycle_runs WHERE id=$1`, [body.mesocycle_run_id],
    );
    expect(run.is_deload).toBe(true);
    const { rows: dws } = await db.query<{ is_deload: boolean; week_idx: number }>(
      `SELECT is_deload, week_idx FROM day_workouts WHERE mesocycle_run_id=$1`, [body.mesocycle_run_id],
    );
    expect(dws.length).toBeGreaterThan(0);
    for (const dw of dws) expect(dw.is_deload).toBe(true);
  });

  it('intent=deload pins target_rir to 4 (not 3) on every planned_set [D3]', async () => {
    const { rows: [run] } = await db.query<{ id: string }>(
      `SELECT id FROM mesocycle_runs WHERE user_id=$1 AND is_deload=true ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const { rows: rirs } = await db.query<{ target_rir: number }>(
      `SELECT ps.target_rir FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1`, [run.id],
    );
    expect(rirs.length).toBeGreaterThan(0);
    for (const row of rirs) expect(row.target_rir).toBe(4);
  });

  it('intent=deload caps per-muscle weekly sets at floor(MAV * 0.5) [D3]', async () => {
    const { rows: [run] } = await db.query<{ id: string; ls: any }>(
      `SELECT id, landmarks_snapshot AS ls FROM mesocycle_runs WHERE user_id=$1 AND is_deload=true ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const chestMav = run.ls.chest.mav;
    const cap = Math.floor(chestMav * 0.5);
    const { rows: [agg] } = await db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       JOIN exercises e ON e.id=ps.exercise_id
       JOIN muscles m ON m.id=e.primary_muscle_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx=1 AND m.slug='chest'`, [run.id],
    );
    expect(parseInt(agg.n, 10)).toBeLessThanOrEqual(cap);
    expect(parseInt(agg.n, 10)).toBeGreaterThanOrEqual(1); // GREATEST(1, ...)
  });

  it('invariant: every deload mesocycle_runs row has is_deload=true on every day_workout [C-IS-DELOAD]', async () => {
    const { rows } = await db.query<{ mr_id: string; bad: string }>(
      `SELECT mr.id AS mr_id, COUNT(*) FILTER (WHERE dw.is_deload = false) AS bad
       FROM mesocycle_runs mr
       JOIN day_workouts dw ON dw.mesocycle_run_id = mr.id
       WHERE mr.is_deload = true
       GROUP BY mr.id`,
    );
    for (const row of rows) expect(parseInt(row.bad, 10)).toBe(0);
  });

  it('rejects request when a different active run exists', async () => {
    // teardown prior deload run + start a normal one
    await db.query(`UPDATE mesocycle_runs SET status='completed', finished_at=now() WHERE user_id=$1 AND status='active'`, [userId]);
    const r1 = await app.inject({ method: 'POST', url: `/api/user-programs/${upId}/start?intent=normal`,
      headers: { authorization: `Bearer ${token}` },
      payload: { start_date: '2026-08-01', start_tz: 'UTC' } });
    expect(r1.statusCode).toBe(201);
    const r2 = await app.inject({ method: 'POST', url: `/api/user-programs/${upId}/start?intent=normal`,
      headers: { authorization: `Bearer ${token}` },
      payload: { start_date: '2026-08-15', start_tz: 'UTC' } });
    expect(r2.statusCode).toBe(409);
    expect(r2.json<{ error: string }>().error).toBe('active_run_exists');
  });
});
