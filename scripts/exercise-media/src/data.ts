import { exercises } from '../../../api/src/seed/exercises.js';
import { exerciseGuides } from '../../../api/src/seed/exerciseGuides.js';

export type ExerciseInfo = {
  slug: string;
  name: string;
  equipment: string[]; // humanized, e.g. "adjustable bench"
  setupCallout: string;
};

/** One entry per exercise guide (the guide list is the canonical 44). */
export function listExerciseInfo(): ExerciseInfo[] {
  const bySlug = new Map(exercises.map((e) => [e.slug, e]));
  return exerciseGuides.map((g) => {
    const ex = bySlug.get(g.exercise_slug);
    if (!ex) throw new Error(`guide has no matching exercise: ${g.exercise_slug}`);
    const equipment = (ex.required_equipment?.requires ?? []).map((r: { type: string }) =>
      r.type.replace(/_/g, ' '),
    );
    return { slug: g.exercise_slug, name: ex.name, equipment, setupCallout: g.setup_callout };
  });
}
