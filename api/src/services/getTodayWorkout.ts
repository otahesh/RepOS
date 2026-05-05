// api/src/services/getTodayWorkout.ts
import { db } from '../db/client.js';
import { computeUserLocalDate } from './userLocalDate.js';
import { findSubstitutions } from './substitutions.js';

export type TodayWorkout =
  | { state: 'no_active_run' }
  | { state: 'rest'; run_id: string; scheduled_date: string }
  | {
      state: 'workout';
      run_id: string;
      day: { id: string; week_idx: number; day_idx: number; kind: string; name: string; scheduled_date: string };
      sets: Array<{
        id: string;
        block_idx: number;
        set_idx: number;
        exercise: { id: string; slug: string; name: string };
        target_reps_low: number;
        target_reps_high: number;
        target_rir: number;
        rest_sec: number;
        suggested_substitution?: { slug: string; name: string };
      }>;
      cardio: Array<{
        id: string;
        block_idx: number;
        exercise: { id: string; slug: string; name: string };
        target_duration_sec: number | null;
        target_distance_m: number | null;
        target_zone: number | null;
      }>;
    };

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getTodayWorkout(userId: string, now: Date = new Date()): Promise<TodayWorkout> {
  const { rows: [run] } = await db.query<{
    id: string; start_date: string; start_tz: string; weeks: number;
  }>(
    `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start_date, start_tz, weeks
     FROM mesocycle_runs WHERE user_id=$1 AND status='active'
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (!run) return { state: 'no_active_run' };

  const todayLocal = computeUserLocalDate(run.start_tz, now);
  const lastDate = addDaysISO(run.start_date, run.weeks * 7 - 1);
  if (todayLocal < run.start_date || todayLocal > lastDate) return { state: 'no_active_run' };

  const { rows: [day] } = await db.query<{
    id: string; week_idx: number; day_idx: number; kind: string; name: string; scheduled_date: string;
  }>(
    `SELECT id, week_idx, day_idx, kind, name, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
     FROM day_workouts
     WHERE mesocycle_run_id=$1 AND scheduled_date=$2::date`,
    [run.id, todayLocal],
  );
  if (!day) return { state: 'rest', run_id: run.id, scheduled_date: todayLocal };

  const { rows: setRows } = await db.query<{
    id: string; block_idx: number; set_idx: number;
    target_reps_low: number; target_reps_high: number; target_rir: number; rest_sec: number;
    ex_id: string; ex_slug: string; ex_name: string; ex_required: any;
  }>(
    `SELECT ps.id, ps.block_idx, ps.set_idx,
            ps.target_reps_low, ps.target_reps_high, ps.target_rir, ps.rest_sec,
            e.id AS ex_id, e.slug AS ex_slug, e.name AS ex_name,
            e.required_equipment AS ex_required
     FROM planned_sets ps JOIN exercises e ON e.id=ps.exercise_id
     WHERE ps.day_workout_id=$1
     ORDER BY ps.block_idx, ps.set_idx`,
    [day.id],
  );
  const { rows: cardioRows } = await db.query<{
    id: string; block_idx: number;
    target_duration_sec: number | null; target_distance_m: number | null; target_zone: number | null;
    ex_id: string; ex_slug: string; ex_name: string;
  }>(
    `SELECT pc.id, pc.block_idx, pc.target_duration_sec, pc.target_distance_m, pc.target_zone,
            e.id AS ex_id, e.slug AS ex_slug, e.name AS ex_name
     FROM planned_cardio_blocks pc JOIN exercises e ON e.id=pc.exercise_id
     WHERE pc.day_workout_id=$1
     ORDER BY pc.block_idx`,
    [day.id],
  );

  const { rows: [profileRow] } = await db.query<{ equipment_profile: Record<string, unknown> }>(
    `SELECT equipment_profile FROM users WHERE id=$1`, [userId],
  );
  const profile = profileRow?.equipment_profile ?? { _v: 1 };

  // For any block whose required_equipment predicates fail under the user's
  // current profile, attach a suggested_substitution from Library v1's ranker.
  const sets = await Promise.all(setRows.map(async (s) => {
    const predicates = (s.ex_required?.requires ?? []) as Array<{ type: string }>;
    const fits = allPredicatesSatisfied(predicates, profile);
    let suggested: { slug: string; name: string } | undefined;
    if (!fits) {
      const sub = await findSubstitutions(s.ex_slug, profile);
      const top = sub?.subs?.[0];
      if (top) suggested = { slug: top.slug, name: top.name };
    }
    return {
      id: s.id, block_idx: s.block_idx, set_idx: s.set_idx,
      exercise: { id: s.ex_id, slug: s.ex_slug, name: s.ex_name },
      target_reps_low: s.target_reps_low, target_reps_high: s.target_reps_high,
      target_rir: s.target_rir, rest_sec: s.rest_sec,
      ...(suggested ? { suggested_substitution: suggested } : {}),
    };
  }));

  return {
    state: 'workout',
    run_id: run.id,
    day: {
      id: day.id, week_idx: day.week_idx, day_idx: day.day_idx,
      kind: day.kind, name: day.name, scheduled_date: day.scheduled_date,
    },
    sets,
    cardio: cardioRows.map(c => ({
      id: c.id, block_idx: c.block_idx,
      exercise: { id: c.ex_id, slug: c.ex_slug, name: c.ex_name },
      target_duration_sec: c.target_duration_sec,
      target_distance_m: c.target_distance_m,
      target_zone: c.target_zone,
    })),
  };
}

// Lightweight local copy of the predicate-eval shape used by Library v1.
// Substitutions service has the canonical implementation; we only need a
// boolean here. Keep in sync (or factor into a shared util in a future
// refactor).
function allPredicatesSatisfied(preds: Array<{ type: string }>, profile: Record<string, unknown>): boolean {
  for (const p of preds) {
    const v = (profile as any)[p.type];
    const ok = v === true || (typeof v === 'object' && v !== null);
    if (!ok) return false;
  }
  return true;
}
