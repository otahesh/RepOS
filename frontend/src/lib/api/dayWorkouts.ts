/**
 * Frontend client for the /api/day-workouts/:id/{complete,skip,reopen} surface.
 * Manually kept in sync with api/src/routes/dayWorkouts.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */

import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';
export { ApiError } from './_http';

export type DayWorkoutStatusResponse = {
  id: string;
  status: string;
  completed_at: string | null;
  /** True when this call closed out the mesocycle run (no open workouts left). */
  run_completed: boolean;
};

/**
 * Marks a day workout completed. `completed_on` (YYYY-MM-DD) backfills a past
 * day; omit it to stamp `completed_at: now()`. Always sends a JSON body (`{}`
 * when no opts) — the route parses `req.body ?? {}` either way.
 */
export async function completeDayWorkout(
  id: string,
  opts?: { completed_on?: string },
): Promise<DayWorkoutStatusResponse> {
  const body = opts?.completed_on ? { completed_on: opts.completed_on } : {};
  const res = await apiFetch(`/api/day-workouts/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function skipDayWorkout(id: string): Promise<DayWorkoutStatusResponse> {
  const res = await apiFetch(`/api/day-workouts/${encodeURIComponent(id)}/skip`, {
    method: 'POST',
  });
  return jsonOrThrow(res);
}

export async function reopenDayWorkout(id: string): Promise<DayWorkoutStatusResponse> {
  const res = await apiFetch(`/api/day-workouts/${encodeURIComponent(id)}/reopen`, {
    method: 'POST',
  });
  return jsonOrThrow(res);
}
