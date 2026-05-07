import { z } from 'zod';

// ---------------------------------------------------------------------------
// PATCH /api/planned-sets/:id — request body
// Mirrors the inline PatchSchema in routes/plannedSets.ts.
// The route-local schema has slightly looser limits on some fields
// (target_rir up to 10, rest_sec up to 900) — we match those here.
// ---------------------------------------------------------------------------

export const PlannedSetPatchRequestSchema = z.object({
  target_reps_low: z.number().int().min(1).max(50).optional(),
  target_reps_high: z.number().int().min(1).max(50).optional(),
  target_rir: z.number().int().min(1).max(10).optional(),
  target_load_hint: z.string().max(200).optional().nullable(),
  rest_sec: z.number().int().min(0).max(900).optional(),
  override_reason: z.string().max(200).nullable().optional(),
}).refine(
  (b) => b.target_reps_low == null || b.target_reps_high == null || b.target_reps_low <= b.target_reps_high,
  { message: 'target_reps_low must be <= target_reps_high' },
).refine(
  (b) => Object.keys(b).length > 0,
  { message: 'patch body cannot be empty' },
);

export type PlannedSetPatchRequest = z.infer<typeof PlannedSetPatchRequestSchema>;

// PATCH /api/planned-sets/:id — response body (updated row)
export const PlannedSetPatchResponseSchema = z.object({
  id: z.string().uuid(),
  day_workout_id: z.string().uuid(),
  block_idx: z.number().int().min(0),
  set_idx: z.number().int().min(0),
  exercise_id: z.string().uuid(),
  target_reps_low: z.number().int(),
  target_reps_high: z.number().int(),
  target_rir: z.number().int(),
  target_load_hint: z.string().nullable(),
  rest_sec: z.number().int(),
  overridden_at: z.string().nullable(),
  override_reason: z.string().nullable(),
  substituted_from_exercise_id: z.string().uuid().nullable(),
});

export type PlannedSetPatchResponse = z.infer<typeof PlannedSetPatchResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/planned-sets/:id/substitute — request body
// The route uses to_exercise_id (UUID), not to_exercise_slug.
// Note: the schema file plannedSetSubstitute.ts uses slug — but the actual
// route uses UUID. This schema reflects the route implementation.
// ---------------------------------------------------------------------------

export const PlannedSetSubstituteRequestSchema = z.object({
  to_exercise_id: z.string().uuid(),
});

export type PlannedSetSubstituteRequest = z.infer<typeof PlannedSetSubstituteRequestSchema>;

// POST /api/planned-sets/:id/substitute — response body
export const PlannedSetSubstituteResponseSchema = z.object({
  id: z.string().uuid(),
  exercise_id: z.string().uuid(),
  substituted_from_exercise_id: z.string().uuid().nullable(),
  overridden_at: z.string(),
});

export type PlannedSetSubstituteResponse = z.infer<typeof PlannedSetSubstituteResponseSchema>;
