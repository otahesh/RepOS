import { z } from 'zod';
import { INJURY_JOINTS } from './userInjuries.js';

// ---------------------------------------------------------------------------
// Shared exercise shape
// ---------------------------------------------------------------------------

// required_equipment is stored as JSONB. Schema matches the EquipmentProfileSchema
// predicate structure loosely to avoid coupling tightly to the runtime registry.
const RequiredEquipmentSchema = z
  .object({
    _v: z.number().int(),
    requires: z.array(z.unknown()),
  })
  .passthrough();

export const ExerciseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  movement_pattern: z.string(),
  peak_tension_length: z.string(),
  primary_muscle: z.string(), // muscle slug
  primary_muscle_name: z.string(),
  skill_complexity: z.number(),
  loading_demand: z.number(),
  systemic_fatigue: z.number(),
  required_equipment: RequiredEquipmentSchema,
  muscle_contributions: z.record(z.string(), z.number()),
});

export type Exercise = z.infer<typeof ExerciseSchema>;

// ---------------------------------------------------------------------------
// GET /api/exercises — response
// ---------------------------------------------------------------------------

export const ExerciseListResponseSchema = z.object({
  exercises: z.array(ExerciseSchema),
});

export type ExerciseListResponse = z.infer<typeof ExerciseListResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/exercises/:slug — response
// Uses SELECT e.* so it returns all columns including those not in the list
// endpoint. We use passthrough() to permit extra columns without failing.
// ---------------------------------------------------------------------------

export const ExerciseDetailResponseSchema = ExerciseSchema.passthrough();
export type ExerciseDetailResponse = z.infer<typeof ExerciseDetailResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/exercises/:slug/substitutions — response
// ---------------------------------------------------------------------------

// Beta W3.2 — `injury_advisory` is set by the injuryRanker (Task 14) when the
// candidate's `joint_stress_profile` overlaps a user's recorded injury at
// mod or high stress. The frontend (Task 18) renders the
// `injuryAdvisoryCopy` line under demoted candidates. Optional: callers
// without a userId, or candidates whose joints don't intersect any active
// injury, simply omit the field.
const SubstitutionCandidateSchema = z.object({
  slug: z.string(),
  name: z.string(),
  score: z.number(),
  reason: z.string(),
  injury_advisory: z
    .object({
      joint: z.enum(INJURY_JOINTS),
      level: z.enum(['mod', 'high']),
    })
    .optional(),
});

const ClosestPartialSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export const SubstitutionResponseSchema = z.object({
  from: z.object({ slug: z.string(), name: z.string() }),
  subs: z.array(SubstitutionCandidateSchema),
  truncated: z.boolean(),
  total_matches: z.number().int().optional(),
  reason: z.enum(['no_equipment_profile', 'no_equipment_match']).optional(),
  closest_partial: ClosestPartialSchema.optional(),
});

export type SubstitutionResponse = z.infer<typeof SubstitutionResponseSchema>;
