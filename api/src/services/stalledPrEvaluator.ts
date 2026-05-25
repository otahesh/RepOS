// api/src/services/stalledPrEvaluator.ts
//
// Beta W3.1 — stalledPrEvaluator. Recovery-flag evaluator that fires when
// the user has done the same load × reps × all-RIR-0 on a given exercise
// for the last 3 distinct sessions. Heuristic that flags hypertrophy-range
// stagnation; gated against false positives by deload + rep-range guards.
//
// [FIX-4]   set_logs columns are performed_load_lbs, performed_reps,
//           performed_rir. NO mesocycle_run_id / day_workout_id on set_logs —
//           we join through planned_sets → day_workouts to bucket logs into
//           sessions and to surface exercise_id.
// [FIX-6]   The RecoveryFlagEvaluator interface uses `key` (not `flag`);
//           ctx is { userId, runId, weekIdx }; result is
//           { triggered: false } | { triggered: true, message, payload? }.
//           No `flag` field on the result.
// [FIX-24 ADAPTED]
//           Deload guard. The plan's preferred signal — `day_workouts.is_deload`
//           — does NOT yet exist in the schema (W2 owns that column). As an
//           interim signal we use `mesocycle_runs.current_week >= weeks`:
//           by RP-hypertrophy convention the last week of a mesocycle IS the
//           deload week. This is a deliberate Phase 1 deviation; replace with
//           is_deload once W2 ships it. User-approved 2026-05-25.
// [FIX-25]  Gate on max_reps >= 5 — strength blocks at 2-3 reps legitimately
//           stall numerically and that is not a recovery signal. This rule
//           targets hypertrophy stagnation only.
import { db } from '../db/client.js';
import type { RecoveryFlagEvaluator } from './recoveryFlags.js';

type SessionRow = {
  exercise_id: string;
  day_workout_id: string;
  max_load: number;
  min_load: number;
  max_reps: number;
  min_reps: number;
  min_rir: number;
  session_rank: number;
};

export const stalledPrEvaluator: RecoveryFlagEvaluator = {
  key: 'stalled_pr',
  version: 1,
  async evaluate({ userId, runId }) {
    // No active run → fail-closed. Without a runId we can't (a) consult the
    // deload guard so we'd evaluate during the user's deload week and (b)
    // anchor the session-aggregate query to the active mesocycle so we'd
    // reach back into completed mesocycles and produce stale false positives
    // at meso-boundary transitions. Either failure mode dwarfs the missed-fire
    // risk for users without an active run.
    if (!runId) return { triggered: false };

    // [FIX-24 ADAPTED] Deload guard via mesocycle_runs.current_week >= weeks.
    const { rows: [run] } = await db.query<{ is_deload_week: boolean }>(
      `SELECT (current_week >= weeks) AS is_deload_week
       FROM mesocycle_runs WHERE id = $1`,
      [runId],
    );
    if (!run || run.is_deload_week) return { triggered: false };

    // Anchor the aggregate to the active mesocycle_run. Without this, sessions
    // from a completed prior run would bleed into the "last 3 sessions per
    // exercise" window — a user who hit RIR-0 5×5 for three weeks at the end
    // of meso N would still trip the alert in week 1 of meso N+1, despite the
    // current run having no stagnation signal at all.
    const { rows } = await db.query<SessionRow>(
      `WITH session_agg AS (
         SELECT
           ps.exercise_id,
           dw.id AS day_workout_id,
           MAX(sl.performed_load_lbs)::float AS max_load,
           MIN(sl.performed_load_lbs)::float AS min_load,
           MAX(sl.performed_reps)::int      AS max_reps,
           MIN(sl.performed_reps)::int      AS min_reps,
           MIN(sl.performed_rir)::int       AS min_rir,
           MAX(sl.performed_at)             AS session_at
         FROM set_logs sl
         JOIN planned_sets ps ON ps.id = sl.planned_set_id
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         WHERE sl.user_id = $1
           AND dw.mesocycle_run_id = $2
         GROUP BY ps.exercise_id, dw.id
       ),
       ranked AS (
         SELECT *,
                ROW_NUMBER() OVER (PARTITION BY exercise_id ORDER BY session_at DESC) AS session_rank
         FROM session_agg
       )
       SELECT exercise_id, day_workout_id,
              max_load, min_load, max_reps, min_reps, min_rir,
              session_rank
       FROM ranked
       WHERE session_rank <= 3
       ORDER BY exercise_id, session_rank`,
      [userId, runId],
    );

    const byEx = new Map<string, SessionRow[]>();
    for (const r of rows) {
      const arr = byEx.get(r.exercise_id) ?? [];
      arr.push(r);
      byEx.set(r.exercise_id, arr);
    }

    for (const sessions of byEx.values()) {
      if (sessions.length < 3) continue;
      const [a, b, c] = sessions;
      // [FIX-25] hypertrophy-range work only (>= 5 reps).
      if (a.max_reps < 5) continue;
      // Skip sessions with internal variance. MAX collapses a session with
      // one heavy top-set + back-off sets into the top-set tuple, which would
      // then match a session of pure top-set repeats — same numbers, very
      // different stimulus. Require a uniform-load uniform-rep session
      // (min_load === max_load, min_reps === max_reps) before treating the
      // session as comparable across the 3-session streak.
      if (a.min_load !== a.max_load || b.min_load !== b.max_load || c.min_load !== c.max_load) continue;
      if (a.min_reps !== a.max_reps || b.min_reps !== b.max_reps || c.min_reps !== c.max_reps) continue;
      if (
        a.max_load === b.max_load && b.max_load === c.max_load &&
        a.max_reps === b.max_reps && b.max_reps === c.max_reps &&
        a.min_rir === 0 && b.min_rir === 0 && c.min_rir === 0
      ) {
        return {
          triggered: true,
          message: 'Stalled PR — consider a load drop or rep adjustment',
          payload: { exercise_id: a.exercise_id },
        };
      }
    }
    return { triggered: false };
  },
};
