// api/tests/getTodayWorkout.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { getTodayWorkout } from '../src/services/getTodayWorkout.js';
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
let userProgramId: string;
let runId: string;

const TEMPLATE = {
  _v: 1,
  days: [
    {
      idx: 0,
      day_offset: 0,
      kind: 'strength',
      name: 'Day A',
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
      ],
    },
    {
      idx: 1,
      day_offset: 2,
      kind: 'strength',
      name: 'Day B', // skips one day
      blocks: [
        {
          exercise_slug: 'barbell-back-squat',
          mev: 6,
          mav: 10,
          target_reps_low: 5,
          target_reps_high: 8,
          target_rir: 2,
          rest_sec: 180,
        },
      ],
    },
  ],
};

beforeAll(async () => {
  const u = await mkUser({
    prefix: 'vitest.today',
    equipment_profile: {
      _v: 1,
      dumbbells: { min_lb: 10, max_lb: 100, increment_lb: 10 },
      adjustable_bench: { incline: true, decline: false },
    },
  });
  userId = u.id;
  const t = await mkTemplate({
    prefix: 'vitest-today',
    name: 'Vitest today',
    weeks: 5,
    daysPerWeek: 2,
    structure: TEMPLATE,
  });
  templateId = t.id;
  const up = await mkUserProgram({ userId, templateId, name: 'Vitest today run' });
  userProgramId = up.id;

  // Start a run with start_date = 2026-05-04 (a Monday) in NY tz.
  const r = await materializeMesocycle({
    userProgramId,
    startDate: '2026-05-04',
    startTz: 'America/New_York',
  });
  runId = r.run_id;
});

afterAll(async () => {
  await cleanupUser(userId);
  await cleanupTemplate(templateId);
  await db.end();
});

describe('getTodayWorkout (sequence semantics)', () => {
  it('before run start → week 1 day 0 offered with pacing ahead', async () => {
    // Early training is allowed: the sequence has no start-date gate.
    const r = await getTodayWorkout(userId, new Date('2026-05-03T18:00:00Z')); // Sun NY
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.day.week_idx).toBe(1);
      expect(r.day.day_idx).toBe(0);
      expect(r.pacing).toEqual({ status: 'ahead', suggested_date: '2026-05-04' });
      expect(r.completed_today).toBe(false);
    }
  });

  it('workout day → state=workout with sets attached, pacing on_pace', async () => {
    // 2026-05-04 NY = day_idx 0 = Day A
    const r = await getTodayWorkout(userId, new Date('2026-05-04T16:00:00Z')); // Mon noon NY
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.day.kind).toBe('strength');
      expect(r.sets.length).toBeGreaterThan(0);
      expect(r.run_id).toBe(runId);
      expect(r.pacing).toEqual({ status: 'on_pace', suggested_date: '2026-05-04' });
      expect(r.completed_today).toBe(false);
    }
  });

  it('exposes the run start_date (floors the backfill picker)', async () => {
    // The run was materialized with start_date = 2026-05-04; the workout
    // response must surface it so the client can floor the past-workout picker
    // and prevent orphaned pre-start set-logs.
    const r = await getTodayWorkout(userId, new Date('2026-05-04T16:00:00Z'));
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.start_date).toBe('2026-05-04');
    }
  });

  it('day after an incomplete workout → same workout still offered, behind by 1', async () => {
    // 2026-05-05 NY: no day scheduled, but Day A (05-04) is still planned →
    // the sequence offers it (was state=rest under date semantics).
    const r = await getTodayWorkout(userId, new Date('2026-05-05T16:00:00Z'));
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.run_id).toBe(runId);
      expect(r.day.week_idx).toBe(1);
      expect(r.day.day_idx).toBe(0);
      expect(r.pacing).toEqual({ status: 'behind', days_behind: 1, suggested_date: '2026-05-04' });
    }
  });

  it('earliest incomplete workout offered when its scheduled_date is past (behind by 3)', async () => {
    // 2026-05-07 NY: Day A (05-04) and Day B (05-06) both still planned →
    // earliest (week 1, day 0) wins; days_behind measured from ITS date.
    const r = await getTodayWorkout(userId, new Date('2026-05-07T16:00:00Z'));
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.day.week_idx).toBe(1);
      expect(r.day.day_idx).toBe(0);
      expect(r.pacing).toEqual({ status: 'behind', days_behind: 3, suggested_date: '2026-05-04' });
    }
  });

  it('past the old calendar window → earliest incomplete still offered (no window gate)', async () => {
    // 5 weeks * 7 days = 35 days starting 05-04 → old window ended 06-07.
    // Sequence semantics: the run ends by completion, not by date.
    const r = await getTodayWorkout(userId, new Date('2026-06-15T16:00:00Z'));
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.day.week_idx).toBe(1);
      expect(r.day.day_idx).toBe(0);
      expect(r.pacing.status).toBe('behind');
    }
  });

  it('DST spring-forward day still resolves once', async () => {
    // The run starts 05-04, post-DST. Force a different shorter run that
    // straddles DST forward (2026-03-08).
    const u2 = await mkUser({ prefix: 'vitest.today.dst', equipment_profile: { _v: 1 } });
    try {
      const up2 = await mkUserProgram({ userId: u2.id, templateId, name: 'DST run' });
      await materializeMesocycle({
        userProgramId: up2.id,
        startDate: '2026-03-08',
        startTz: 'America/New_York',
      });

      const before = await getTodayWorkout(u2.id, new Date('2026-03-08T06:00:00Z')); // 01:00 EST
      const after = await getTodayWorkout(u2.id, new Date('2026-03-08T08:00:00Z')); // 04:00 EDT
      expect(before.state).toBe('workout');
      expect(after.state).toBe('workout');
      if (before.state === 'workout' && after.state === 'workout') {
        expect(after.day.id).toBe(before.day.id);
      }
    } finally {
      await cleanupUser(u2.id);
    }
  });

  it('TZ-change-mid-mesocycle still resolves to start_tz', async () => {
    // Caller passes start_tz, not the user's current device tz, so even if
    // we fed Pacific instant the resolved date is NY.
    const r = await getTodayWorkout(userId, new Date('2026-05-04T03:00:00Z')); // 23:00 May-3 NY
    // 2026-05-03 NY is one day before Day A's scheduled_date → ahead
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.pacing).toEqual({ status: 'ahead', suggested_date: '2026-05-04' });
    }
  });

  it('leap-year boundary (Feb 29 → Mar 1) resolves correctly', async () => {
    const u3 = await mkUser({ prefix: 'vitest.today.leap', equipment_profile: { _v: 1 } });
    try {
      const up3 = await mkUserProgram({ userId: u3.id, templateId, name: 'Leap' });
      await materializeMesocycle({
        userProgramId: up3.id,
        startDate: '2028-02-29',
        startTz: 'UTC',
      });

      const feb29 = await getTodayWorkout(u3.id, new Date('2028-02-29T12:00:00Z'));
      const mar1 = await getTodayWorkout(u3.id, new Date('2028-03-01T12:00:00Z'));
      expect(feb29.state).toBe('workout'); // day_offset 0, on pace
      if (feb29.state === 'workout') {
        expect(feb29.pacing).toEqual({ status: 'on_pace', suggested_date: '2028-02-29' });
      }
      // Day 0 (02-29) still planned on 03-01 → still offered, leap-day math = 1 day behind
      expect(mar1.state).toBe('workout');
      if (mar1.state === 'workout') {
        expect(mar1.pacing).toEqual({
          status: 'behind',
          days_behind: 1,
          suggested_date: '2028-02-29',
        });
      }
    } finally {
      await cleanupUser(u3.id);
    }
  });

  it('truly nothing (user has no runs at all) → no_active_run', async () => {
    const u5 = await mkUser({ prefix: 'vitest.today.between' });
    try {
      const r = await getTodayWorkout(u5.id, new Date('2026-05-04T16:00:00Z'));
      expect(r.state).toBe('no_active_run');
    } finally {
      await cleanupUser(u5.id);
    }
  });

  it('equipment-fit failure attaches suggested_substitution', async () => {
    // userId profile has dumbbells + adjustable_bench but NO barbell + NO flat_bench.
    // barbell-bench-press requires both → predicate fails → substitution should attach.
    const r = await getTodayWorkout(userId, new Date('2026-05-04T16:00:00Z'));
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.sets.length).toBeGreaterThan(0);
      // Every set in this day uses barbell-bench-press (the verbatim template
      // structure has only that exercise). Each should carry a substitution.
      for (const s of r.sets) {
        expect(s.suggested_substitution).toBeDefined();
        expect(s.suggested_substitution!.slug).not.toBe('barbell-bench-press');
      }
    }
  });

  it('carries latest logged weight/reps once a set_log exists', async () => {
    // Two planned sets from Day A of week 1. dw.day_idx in the ORDER BY breaks
    // the Day A/Day B tie (both have block_idx 0 / set_idx 0) so the pick is
    // deterministic instead of physical-row-order.
    const { rows: pss } = await db.query(
      `SELECT ps.id, ps.exercise_id FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1
       ORDER BY dw.week_idx, dw.day_idx, ps.block_idx, ps.set_idx LIMIT 2`,
      [runId],
    );
    expect(pss.length).toBe(2);
    const [ps, ps2] = pss;
    await db.query(
      `INSERT INTO set_logs (planned_set_id, user_id, exercise_id, client_request_id, performed_reps, performed_load_lbs, performed_rir)
       VALUES ($1,$2,$3,gen_random_uuid(),8,135.0,2)`,
      [ps.id, userId, ps.exercise_id],
    );
    // Reps-only (bodyweight-style) log: weight null is legal and must still
    // read as logged, not unlogged.
    await db.query(
      `INSERT INTO set_logs (planned_set_id, user_id, exercise_id, client_request_id, performed_reps, performed_load_lbs, performed_rir)
       VALUES ($1,$2,$3,gen_random_uuid(),12,NULL,2)`,
      [ps2.id, userId, ps2.exercise_id],
    );
    try {
      // 2026-05-04 NY = day_idx 0 = Day A (same fixed `now` as the workout-day test above).
      const today = await getTodayWorkout(userId, new Date('2026-05-04T16:00:00Z'));
      if (today.state !== 'workout') throw new Error('expected workout state');
      const logged = today.sets.find((s) => s.id === ps.id);
      expect(logged).toBeDefined();
      expect(logged!.logged).toEqual({ weight_lbs: 135, reps: 8 });
      const repsOnly = today.sets.find((s) => s.id === ps2.id);
      expect(repsOnly).toBeDefined();
      expect(repsOnly!.logged).toEqual({ weight_lbs: null, reps: 12 });
      expect(
        today.sets.filter((s) => s.id !== ps.id && s.id !== ps2.id).every((s) => s.logged === null),
      ).toBe(true);
    } finally {
      await db.query(`DELETE FROM set_logs WHERE planned_set_id = ANY($1::uuid[])`, [
        [ps.id, ps2.id],
      ]);
    }
  });
});

describe('getTodayWorkout (sequence progression + completion)', () => {
  /** Dedicated user + materialized run (start 2026-05-04, NY) so status
   *  mutations never leak into the shared file-scope fixture run. */
  async function mkRun(prefix: string): Promise<{ uid: string; rid: string }> {
    const u = await mkUser({ prefix, equipment_profile: { _v: 1 } });
    const up = await mkUserProgram({ userId: u.id, templateId, name: `${prefix} run` });
    const r = await materializeMesocycle({
      userProgramId: up.id,
      startDate: '2026-05-04',
      startTz: 'America/New_York',
    });
    return { uid: u.id, rid: r.run_id };
  }

  it('completing day 0 advances to day 1 the same day, completed_today=true', async () => {
    const { uid, rid } = await mkRun('vitest.today.advance');
    try {
      await db.query(
        `UPDATE day_workouts SET status='completed', completed_at='2026-05-04T17:00:00Z'
         WHERE mesocycle_run_id=$1 AND week_idx=1 AND day_idx=0`,
        [rid],
      );
      const r = await getTodayWorkout(uid, new Date('2026-05-04T18:00:00Z')); // still Mon NY
      expect(r.state).toBe('workout');
      if (r.state === 'workout') {
        expect(r.day.week_idx).toBe(1);
        expect(r.day.day_idx).toBe(1);
        expect(r.day.scheduled_date).toBe('2026-05-06');
        expect(r.pacing).toEqual({ status: 'ahead', suggested_date: '2026-05-06' });
        expect(r.completed_today).toBe(true);
      }
    } finally {
      await cleanupUser(uid);
    }
  });

  it('completed_today=false when the last completion was a previous local day', async () => {
    const { uid, rid } = await mkRun('vitest.today.stale');
    try {
      await db.query(
        `UPDATE day_workouts SET status='completed', completed_at='2026-05-04T17:00:00Z'
         WHERE mesocycle_run_id=$1 AND week_idx=1 AND day_idx=0`,
        [rid],
      );
      const r = await getTodayWorkout(uid, new Date('2026-05-05T16:00:00Z')); // Tue NY
      expect(r.state).toBe('workout');
      if (r.state === 'workout') {
        expect(r.day.day_idx).toBe(1);
        expect(r.completed_today).toBe(false);
      }
    } finally {
      await cleanupUser(uid);
    }
  });

  it('skipped day is passed over — next planned day offered', async () => {
    const { uid, rid } = await mkRun('vitest.today.skip');
    try {
      await db.query(
        `UPDATE day_workouts SET status='skipped'
         WHERE mesocycle_run_id=$1 AND week_idx=1 AND day_idx=0`,
        [rid],
      );
      const r = await getTodayWorkout(uid, new Date('2026-05-04T16:00:00Z'));
      expect(r.state).toBe('workout');
      if (r.state === 'workout') {
        expect(r.day.week_idx).toBe(1);
        expect(r.day.day_idx).toBe(1);
        expect(r.completed_today).toBe(false);
      }
    } finally {
      await cleanupUser(uid);
    }
  });

  it('all day workouts terminal on an active run → mesocycle_complete (case a)', async () => {
    const { uid, rid } = await mkRun('vitest.today.done');
    try {
      await db.query(
        `UPDATE day_workouts SET status='completed', completed_at=now()
         WHERE mesocycle_run_id=$1`,
        [rid],
      );
      const r = await getTodayWorkout(uid, new Date('2026-06-01T16:00:00Z'));
      expect(r).toEqual({ state: 'mesocycle_complete', run_id: rid });
    } finally {
      await cleanupUser(uid);
    }
  });

  it('no active run but latest run is completed → mesocycle_complete (case b)', async () => {
    const { uid, rid } = await mkRun('vitest.today.finished');
    try {
      await db.query(`UPDATE mesocycle_runs SET status='completed' WHERE id=$1`, [rid]);
      const r = await getTodayWorkout(uid, new Date('2026-06-10T16:00:00Z'));
      expect(r).toEqual({ state: 'mesocycle_complete', run_id: rid });
    } finally {
      await cleanupUser(uid);
    }
  });

  it('no active run and latest run abandoned → no_active_run', async () => {
    const { uid, rid } = await mkRun('vitest.today.abandoned');
    try {
      await db.query(`UPDATE mesocycle_runs SET status='abandoned' WHERE id=$1`, [rid]);
      const r = await getTodayWorkout(uid, new Date('2026-06-10T16:00:00Z'));
      expect(r.state).toBe('no_active_run');
    } finally {
      await cleanupUser(uid);
    }
  });
});
