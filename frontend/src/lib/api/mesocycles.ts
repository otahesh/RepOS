import { jsonOrThrow } from './_http';
export { ApiError } from './_http';

export type TodayWorkoutResponse =
  | { state: 'no_active_run' }
  | { state: 'rest'; run_id: string; scheduled_date: string }
  | {
      state: 'workout';
      run_id: string;
      day: { id: string; kind: 'strength' | 'cardio' | 'hybrid'; name: string; week_idx: number; day_idx: number };
      sets: Array<{
        id: string;
        exercise_id: string;
        exercise_slug?: string;
        exercise_name?: string;
        block_idx: number;
        set_idx: number;
        target_reps_low: number;
        target_reps_high: number;
        target_rir: number;
        rest_sec: number;
        target_load_hint?: string;
        suggested_substitution?: { slug: string; name: string; reason: string } | null;
      }>;
      cardio: Array<{
        id: string;
        exercise_id: string;
        exercise_name?: string;
        target_duration_sec?: number;
        target_distance_m?: number;
        target_zone?: number;
      }>;
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

export type MesocycleRunStatus =
  | 'draft' | 'active' | 'paused' | 'completed' | 'archived' | 'abandoned';

export type MesocycleRunDetail = {
  id: string;
  user_program_id: string;
  start_date: string;
  start_tz: string;
  weeks: number;
  current_week: number;
  status: MesocycleRunStatus;
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
