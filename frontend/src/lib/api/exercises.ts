/**
 * Frontend types for the /api/exercises surface.
 * Manually kept in sync with api/src/schemas/exercises.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */

export type Exercise = {
  id: string;
  slug: string;
  name: string;
  primary_muscle: string;
  primary_muscle_name: string;
  movement_pattern: string;
  peak_tension_length: string;
  skill_complexity: number;
  loading_demand: number;
  systemic_fatigue: number;
  required_equipment: { _v: number; requires: unknown[] };
  muscle_contributions: Record<string, number>;
};

export async function listExercises(): Promise<Exercise[]> {
  const r = await fetch('/api/exercises', { credentials: 'include' });
  if (!r.ok) throw new Error(`listExercises: ${r.status}`);
  const body = await r.json();
  return body.exercises;
}

export type SubstitutionCandidate = {
  slug: string;
  name: string;
  score: number;
  reason: string;
};

export type SubResult = {
  from: { slug: string; name: string };
  subs: SubstitutionCandidate[];
  truncated: boolean;
  total_matches?: number;
  reason?: 'no_equipment_profile' | 'no_equipment_match';
  closest_partial?: { slug: string; name: string };
};

export async function getSubstitutions(slug: string): Promise<SubResult> {
  const r = await fetch(`/api/exercises/${slug}/substitutions`, { credentials: 'include' });
  if (!r.ok) throw new Error(`getSubstitutions: ${r.status}`);
  return r.json();
}
