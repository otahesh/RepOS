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

export type VolumeRollup = {
  sets_by_week_by_muscle: Record<string, number[]>;
  landmarks: Record<string, { mev: number; mav: number; mrv: number }>;
  cardio_minutes_by_modality: Record<string, number[]>;
};

export type MesocycleRunDetail = {
  id: string;
  user_program_id: string;
  start_date: string;
  start_tz: string;
  weeks: number;
  current_week: number;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

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
