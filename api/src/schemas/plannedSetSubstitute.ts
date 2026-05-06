import { z } from 'zod';

// Per §3.4 POST /api/planned-sets/:id/substitute — accept a
// suggested-substitution from Library v1's findSubstitutions ranker.
// scope defaults to 'today' (Q9: today and future-in-meso are the editable
// horizons; past is read-only history).
export const PlannedSetSubstituteSchema = z.object({
  to_exercise_slug: z.string().regex(/^[a-z0-9-]+$/, 'lowercase-kebab'),
  reason: z.string().min(1).max(200).optional(),
  scope: z.enum(['today','future_in_meso']).default('today'),
});

export type PlannedSetSubstituteInput = z.infer<typeof PlannedSetSubstituteSchema>;
