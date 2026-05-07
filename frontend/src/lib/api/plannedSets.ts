import { jsonOrThrow } from './_http';

export { ApiError } from './_http';

export type PlannedSetPatch = Partial<{
  target_reps_low: number;
  target_reps_high: number;
  target_rir: number;
  rest_sec: number;
  override_reason: string;
}>;

export async function patchPlannedSet(id: string, patch: PlannedSetPatch) {
  const res = await fetch(`/api/planned-sets/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(patch),
  });
  return jsonOrThrow<{ id: string; overridden_at: string; override_reason?: string }>(res);
}

export async function substitutePlannedSet(id: string, body: { to_exercise_slug: string; reason?: string }) {
  const res = await fetch(`/api/planned-sets/${encodeURIComponent(id)}/substitute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(body),
  });
  return jsonOrThrow<{ id: string; exercise_id: string; substituted_from_exercise_id: string }>(res);
}
