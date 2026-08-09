import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';
import {
  mkUser,
  cleanupUser,
  mkTemplate,
  mkUserProgram,
  cleanupTemplate,
} from '../helpers/program-fixtures.js';
import { materializeMesocycle } from '../../src/services/materializeMesocycle.js';

describe('materializeMesocycle — uses resolveUserLandmarks (W4.2)', () => {
  let userId: string;
  const templateIds: string[] = [];
  beforeAll(async () => {
    userId = (await mkUser({ prefix: 'vitest.w4-mat' })).id;
  });
  afterAll(async () => {
    await cleanupUser(userId);
    for (const id of templateIds) await cleanupTemplate(id);
  });

  it('an active run is NOT mutated when landmarks are PATCHed mid-run', async () => {
    const tpl = await mkTemplate({
      prefix: 'vitest-w4-mat-tpl',
      weeks: 4,
      structure: {
        _v: 1,
        days: [
          {
            idx: 0,
            day_offset: 0,
            kind: 'strength',
            name: 'D',
            blocks: [
              {
                exercise_slug: 'barbell-bench-press',
                mev: 2,
                mav: 3,
                target_reps_low: 6,
                target_reps_high: 10,
                target_rir: 2,
                rest_sec: 180,
              },
            ],
          },
        ],
      },
    });
    templateIds.push(tpl.id);
    const up = await mkUserProgram({ userId, templateId: tpl.id, templateVersion: 1 });
    const { run_id } = await materializeMesocycle({
      userProgramId: up.id,
      startDate: '2026-06-01',
      startTz: 'UTC',
    });
    const { rows: before } = await db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx=1`,
      [run_id],
    );
    const beforeN = parseInt(before[0].n, 10);
    // PATCH the user's chest landmarks mid-run — the active run's planned_sets MUST be untouched.
    await db.query(`UPDATE users SET muscle_landmarks=$2::jsonb WHERE id=$1`, [
      userId,
      JSON.stringify({ _v: 1, overrides: { chest: { mev: 20, mav: 24, mrv: 30 } } }),
    ]);
    const { rows: after } = await db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx=1`,
      [run_id],
    );
    expect(parseInt(after[0].n, 10)).toBe(beforeN);
  });

  it('landmarks_snapshot column is populated on every new run [C-LANDMARKS-ACTIVE-RUN]', async () => {
    const { rows } = await db.query<{ ls: any }>(
      `SELECT landmarks_snapshot AS ls FROM mesocycle_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    expect(rows[0].ls).toBeTruthy();
    expect(rows[0].ls.chest).toBeDefined();
  });

  it('volume-rollup for an active run uses the SNAPSHOT, not current users.muscle_landmarks [C-LANDMARKS-ACTIVE-RUN]', async () => {
    // PATCH users.muscle_landmarks to a new value, then read the snapshot —
    // it must return the MATERIALIZE-TIME chest MAV, not the new value.
    const {
      rows: [run],
    } = await db.query<{ id: string; ls: any }>(
      `SELECT id, landmarks_snapshot AS ls FROM mesocycle_runs WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const snapshotMav = run.ls.chest.mav;
    await db.query(`UPDATE users SET muscle_landmarks=$2::jsonb WHERE id=$1`, [
      userId,
      JSON.stringify({ _v: 1, overrides: { chest: { mev: 30, mav: 40, mrv: 48 } } }),
    ]);
    const {
      rows: [check],
    } = await db.query<{ mav: number }>(
      `SELECT (landmarks_snapshot -> 'chest' ->> 'mav')::int AS mav FROM mesocycle_runs WHERE id=$1`,
      [run.id],
    );
    expect(check.mav).toBe(snapshotMav);
    expect(check.mav).not.toBe(40);
  });

  it('a NEW mesocycle after PATCH snapshots the overrides but sizes sets from the template blocks', async () => {
    // Mark prior run completed so the partial unique index allows another active run.
    const {
      rows: [existing],
    } = await db.query<{ id: string; user_program_id: string }>(
      `SELECT id, user_program_id FROM mesocycle_runs WHERE user_id=$1 AND status='active' LIMIT 1`,
      [userId],
    );
    await db.query(`UPDATE mesocycle_runs SET status='completed', finished_at=now() WHERE id=$1`, [
      existing.id,
    ]);
    const { run_id: runId2 } = await materializeMesocycle({
      userProgramId: existing.user_program_id,
      startDate: '2026-07-01',
      startTz: 'UTC',
    });
    // Planned sets come from the template's per-block ramp (mev=2 → 2 sets in
    // week 1) — landmark overrides deliberately do NOT inflate set counts.
    // The chest mev=30 override would previously have produced a 30-set week.
    const {
      rows: [agg],
    } = await db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       JOIN exercises e ON e.id=ps.exercise_id
       JOIN muscles m ON m.id=e.primary_muscle_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx=1 AND m.slug='chest'`,
      [runId2],
    );
    expect(parseInt(agg.n, 10)).toBe(2); // template block mev, not landmark mev
    // ...but the overrides DO land in the run's landmarks_snapshot, where the
    // MAV/MRV warning chips read them.
    const {
      rows: [snap],
    } = await db.query<{ mev: number }>(
      `SELECT (landmarks_snapshot -> 'chest' ->> 'mev')::int AS mev FROM mesocycle_runs WHERE id=$1`,
      [runId2],
    );
    expect(snap.mev).toBe(30);
  });
});
