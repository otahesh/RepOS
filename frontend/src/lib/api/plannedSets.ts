/**
 * Frontend types for the /api/planned-sets surface.
 * Manually kept in sync with api/src/schemas/plannedSets.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */

import { jsonOrThrow } from './_http';

export { ApiError } from './_http';

export type PlannedSetPatch = {
  target_reps_low?: number;
  target_reps_high?: number;
  target_rir?: number;
  target_load_hint?: string | null;
  rest_sec?: number;
  override_reason?: string | null;
};

export type PlannedSetPatchResponse = {
  id: string;
  day_workout_id: string;
  block_idx: number;
  set_idx: number;
  exercise_id: string;
  target_reps_low: number;
  target_reps_high: number;
  target_rir: number;
  target_load_hint: string | null;
  rest_sec: number;
  overridden_at: string | null;
  override_reason: string | null;
  substituted_from_exercise_id: string | null;
};

export type PlannedSetSubstituteResponse = {
  id: string;
  exercise_id: string;
  substituted_from_exercise_id: string | null;
  overridden_at: string;
};

export async function patchPlannedSet(id: string, patch: PlannedSetPatch): Promise<PlannedSetPatchResponse> {
  const res = await fetch(`/api/planned-sets/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(patch),
  });
  return jsonOrThrow<PlannedSetPatchResponse>(res);
}

export async function substitutePlannedSet(
  id: string,
  body: { to_exercise_id: string }
): Promise<PlannedSetSubstituteResponse> {
  const res = await fetch(`/api/planned-sets/${encodeURIComponent(id)}/substitute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(body),
  });
  return jsonOrThrow<PlannedSetSubstituteResponse>(res);
}
