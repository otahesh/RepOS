/**
 * Frontend client for the /api/workouts/history surface.
 * Manually kept in sync with api/src/routes/workoutHistory.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */

import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';
export { ApiError } from './_http';

export type HistorySet = {
  weight_lbs: number | null;
  reps: number | null;
  rir: number | null;
  performed_at: string;
};

export type HistoryExercise = {
  slug: string;
  name: string;
  sets: HistorySet[];
};

export type HistoryItem = {
  id: string;
  name: string;
  kind: string;
  week_idx: number;
  day_idx: number;
  status: 'completed' | 'skipped';
  completed_at: string | null;
  scheduled_date: string;
  exercises: HistoryExercise[];
};

export type WorkoutHistoryPage = {
  items: HistoryItem[];
  next_cursor: string | null;
};

/**
 * Keyset-paginated workout history (per I-PAGINATION-KEYSET). Pass the prior
 * page's `next_cursor` to load the next slice; omit it to load the first page.
 */
export async function getWorkoutHistory(
  cursor?: string,
  limit?: number,
): Promise<WorkoutHistoryPage> {
  const qs = new URLSearchParams();
  if (limit != null) qs.set('limit', String(limit));
  if (cursor) qs.set('cursor', cursor);
  const query = qs.toString();
  const path = query ? `/api/workouts/history?${query}` : '/api/workouts/history';
  const res = await apiFetch(path, {});
  return jsonOrThrow(res);
}
