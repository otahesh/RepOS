/**
 * Frontend types for the /api/mesocycles surface.
 * Manually kept in sync with api/src/schemas/mesocycles.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */

import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';
export { ApiError } from './_http';

export type MesocycleRunStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived'
  | 'abandoned';

export type TodaySet = {
  id: string;
  block_idx: number;
  set_idx: number;
  exercise: {
    id: string;
    slug: string;
    name: string;
    /** requires: [] on the exercise — the logger captures reps-only. Optional
     *  so older fixtures/mocks without it still compile (treated as false). */
    bodyweight?: boolean;
    /** Library-level classification; drives materialization + substitution
     *  filtering. Render mode keys on populated targets instead. */
    measurement?: 'reps' | 'duration';
  };
  /** Exactly one measurement dimension is populated per row (reps pair XOR
   *  duration pair). Nullable + optional while PR1..PR2 are in flight; the
   *  logger derives its input mode from WHICH pair is populated — never from
   *  exercise.measurement — so pre-reclassification rows render unchanged. */
  target_reps_low: number | null;
  target_reps_high: number | null;
  target_duration_low_sec?: number | null;
  target_duration_high_sec?: number | null;
  target_rir: number;
  rest_sec: number;
  target_load_hint?: string;
  suggested_substitution?: { id: string; slug: string; name: string; reason: string } | null;
  /** Latest log for this planned set, or null if never logged. Fields are
   *  individually nullable — a reps-only bodyweight log has weight_lbs: null,
   *  a duration-only hold has reps: null. */
  logged: { weight_lbs: number | null; reps: number | null; duration_sec?: number | null } | null;
};

export type TodayCardio = {
  id: string;
  block_idx: number;
  exercise: {
    id: string;
    slug: string;
    name: string;
  };
  target_duration_sec?: number | null;
  target_distance_m?: number | null;
  target_zone?: number | null;
  /** Latest cardio_log for this block, or null/absent if never completed. */
  logged?: { duration_sec: number; distance_m: number | null } | null;
};

export type TodayDay = {
  id: string;
  kind: 'strength' | 'cardio' | 'hybrid';
  name: string;
  week_idx: number;
  day_idx: number;
};

export type TodayPacing = {
  status: 'ahead' | 'on_pace' | 'behind';
  /** Whole days past the offered day's scheduled_date. Present only when behind. */
  days_behind?: number;
  /** The offered day's scheduled_date — a pacing hint, not a gate. */
  suggested_date: string;
};

export type TodayWorkoutResponse =
  | { state: 'no_active_run' }
  // All day workouts finished (or the latest run itself is completed) — dates
  // are pacing hints under sequence semantics, so there is no 'rest' state.
  | { state: 'mesocycle_complete'; run_id: string }
  | {
      state: 'workout';
      run_id: string;
      /** Source template's experience track — beginner runs render
       *  plain-language effort cues instead of RIR. Null for template-less runs. */
      track?: string | null;
      /** The run's start_date (YYYY-MM-DD). Floors the backfill date picker so a
       *  user can't stamp set-logs before the program started. */
      start_date: string;
      day: TodayDay;
      pacing: TodayPacing;
      /** True when the run already has a day workout completed on the user's
       *  current local day — lets the UI frame the next workout as optional. */
      completed_today: boolean;
      sets: TodaySet[];
      cardio: TodayCardio[];
    };

// Mirror of api/src/services/volumeRollup.ts VolumeRollup. The API returns
// per-week nested muscles, NOT per-muscle indexed by week. Components that
// want a by-muscle view derive it locally — see ProgramPage.
export type MuscleVolume = {
  muscle: string;
  /** Planned sum of contributions (fractional). */
  sets: number;
  /** Logged sum of contributions (fractional). 0 until the user logs sets. */
  performed_sets: number;
  mev: number;
  mav: number;
  mrv: number;
};

export type WeekVolume = {
  week_idx: number;
  muscles: MuscleVolume[];
  minutes_by_modality: Record<string, number>;
};

export type VolumeRollup = {
  run_id: string;
  weeks: WeekVolume[];
};

// NOTE: The real API returns user_id, finished_at, created_at, updated_at,
// and day_workouts. These are marked optional here for backward compat with
// test mocks that predate the schema migration — fix the mocks in a follow-up.
export type MesocycleRunDetail = {
  id: string;
  user_program_id: string;
  user_id?: string;
  start_date: string;
  start_tz: string;
  weeks: number;
  current_week: number;
  status: MesocycleRunStatus;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
  day_workouts?: Array<{
    id: string;
    week_idx: number;
    day_idx: number;
    scheduled_date: string;
    kind: string;
    name: string;
    status: string;
    completed_at: string | null;
  }>;
};

export type AbandonMesocycleResponse = {
  mesocycle_run_id: string;
  status: MesocycleRunStatus;
  finished_at: string;
};

// Mirror of api/src/schemas/mesocycles.ts MesocycleRecapStatsResponseSchema.
export type MesocycleRecapStats = {
  weeks: number;
  total_sets: number;
  prs: number;
  duration_prs?: Array<{
    exercise_slug: string;
    exercise_name: string;
    best_duration_sec: number;
    load_lbs: number | null;
  }>;
};

export async function getTodayWorkout(): Promise<TodayWorkoutResponse> {
  const res = await apiFetch('/api/mesocycles/today', {});
  return jsonOrThrow(res);
}

export async function getMesocycle(id: string): Promise<MesocycleRunDetail> {
  const res = await apiFetch(`/api/mesocycles/${encodeURIComponent(id)}`, {});
  return jsonOrThrow(res);
}

export async function getVolumeRollup(id: string): Promise<VolumeRollup> {
  const res = await apiFetch(`/api/mesocycles/${encodeURIComponent(id)}/volume-rollup`, {});
  return jsonOrThrow(res);
}

export async function abandonMesocycle(id: string): Promise<AbandonMesocycleResponse> {
  const res = await apiFetch(`/api/mesocycles/${encodeURIComponent(id)}/abandon`, {
    method: 'POST',
  });
  return jsonOrThrow(res);
}

export async function getMesocycleRecapStats(id: string): Promise<MesocycleRecapStats> {
  const res = await apiFetch(`/api/mesocycles/${encodeURIComponent(id)}/recap-stats`, {});
  return jsonOrThrow(res);
}

// [C-RUN-IT-BACK-ROUTE] Start a mesocycle via the unified
// POST /api/user-programs/:id/start?intent=normal|deload route. There is NO
// separate /run-it-back endpoint — "run it back" (normal) and "take a deload"
// (deload) both hit this with the appropriate intent.
export type StartMesocycleInput = {
  user_program_id: string;
  intent?: 'normal' | 'deload';
  start_date?: string;
  start_tz?: string;
};
export type StartMesocycleResponse = {
  mesocycle_run_id: string;
  start_date: string;
  start_tz: string;
  weeks: number;
  status: string;
  current_week: number;
  is_deload: boolean;
};

export async function startMesocycle(input: StartMesocycleInput): Promise<StartMesocycleResponse> {
  const body = {
    start_date: input.start_date ?? new Date().toISOString().slice(0, 10),
    start_tz: input.start_tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const intent = input.intent ?? 'normal';
  const res = await apiFetch(
    `/api/user-programs/${encodeURIComponent(input.user_program_id)}/start?intent=${intent}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return jsonOrThrow(res);
}
