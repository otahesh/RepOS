/**
 * Frontend types for the /api/exercises surface.
 * Manually kept in sync with api/src/schemas/exercises.ts.
 * See api/src/schemas/README.md for the cross-package type mirror strategy.
 */
import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

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
  const body = await jsonOrThrow<{ exercises: Exercise[] }>(await apiFetch('/api/exercises'));
  return body.exercises;
}

/**
 * Beta W3.2 — `injury_advisory` is set by the server-side injuryRanker when
 * the candidate's `joint_stress_profile` overlaps a user's recorded injury at
 * mod or high stress. The MidSessionSwapPicker (Task 18) renders this as
 * "Moderate knee load — you noted left knee" via `injuryAdvisoryCopy()`.
 */
export type SubstitutionCandidate = {
  id: string;
  slug: string;
  name: string;
  score: number;
  reason: string;
  injury_advisory?: {
    joint:
      | 'shoulder_left'
      | 'shoulder_right'
      | 'low_back'
      | 'knee_left'
      | 'knee_right'
      | 'elbow'
      | 'wrist';
    level: 'mod' | 'high';
  };
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
  return jsonOrThrow<SubResult>(await apiFetch(`/api/exercises/${slug}/substitutions`));
}
