// frontend/src/lib/api/parQ.ts
// W2.3 — PAR-Q client wrappers. apiFetch handles same-origin cookie creds +
// CF Access 401 redirects.
import { apiFetch } from '../../auth';

export type ParQ5Joint =
  | 'shoulder_left'
  | 'shoulder_right'
  | 'low_back'
  | 'knee_left'
  | 'knee_right'
  | 'elbow'
  | 'wrist'
  | 'other';

export interface ParQStatus {
  current_version: number;
  acknowledged_version: number;
  needs_prompt: boolean;
  questions: string[];
  advisory_active: boolean;
}

export interface ParQAcceptResult {
  any_yes: boolean;
  advisory_active: boolean;
  injuries_created: number;
}

export async function getParQStatus(): Promise<ParQStatus> {
  const res = await apiFetch('/api/me/par-q');
  if (!res.ok) throw new Error('par_q_status_failed');
  return res.json();
}

export async function acceptParQ(
  version: number,
  answers: boolean[],
  q5_joints: ParQ5Joint[],
): Promise<ParQAcceptResult> {
  const res = await apiFetch('/api/me/par-q', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version, answers, q5_joints }),
  });
  if (!res.ok) throw new Error(`par_q_accept_failed_${res.status}`);
  return res.json();
}

export async function markPARQCleared(): Promise<{ advisory_active: false }> {
  const res = await apiFetch('/api/me/par-q/mark-cleared', { method: 'POST' });
  if (!res.ok) throw new Error('par_q_mark_cleared_failed');
  return res.json();
}
