import type { ProgramTrack } from '../programTracks';

export type ProgramTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  weeks: number;
  days_per_week: number;
  track: ProgramTrack;
  version: number;
  structure?: ProgramTemplateStructure;
};

export type ProgramTemplateStructure = {
  _v: 1;
  days: Array<{
    idx: number;
    day_offset: number;
    kind: 'strength' | 'cardio' | 'hybrid';
    name: string;
    blocks: Array<{
      exercise_slug: string;
      mev: number;
      mav: number;
      /** Exactly one measurement dimension per block (reps pair XOR duration pair). */
      target_reps_low?: number | null;
      target_reps_high?: number | null;
      target_duration_low_sec?: number | null;
      target_duration_high_sec?: number | null;
      target_rir: number;
      rest_sec: number;
      cardio?: { target_duration_sec?: number; target_distance_m?: number; target_zone?: number };
    }>;
  }>;
};

import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export { ApiError } from './_http';

export type UserProgramRecord = {
  id: string;
  user_id: string;
  template_id: string | null;
  /** Slug of the originating template — included so the fork-wizard "Restart"
   *  action can navigate to /programs/:slug without a second round-trip.
   *  Null for programs forked from a template that has since been archived. */
  template_slug: string | null;
  /** Source template's experience track — beginner programs render
   *  plain-language effort cues + definitive set counts. */
  track?: ProgramTrack | null;
  template_version: number | null;
  name: string;
  customizations: Record<string, unknown>;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'abandoned' | 'archived';
  created_at: string;
  updated_at: string;
  /** true when the program has an active/paused mesocycle run; present on list responses. */
  has_live_run?: boolean;
};

export async function listProgramTemplates(track?: ProgramTrack): Promise<ProgramTemplate[]> {
  const qs = track ? `?track=${encodeURIComponent(track)}` : '';
  const res = await apiFetch(`/api/program-templates${qs}`, {});
  // API wraps the list in { templates: [...] } — the detail and fork
  // endpoints return bare bodies, but list endpoints leave room for pagination.
  const body = await jsonOrThrow<{ templates: ProgramTemplate[] }>(res);
  return body.templates;
}

/** Templates state their equipment floor as a trailing "Equipment minimum: X."
 *  sentence (see api/src/seed/programTemplates.ts) — pull it out so the
 *  catalog can show it as a scannable line instead of the full paragraph. */
export function extractEquipment(description: string): string | null {
  const m = description.match(/Equipment minimum:\s*([^.]+)\.?/i);
  return m ? m[1].trim() : null;
}

export async function getProgramTemplate(slug: string): Promise<ProgramTemplate> {
  const res = await apiFetch(`/api/program-templates/${encodeURIComponent(slug)}`, {});
  return jsonOrThrow<ProgramTemplate>(res);
}

export async function forkProgramTemplate(
  slug: string,
  body: { name: string },
): Promise<UserProgramRecord> {
  const res = await apiFetch(`/api/program-templates/${encodeURIComponent(slug)}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<UserProgramRecord>(res);
}
