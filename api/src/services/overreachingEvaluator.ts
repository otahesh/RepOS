// api/src/services/overreachingEvaluator.ts
//
// Beta W3.1 — overreachingEvaluator. Strict AND-gate recovery flag:
//   (1) >= 3 RIR-0 sessions on COMPOUND exercises in trailing 7 days, AND
//   (2) current-week performed_sets >= MAV for at least one worked muscle.
//
// Compound = movement_pattern IN squat/hinge/push_{h,v}/pull_{h,v}. Lunge,
// carry, rotation, anti_rotation, and gait are excluded — they're not
// systemic-fatigue drivers in the RP framework that overreaching keys on.
//
// [FIX-5]  computeVolumeRollup takes a runId and returns
//          { run_id, weeks: WeekVolume[] } with weeks[].muscles[]
//          carrying performed_sets and mav. We look up the current week
//          via mesocycle_runs.current_week (1-indexed) because:
//            - day_workouts.week_idx is CHECK >= 1 in the schema
//            - WeekVolume.week_idx is 1-indexed (volumeRollup iterates
//              1..nWeeks)
//            - the recovery-flag ctx's weekIdx is set by the caller and
//              may not correspond to the run's currently-live week
//          Reading current_week makes the evaluator self-anchoring.
// [FIX-6]  RecoveryFlagEvaluator interface uses `key` (not `flag`); ctx is
//          { userId, runId, weekIdx }; result is { triggered: false } |
//          { triggered: true, message, payload? }. No `flag` field on the
//          result. weekIdx is accepted in ctx for interface symmetry but is
//          not consumed by this evaluator (see FIX-5 note above).
// [FIX-27] "Volume >= MAV for one week" is preserved as the gate-2 threshold
//          to keep the W1.5 e2e contract intact. The clinical reviewer flagged
//          this as closer to a "high-effort week" signal than canonical
//          overreaching — true overreach is a >=2-week pattern of fatigue
//          accumulation plus performance decrement. 1-week-MAV is a
//          first-cohort approximation chosen to emit actionable advisory copy
//          at low data volume; tightening to a multi-week pattern is gated on
//          recovery_flag_events telemetry from the alpha cohort. See
//          [[reference_w3_tuning_candidates]] memory for the tuning queue.

import { db } from '../db/client.js';
import type { RecoveryFlagEvaluator } from './recoveryFlags.js';
import { computeVolumeRollup } from './volumeRollup.js';

const COMPOUND_PATTERNS = [
  'squat',
  'hinge',
  'push_horizontal',
  'push_vertical',
  'pull_horizontal',
  'pull_vertical',
] as const;

export const overreachingEvaluator: RecoveryFlagEvaluator = {
  key: 'overreaching',
  version: 1,
  async evaluate({ userId, runId }) {
    // No active run → no current-week volume to compare → fail-closed.
    if (!runId) return { triggered: false };

    // [I-OVERREACHING-DELOAD-GUARD + C-IS-DELOAD] Deload-context guard. Fetch
    // BOTH the run-level flag (mesocycle_runs.is_deload — W4) AND the
    // current-week flag (day_workouts.is_deload — W2.5). Either being true
    // means "deload context" — return no-fire. A deload is intentionally low
    // load; an overreaching advisory here is a false alarm. Mirrors the
    // stalledPrEvaluator deload-skip approach but adds the run-level guard.
    const {
      rows: [ctx],
    } = await db.query<{ is_deload_run: boolean; is_deload_week: boolean }>(
      `SELECT bool_or(mr.is_deload) AS is_deload_run,
              COALESCE(bool_or(dw.is_deload), false) AS is_deload_week
       FROM mesocycle_runs mr
       LEFT JOIN day_workouts dw ON dw.mesocycle_run_id = mr.id AND dw.week_idx = mr.current_week
       WHERE mr.id = $1`,
      [runId],
    );
    if (ctx?.is_deload_run || ctx?.is_deload_week) return { triggered: false };

    // Condition 1: >= 3 distinct RIR-0 sessions on compound exercises in
    // trailing 7d. "Session" = day_workout (one per calendar day per user
    // in practice); COUNT DISTINCT dw.id collapses multiple RIR-0 sets in
    // the same session into one. Join through planned_sets → exercises so
    // we read the canonical movement_pattern from the planned exercise
    // (a future logged substitution would land in set_logs.exercise_id,
    // but the AND-gate semantically asks about programmed compound load).
    const {
      rows: [{ ct }],
    } = await db.query<{ ct: number }>(
      `SELECT COUNT(DISTINCT dw.id)::int AS ct
       FROM set_logs sl
       JOIN planned_sets ps ON ps.id = sl.planned_set_id
       JOIN exercises e ON e.id = ps.exercise_id
       JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE sl.user_id = $1
         AND sl.performed_rir = 0
         AND sl.performed_at > now() - INTERVAL '7 days'
         AND e.movement_pattern = ANY($2::movement_pattern[])`,
      [userId, [...COMPOUND_PATTERNS]],
    );
    if ((ct ?? 0) < 3) return { triggered: false };

    // Condition 2: current-week performed_sets >= MAV for at least one
    // worked muscle. mesocycle_runs.current_week is 1-indexed and matches
    // WeekVolume.week_idx by construction (volumeRollup loops 1..nWeeks).
    const {
      rows: [run],
    } = await db.query<{ current_week: number }>(
      `SELECT current_week FROM mesocycle_runs WHERE id = $1`,
      [runId],
    );
    if (!run) return { triggered: false };

    const rollup = await computeVolumeRollup(runId);
    const week = rollup.weeks.find((w) => w.week_idx === run.current_week);
    if (!week) return { triggered: false };

    const overMav = week.muscles.some((m) => m.performed_sets >= m.mav);
    if (!overMav) return { triggered: false };

    return {
      triggered: true,
      message: 'Heavy week — consider a deload',
    };
  },
};
