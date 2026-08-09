import { exercises } from '../../../api/src/seed/exercises.js';
import { exerciseGuides } from '../../../api/src/seed/exerciseGuides.js';

export type ExerciseInfo = {
  slug: string;
  name: string;
  equipment: string[]; // humanized, e.g. "adjustable bench"
  setupCallout: string;
};

/**
 * One entry per photo-eligible exercise guide. Gait/cardio exercises
 * (movement_pattern 'gait': walking, recumbent bike) are excluded by product
 * decision (2026-07-07) — no start/end photos for steady-state cardio.
 */
export function listExerciseInfo(): ExerciseInfo[] {
  const bySlug = new Map(exercises.map((e) => [e.slug, e]));
  return exerciseGuides.flatMap((g) => {
    const ex = bySlug.get(g.exercise_slug);
    if (!ex) throw new Error(`guide has no matching exercise: ${g.exercise_slug}`);
    if (ex.movement_pattern === 'gait') return [];
    const equipment = (ex.required_equipment?.requires ?? []).map((r: { type: string }) =>
      r.type.replace(/_/g, ' '),
    );
    return [{ slug: g.exercise_slug, name: ex.name, equipment, setupCallout: g.setup_callout }];
  });
}
