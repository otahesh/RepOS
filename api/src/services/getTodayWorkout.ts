// api/src/services/getTodayWorkout.ts
import { db } from '../db/client.js';
import { computeUserLocalDate } from './userLocalDate.js';
import { findSubstitutions } from './substitutions.js';
import { allPredicatesSatisfied } from './_equipmentPredicate.js';
import type { PredicateT } from '../schemas/predicate.js';

export type TodayPacing = {
  status: 'ahead' | 'on_pace' | 'behind';
  /** Whole days past the offered day's scheduled_date. Present only when behind. */
  days_behind?: number;
  /** The offered day's scheduled_date — the plan's pacing hint, not a gate. */
  suggested_date: string;
};

export type TodayWorkout =
  | { state: 'no_active_run' }
  | { state: 'mesocycle_complete'; run_id: string }
  | {
      state: 'workout';
      run_id: string;
      /** Experience track of the source template — beginner runs render
       *  plain-language effort cues instead of RIR. Null for template-less runs. */
      track: string | null;
      /** The run's start_date (YYYY-MM-DD, run tz). Floors the backfill date
       *  picker so a user can't stamp set-logs before the program started. */
      start_date: string;
      day: {
        id: string;
        week_idx: number;
        day_idx: number;
        kind: string;
        name: string;
        scheduled_date: string;
      };
      pacing: TodayPacing;
      /** True when the run already has a day workout completed on the user's
       *  current local day — lets the UI frame the next workout as optional. */
      completed_today: boolean;
      sets: Array<{
        id: string;
        block_idx: number;
        set_idx: number;
        // bodyweight: required_equipment.requires is empty — the logger
        // captures reps-only for these (no meaningful external load).
        // measurement: how the EXERCISE is classified today. Render mode must
        // key on the row's populated targets, NOT this field — rows
        // materialized before a reclassification keep their original shape.
        exercise: {
          id: string;
          slug: string;
          name: string;
          bodyweight: boolean;
          measurement: 'reps' | 'duration';
        };
        /** Exactly one measurement dimension is populated (reps pair XOR duration pair). */
        target_reps_low: number | null;
        target_reps_high: number | null;
        target_duration_low_sec: number | null;
        target_duration_high_sec: number | null;
        target_rir: number;
        rest_sec: number;
        /** Latest log for this planned set, or null if never logged. Present iff a
         *  set_log row exists; fields pass through as-is (each may be null —
         *  e.g. reps-only bodyweight logs, duration-only holds). Lets the UI
         *  show completion after reload. */
        logged: {
          weight_lbs: number | null;
          reps: number | null;
          duration_sec: number | null;
        } | null;
        suggested_substitution?: { id: string; slug: string; name: string; reason: string };
      }>;
      cardio: Array<{
        id: string;
        block_idx: number;
        exercise: { id: string; slug: string; name: string };
        target_duration_sec: number | null;
        target_distance_m: number | null;
        target_zone: number | null;
        /** Latest cardio_log for this block, or null if never completed. */
        logged: { duration_sec: number; distance_m: number | null } | null;
      }>;
    };

export async function getTodayWorkout(
  userId: string,
  now: Date = new Date(),
): Promise<TodayWorkout> {
  const {
    rows: [run],
  } = await db.query<{
    id: string;
    start_tz: string;
    start_date: string;
    track: string | null;
  }>(
    `SELECT mr.id, mr.start_tz,
            to_char(mr.start_date, 'YYYY-MM-DD') AS start_date,
            pt.track AS track
     FROM mesocycle_runs mr
     JOIN user_programs up ON up.id = mr.user_program_id
     LEFT JOIN program_templates pt ON pt.id = up.template_id
     WHERE mr.user_id=$1 AND mr.status='active'
     ORDER BY mr.created_at DESC LIMIT 1`,
    [userId],
  );
  if (!run) {
    // No active run: if the user's most recent run finished, surface the
    // completion state (transient until Task 2's lifecycle keeps it brief).
    const {
      rows: [latest],
    } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM mesocycle_runs
       WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (latest?.status === 'completed') return { state: 'mesocycle_complete', run_id: latest.id };
    return { state: 'no_active_run' };
  }

  const todayLocal = computeUserLocalDate(run.start_tz, now);

  // Sequence semantics: today's workout is the earliest not-yet-finished day,
  // regardless of calendar date. Dates are pacing hints, not gates.
  const {
    rows: [day],
  } = await db.query<{
    id: string;
    week_idx: number;
    day_idx: number;
    kind: string;
    name: string;
    scheduled_date: string;
  }>(
    `SELECT id, week_idx, day_idx, kind, name, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
     FROM day_workouts
     WHERE mesocycle_run_id=$1 AND status IN ('planned','in_progress')
     ORDER BY week_idx, day_idx LIMIT 1`,
    [run.id],
  );
  if (!day) return { state: 'mesocycle_complete', run_id: run.id };

  const pacing: TodayPacing = { status: 'on_pace', suggested_date: day.scheduled_date };
  if (day.scheduled_date > todayLocal) {
    pacing.status = 'ahead';
  } else if (day.scheduled_date < todayLocal) {
    pacing.status = 'behind';
    pacing.days_behind = Math.round(
      (Date.parse(`${todayLocal}T00:00:00Z`) - Date.parse(`${day.scheduled_date}T00:00:00Z`)) /
        86_400_000,
    );
  }

  const {
    rows: [lastCompleted],
  } = await db.query<{ last_completed_at: Date | null }>(
    `SELECT MAX(completed_at) AS last_completed_at
     FROM day_workouts WHERE mesocycle_run_id=$1 AND status='completed'`,
    [run.id],
  );
  const completedToday =
    lastCompleted?.last_completed_at != null &&
    computeUserLocalDate(run.start_tz, lastCompleted.last_completed_at) === todayLocal;

  const { rows: setRows } = await db.query<{
    id: string;
    block_idx: number;
    set_idx: number;
    target_reps_low: number | null;
    target_reps_high: number | null;
    target_duration_low_sec: number | null;
    target_duration_high_sec: number | null;
    target_rir: number;
    rest_sec: number;
    ex_id: string;
    ex_slug: string;
    ex_name: string;
    ex_required: any;
    ex_measurement: 'reps' | 'duration';
    logged_id: string | null;
    logged_weight: number | null;
    logged_reps: number | null;
    logged_duration: number | null;
  }>(
    `SELECT ps.id, ps.block_idx, ps.set_idx,
            ps.target_reps_low, ps.target_reps_high,
            ps.target_duration_low_sec, ps.target_duration_high_sec,
            ps.target_rir, ps.rest_sec,
            e.id AS ex_id, e.slug AS ex_slug, e.name AS ex_name,
            e.required_equipment AS ex_required,
            e.measurement AS ex_measurement,
            sl.id AS logged_id,
            sl.performed_load_lbs::float AS logged_weight, sl.performed_reps AS logged_reps,
            sl.performed_duration_sec AS logged_duration
     FROM planned_sets ps
     JOIN exercises e ON e.id=ps.exercise_id
     LEFT JOIN LATERAL (
       SELECT id, performed_load_lbs, performed_reps, performed_duration_sec FROM set_logs
       WHERE planned_set_id = ps.id ORDER BY performed_at DESC LIMIT 1
     ) sl ON true
     WHERE ps.day_workout_id=$1
     ORDER BY ps.block_idx, ps.set_idx`,
    [day.id],
  );
  const { rows: cardioRows } = await db.query<{
    id: string;
    block_idx: number;
    target_duration_sec: number | null;
    target_distance_m: number | null;
    target_zone: number | null;
    ex_id: string;
    ex_slug: string;
    ex_name: string;
    logged_id: string | null;
    logged_duration: number | null;
    logged_distance: number | null;
  }>(
    `SELECT pc.id, pc.block_idx, pc.target_duration_sec, pc.target_distance_m, pc.target_zone,
            e.id AS ex_id, e.slug AS ex_slug, e.name AS ex_name,
            cl.id AS logged_id,
            cl.performed_duration_sec AS logged_duration,
            cl.performed_distance_m   AS logged_distance
     FROM planned_cardio_blocks pc JOIN exercises e ON e.id=pc.exercise_id
     LEFT JOIN LATERAL (
       SELECT id, performed_duration_sec, performed_distance_m FROM cardio_logs
       WHERE planned_cardio_block_id = pc.id ORDER BY performed_at DESC LIMIT 1
     ) cl ON true
     WHERE pc.day_workout_id=$1
     ORDER BY pc.block_idx`,
    [day.id],
  );

  const {
    rows: [profileRow],
  } = await db.query<{ equipment_profile: Record<string, unknown> }>(
    `SELECT equipment_profile FROM users WHERE id=$1`,
    [userId],
  );
  const profile = profileRow?.equipment_profile ?? { _v: 1 };

  // For any block whose required_equipment predicates fail under the user's
  // current profile, attach a suggested_substitution from Library v1's ranker.
  const sets = await Promise.all(
    setRows.map(async (s) => {
      const predicates = (s.ex_required?.requires ?? []) as PredicateT[];
      const fits = allPredicatesSatisfied(predicates, profile);
      let suggested: { id: string; slug: string; name: string; reason: string } | undefined;
      if (!fits) {
        // Beta W3.2 — pass userId so the picked suggested_substitution also
        // reflects injury-aware ranking (knee-stressful alternative for a knee
        // injury would otherwise outrank a safer choice).
        const sub = await findSubstitutions(s.ex_slug, profile, userId);
        const top = sub?.subs?.[0];
        if (top) suggested = { id: top.id, slug: top.slug, name: top.name, reason: top.reason };
      }
      return {
        id: s.id,
        block_idx: s.block_idx,
        set_idx: s.set_idx,
        exercise: {
          id: s.ex_id,
          slug: s.ex_slug,
          name: s.ex_name,
          bodyweight: predicates.length === 0,
          measurement: s.ex_measurement,
        },
        target_reps_low: s.target_reps_low,
        target_reps_high: s.target_reps_high,
        target_duration_low_sec: s.target_duration_low_sec,
        target_duration_high_sec: s.target_duration_high_sec,
        target_rir: s.target_rir,
        rest_sec: s.rest_sec,
        logged:
          s.logged_id != null
            ? {
                weight_lbs: s.logged_weight,
                reps: s.logged_reps,
                duration_sec: s.logged_duration,
              }
            : null,
        ...(suggested ? { suggested_substitution: suggested } : {}),
      };
    }),
  );

  return {
    state: 'workout',
    run_id: run.id,
    track: run.track,
    start_date: run.start_date,
    day: {
      id: day.id,
      week_idx: day.week_idx,
      day_idx: day.day_idx,
      kind: day.kind,
      name: day.name,
      scheduled_date: day.scheduled_date,
    },
    pacing,
    completed_today: completedToday,
    sets,
    cardio: cardioRows.map((c) => ({
      id: c.id,
      block_idx: c.block_idx,
      exercise: { id: c.ex_id, slug: c.ex_slug, name: c.ex_name },
      target_duration_sec: c.target_duration_sec,
      target_distance_m: c.target_distance_m,
      target_zone: c.target_zone,
      logged:
        c.logged_id != null
          ? { duration_sec: c.logged_duration as number, distance_m: c.logged_distance }
          : null,
    })),
  };
}
