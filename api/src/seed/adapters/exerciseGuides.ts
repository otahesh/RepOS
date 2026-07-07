import { z } from 'zod';
import { ExerciseGuideSeedSchema, type ExerciseGuideSeed } from '../../schemas/exerciseGuide.js';
import type { SeedAdapter } from '../runSeed.js';

// seedKey is parameterized (like makeExerciseSeedAdapter('exercises')) so tests
// can seed under a vitest-scoped key: upsertOne stamps rows with it and
// archiveMissing receives the same key from runSeed — a hardcoded literal here
// would desync the two under any non-production key, and pointing tests at the
// REAL key would archive the CI-seeded 44 guides mid-suite. Don't "simplify".
export function makeExerciseGuideAdapter(
  knownExerciseSlugs: Set<string>,
  seedKey = 'exercise_guides',
): SeedAdapter<ExerciseGuideSeed> {
  const ArraySchema = z.array(ExerciseGuideSeedSchema).superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((g, i) => {
      if (seen.has(g.exercise_slug)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate exercise_slug: ${g.exercise_slug}`,
          path: [i, 'exercise_slug'],
        });
      }
      seen.add(g.exercise_slug);
      if (!knownExerciseSlugs.has(g.exercise_slug)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown exercise_slug: ${g.exercise_slug}`,
          path: [i, 'exercise_slug'],
        });
      }
    });
  });

  return {
    validate: (entries) => ArraySchema.safeParse(entries),

    upsertOne: async (tx, g, generation) => {
      const { rowCount } = await tx.query(
        `INSERT INTO exercise_guides (
           exercise_id, setup_callout, setup_facts, cues, donts, media,
           seed_key, seed_generation, archived_at, updated_at
         )
         SELECT e.id, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8, NULL, now()
         FROM exercises e WHERE e.slug=$1 AND e.archived_at IS NULL
         ON CONFLICT (exercise_id) DO UPDATE SET
           setup_callout=EXCLUDED.setup_callout,
           setup_facts=EXCLUDED.setup_facts,
           cues=EXCLUDED.cues,
           donts=EXCLUDED.donts,
           media=EXCLUDED.media,
           seed_key=EXCLUDED.seed_key,
           seed_generation=EXCLUDED.seed_generation,
           archived_at=NULL,
           updated_at=now()`,
        [
          g.exercise_slug,
          g.setup_callout,
          JSON.stringify(g.setup_facts ?? {}),
          g.cues,
          g.donts,
          JSON.stringify(g.media ?? {}),
          seedKey,
          generation,
        ],
      );
      // validate() already vetted the slug against the seed list; a zero-row
      // insert means the DB disagrees with the seed (archived/renamed row) —
      // fail the transaction loudly rather than silently skipping content.
      if (rowCount === 0) {
        throw new Error(`exercise_guides seed: no active exercise for slug ${g.exercise_slug}`);
      }
    },

    archiveMissing: async (tx, key, generation) => {
      const { rowCount } = await tx.query(
        `UPDATE exercise_guides SET archived_at=now(), updated_at=now()
         WHERE archived_at IS NULL AND seed_key=$1
           AND seed_generation IS NOT NULL AND seed_generation < $2`,
        [key, generation],
      );
      return rowCount ?? 0;
    },
  };
}
