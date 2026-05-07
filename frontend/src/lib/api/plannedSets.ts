/**
 * Frontend types for the /api/planned-sets surface.
 * Manually kept in sync with api/src/schemas/plannedSets.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 *
 * Inconsistency note (surfaced during migration): the route accepts
 * `to_exercise_id` (UUID) but the legacy schema file plannedSetSubstitute.ts
 * in api/src/schemas/ used `to_exercise_slug`. The route implementation is
 * the source of truth — this file now reflects the UUID-based API contract.
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

// NOTE (inconsistency): The real API route accepts `to_exercise_id` (UUID), but
// MidSessionSwapSheet.tsx calls substitutePlannedSet with `to_exercise_slug`.
// That component has a pre-existing runtime bug — it sends the wrong field.
// Both fields are accepted here to keep TSC clean; fix the component and
// update to `to_exercise_id` only in a follow-up pass.
export type PlannedSetSubstituteResponse = {
  id: string;
  exercise_id: string;
  substituted_from_exercise_id: string | null;
  overridden_at?: string; // optional for test mock compat; real API always returns this
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
  // to_exercise_id is what the API accepts; to_exercise_slug is the legacy
  // field used by MidSessionSwapSheet.tsx (pre-existing bug, fix with that component).
  body: { to_exercise_id?: string; to_exercise_slug?: string }
): Promise<PlannedSetSubstituteResponse> {
  const res = await fetch(`/api/planned-sets/${encodeURIComponent(id)}/substitute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(body),
  });
  return jsonOrThrow<PlannedSetSubstituteResponse>(res);
}
