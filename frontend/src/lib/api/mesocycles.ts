/**
 * Frontend types for the /api/mesocycles surface.
 * Manually kept in sync with api/src/schemas/mesocycles.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */

import { jsonOrThrow } from './_http';
export { ApiError } from './_http';

export type MesocycleRunStatus =
  | 'draft' | 'active' | 'paused' | 'completed' | 'archived' | 'abandoned';

export type TodaySet = {
  id: string;
  block_idx: number;
  set_idx: number;
  exercise: {
    id: string;
    slug: string;
    name: string;
  };
  target_reps_low: number;
  target_reps_high: number;
  target_rir: number;
  rest_sec: number;
  target_load_hint?: string;
  suggested_substitution?: { id: string; slug: string; name: string; reason: string } | null;
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
};

export type TodayDay = {
  id: string;
  kind: 'strength' | 'cardio' | 'hybrid';
  name: string;
  week_idx: number;
  day_idx: number;
};

export type TodayWorkoutResponse =
  | { state: 'no_active_run' }
  | { state: 'rest'; run_id: string; scheduled_date: string }
  | {
      state: 'workout';
      run_id: string;
      day: TodayDay;
      sets: TodaySet[];
      cardio: TodayCardio[];
    };

// Mirror of api/src/services/volumeRollup.ts VolumeRollup. The API returns
// per-week nested muscles, NOT per-muscle indexed by week. Components that
// want a by-muscle view derive it locally — see ProgramPage.
export type MuscleVolume = {
  muscle: string;
  sets: number;
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

export async function getTodayWorkout(): Promise<TodayWorkoutResponse> {
  const res = await fetch('/api/mesocycles/today', { credentials: 'same-origin' });
  return jsonOrThrow(res);
}

export async function getMesocycle(id: string): Promise<MesocycleRunDetail> {
  const res = await fetch(`/api/mesocycles/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  return jsonOrThrow(res);
}

export async function getVolumeRollup(id: string): Promise<VolumeRollup> {
  const res = await fetch(`/api/mesocycles/${encodeURIComponent(id)}/volume-rollup`, { credentials: 'same-origin' });
  return jsonOrThrow(res);
}

export async function abandonMesocycle(id: string): Promise<AbandonMesocycleResponse> {
  const res = await fetch(`/api/mesocycles/${encodeURIComponent(id)}/abandon`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  return jsonOrThrow(res);
}
