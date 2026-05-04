export type Exercise = {
  id: string; slug: string; name: string;
  primary_muscle: string; primary_muscle_name: string;
  movement_pattern: string; peak_tension_length: string;
  skill_complexity: number; loading_demand: number; systemic_fatigue: number;
  required_equipment: { _v: 1; requires: { type: string }[] };
  muscle_contributions: Record<string, number>;
};

export async function listExercises(): Promise<Exercise[]> {
  const r = await fetch('/api/exercises', { credentials: 'include' });
  if (!r.ok) throw new Error(`listExercises: ${r.status}`);
  const body = await r.json();
  return body.exercises;
}
