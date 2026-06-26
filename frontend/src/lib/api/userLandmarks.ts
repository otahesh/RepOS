import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export type Landmarks = Record<string, { mev: number; mav: number; mrv: number; mv?: number }>;
export type InjuryConstraint = { joint: string; level: 'low' | 'mod' | 'high' };

export type LandmarksGetResponse = {
  landmarks: Landmarks;
  par_q_advisory_active: boolean;
  injury_constraints: Record<string, InjuryConstraint>;
};

export async function getLandmarks(): Promise<LandmarksGetResponse> {
  return jsonOrThrow<LandmarksGetResponse>(await apiFetch('/api/users/me/landmarks'));
}

// [C-LANDMARKS-CLINICAL-FLOORS] PATCH surfaces per-row fieldErrors. The editor
// reads `fieldErrors` from the thrown error and renders per-row error chips.
// (Kept as a bespoke error shape — not jsonOrThrow's ApiError — so the editor's
// existing `err.fieldErrors` contract is preserved; apiFetch still gives the
// CF-Access 401 redirect.)
export type LandmarksPatchError = { fieldErrors: Record<string, string> };
export async function patchLandmarks(overrides: Landmarks): Promise<LandmarksGetResponse> {
  const r = await apiFetch('/api/users/me/landmarks', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ overrides }),
  });
  if (!r.ok) {
    let detail: LandmarksPatchError | { detail: string } = { detail: '' };
    try {
      detail = await r.json();
    } catch {
      /* keep empty */
    }
    const err = new Error(`patchLandmarks: ${r.status} ${JSON.stringify(detail)}`) as Error & {
      fieldErrors?: Record<string, string>;
    };
    if ('fieldErrors' in detail) err.fieldErrors = (detail as LandmarksPatchError).fieldErrors;
    throw err;
  }
  return r.json();
}
