import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const MESOCYCLE_STATUSES = [
  'draft', 'active', 'paused', 'completed', 'archived', 'abandoned',
] as const;
export type MesocycleRunStatus = (typeof MESOCYCLE_STATUSES)[number];

// ---------------------------------------------------------------------------
// GET /api/mesocycles/today — response body (discriminated union)
// ---------------------------------------------------------------------------

const TodayNoActiveRunSchema = z.object({
  state: z.literal('no_active_run'),
});

const TodayRestSchema = z.object({
  state: z.literal('rest'),
  run_id: z.string().uuid(),
  scheduled_date: z.string(), // YYYY-MM-DD
});

const SuggestedSubstitutionSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

const TodaySetSchema = z.object({
  id: z.string().uuid(),
  block_idx: z.number().int().min(0),
  set_idx: z.number().int().min(0),
  exercise: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  }),
  target_reps_low: z.number().int().min(1),
  target_reps_high: z.number().int().min(1),
  target_rir: z.number().int().min(0),
  rest_sec: z.number().int().min(0),
  suggested_substitution: SuggestedSubstitutionSchema.optional(),
});

const TodayCardioSchema = z.object({
  id: z.string().uuid(),
  block_idx: z.number().int().min(0),
  exercise: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  }),
  target_duration_sec: z.number().int().nullable(),
  target_distance_m: z.number().int().nullable(),
  target_zone: z.number().int().min(1).max(5).nullable(),
});

const TodayDaySchema = z.object({
  id: z.string().uuid(),
  week_idx: z.number().int().min(1),
  day_idx: z.number().int().min(0),
  kind: z.enum(['strength', 'cardio', 'hybrid']),
  name: z.string(),
  scheduled_date: z.string(),
});

const TodayWorkoutSchema = z.object({
  state: z.literal('workout'),
  run_id: z.string().uuid(),
  day: TodayDaySchema,
  sets: z.array(TodaySetSchema),
  cardio: z.array(TodayCardioSchema),
});

export const TodayWorkoutResponseSchema = z.union([
  TodayNoActiveRunSchema,
  TodayRestSchema,
  TodayWorkoutSchema,
]);

export type TodayWorkoutResponse = z.infer<typeof TodayWorkoutResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/mesocycles/:id — response body
// ---------------------------------------------------------------------------

const DayWorkoutSummarySchema = z.object({
  id: z.string().uuid(),
  week_idx: z.number().int().min(1),
  day_idx: z.number().int().min(0),
  scheduled_date: z.string(), // YYYY-MM-DD
  kind: z.string(),
  name: z.string(),
  status: z.string(),
  completed_at: z.string().nullable(),
});

export const MesocycleDetailResponseSchema = z.object({
  id: z.string().uuid(),
  user_program_id: z.string().uuid(),
  user_id: z.string().uuid(),
  start_date: z.string(), // YYYY-MM-DD
  start_tz: z.string(),
  weeks: z.number().int().min(1),
  current_week: z.number().int().min(1),
  status: z.enum(MESOCYCLE_STATUSES),
  finished_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  day_workouts: z.array(DayWorkoutSummarySchema),
});

export type MesocycleDetailResponse = z.infer<typeof MesocycleDetailResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/mesocycles/:id/volume-rollup — response body
// ---------------------------------------------------------------------------

const MuscleVolumeSchema = z.object({
  muscle: z.string(),
  sets: z.number(),
  mev: z.number(),
  mav: z.number(),
  mrv: z.number(),
});

const WeekVolumeSchema = z.object({
  week_idx: z.number().int().min(1),
  muscles: z.array(MuscleVolumeSchema),
  minutes_by_modality: z.record(z.string(), z.number()),
});

export const VolumeRollupResponseSchema = z.object({
  run_id: z.string().uuid(),
  weeks: z.array(WeekVolumeSchema),
});

export type VolumeRollupResponse = z.infer<typeof VolumeRollupResponseSchema>;

// Re-export sub-types for frontend convenience
export type MuscleVolume = z.infer<typeof MuscleVolumeSchema>;
export type WeekVolume = z.infer<typeof WeekVolumeSchema>;

// ---------------------------------------------------------------------------
// POST /api/mesocycles/:id/abandon — response body (200)
// ---------------------------------------------------------------------------

export const MesocycleAbandonResponseSchema = z.object({
  mesocycle_run_id: z.string().uuid(),
  status: z.enum(MESOCYCLE_STATUSES),
  finished_at: z.string(), // ISO-8601 timestamp
});

export type MesocycleAbandonResponse = z.infer<typeof MesocycleAbandonResponseSchema>;
