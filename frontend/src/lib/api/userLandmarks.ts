export type Landmarks = Record<string, { mev: number; mav: number; mrv: number; mv?: number }>;
export type InjuryConstraint = { joint: string; level: 'low' | 'mod' | 'high' };

export type LandmarksGetResponse = {
  landmarks: Landmarks;
  par_q_advisory_active: boolean;
  injury_constraints: Record<string, InjuryConstraint>;
};

export async function getLandmarks(): Promise<LandmarksGetResponse> {
  const r = await fetch('/api/users/me/landmarks', { credentials: 'include' });
  if (!r.ok) throw new Error(`getLandmarks: ${r.status}`);
  return r.json();
}

// [C-LANDMARKS-CLINICAL-FLOORS] PATCH surfaces per-row fieldErrors. The editor
// reads `fieldErrors` from the thrown error and renders per-row error chips.
export type LandmarksPatchError = { fieldErrors: Record<string, string> };
export async function patchLandmarks(overrides: Landmarks): Promise<LandmarksGetResponse> {
  const r = await fetch('/api/users/me/landmarks', {
    method: 'PATCH', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ overrides }),
  });
  if (!r.ok) {
    let detail: LandmarksPatchError | { detail: string } = { detail: '' };
    try { detail = await r.json(); } catch { /* keep empty */ }
    const err = new Error(`patchLandmarks: ${r.status} ${JSON.stringify(detail)}`) as Error & { fieldErrors?: Record<string, string> };
    if ('fieldErrors' in detail) err.fieldErrors = (detail as LandmarksPatchError).fieldErrors;
    throw err;
  }
  return r.json();
}
