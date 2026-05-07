export type ProgramTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  weeks: number;
  days_per_week: number;
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
      target_reps_low: number;
      target_reps_high: number;
      target_rir: number;
      rest_sec: number;
      cardio?: { target_duration_sec?: number; target_distance_m?: number; target_zone?: number };
    }>;
  }>;
};

export type UserProgramRecord = {
  id: string;
  user_id: string;
  template_id: string | null;
  template_version: number | null;
  name: string;
  customizations: Record<string, unknown>;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'abandoned' | 'archived';
  created_at: string;
  updated_at: string;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function listProgramTemplates(): Promise<ProgramTemplate[]> {
  const res = await fetch('/api/program-templates', { credentials: 'same-origin' });
  // API wraps the list in { templates: [...] } — the detail and fork
  // endpoints return bare bodies, but list endpoints leave room for pagination.
  const body = await jsonOrThrow<{ templates: ProgramTemplate[] }>(res);
  return body.templates;
}

export async function getProgramTemplate(slug: string): Promise<ProgramTemplate> {
  const res = await fetch(`/api/program-templates/${encodeURIComponent(slug)}`, { credentials: 'same-origin' });
  return jsonOrThrow<ProgramTemplate>(res);
}

export async function forkProgramTemplate(slug: string, body: { name: string }): Promise<UserProgramRecord> {
  const res = await fetch(`/api/program-templates/${encodeURIComponent(slug)}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  return jsonOrThrow<UserProgramRecord>(res);
}
