/**
 * Frontend types for the /api/user/injuries surface (Beta W3.4).
 * Manually kept in sync with api/src/schemas/userInjuries.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */
import { apiFetch } from '../../auth';
import { ApiError, jsonOrThrow } from './_http';

export type InjuryJoint =
  | 'shoulder_left'
  | 'shoulder_right'
  | 'low_back'
  | 'knee_left'
  | 'knee_right'
  | 'elbow'
  | 'wrist';

export type InjurySeverity = 'low' | 'mod' | 'high';

export type UserInjury = {
  joint: InjuryJoint;
  severity: InjurySeverity;
  notes: string;
  onset_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listInjuries(): Promise<UserInjury[]> {
  const body = await jsonOrThrow<{ injuries: UserInjury[] }>(await apiFetch('/api/user/injuries'));
  return body.injuries;
}

export async function upsertInjury(payload: {
  joint: InjuryJoint;
  severity?: InjurySeverity;
  notes?: string;
  onset_at?: string | null;
}): Promise<UserInjury> {
  const body = await jsonOrThrow<{ injury: UserInjury }>(
    await apiFetch('/api/user/injuries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
  return body.injury;
}

export async function patchInjury(
  joint: InjuryJoint,
  patch: {
    severity?: InjurySeverity;
    notes?: string;
    onset_at?: string | null;
  },
): Promise<UserInjury> {
  const body = await jsonOrThrow<{ injury: UserInjury }>(
    await apiFetch(`/api/user/injuries/${joint}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  );
  return body.injury;
}

export async function deleteInjury(joint: InjuryJoint): Promise<void> {
  const res = await apiFetch(`/api/user/injuries/${joint}`, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, undefined, await res.text());
}
