/**
 * Frontend types for the /api/user/injuries surface (Beta W3.4).
 * Manually kept in sync with api/src/schemas/userInjuries.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */

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
  const r = await fetch('/api/user/injuries', { method: 'GET', credentials: 'include' });
  if (!r.ok) throw new Error(`listInjuries: ${r.status}`);
  const body = (await r.json()) as { injuries: UserInjury[] };
  return body.injuries;
}

export async function upsertInjury(payload: {
  joint: InjuryJoint;
  severity?: InjurySeverity;
  notes?: string;
  onset_at?: string | null;
}): Promise<UserInjury> {
  const r = await fetch('/api/user/injuries', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`upsertInjury: ${r.status}`);
  const body = (await r.json()) as { injury: UserInjury };
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
  const r = await fetch(`/api/user/injuries/${joint}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`patchInjury: ${r.status}`);
  const body = (await r.json()) as { injury: UserInjury };
  return body.injury;
}

export async function deleteInjury(joint: InjuryJoint): Promise<void> {
  const r = await fetch(`/api/user/injuries/${joint}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!r.ok && r.status !== 204) throw new Error(`deleteInjury: ${r.status}`);
}
