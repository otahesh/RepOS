/**
 * Frontend client for the /api/exercises/:slug/history surface.
 * Manually kept in sync with the backend route added alongside this client.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */

import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export { ApiError } from './_http';

// set_logs performed columns are nullable and the history SQL doesn't filter
// nulls — a reps-only bodyweight log emits weight_lbs: null; a hold emits
// reps: null with duration_sec set. Optional while the API change deploys.
export type HistorySet = {
  weight_lbs: number | null;
  reps: number | null;
  duration_sec?: number | null;
  rir: number | null;
};
export type HistorySession = { date: string; sets: HistorySet[] };

export async function getExerciseHistory(slug: string, limit = 8): Promise<HistorySession[]> {
  const res = await apiFetch(
    `/api/exercises/${encodeURIComponent(slug)}/history?limit=${limit}`,
    {},
  );
  const body = await jsonOrThrow<{ sessions: HistorySession[] }>(res);
  return body.sessions;
}
