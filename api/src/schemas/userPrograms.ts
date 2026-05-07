import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared — UserProgram record shape returned by most endpoints
// ---------------------------------------------------------------------------

export const USER_PROGRAM_STATUSES = [
  'draft', 'active', 'paused', 'completed', 'abandoned', 'archived',
] as const;
export type UserProgramStatus = (typeof USER_PROGRAM_STATUSES)[number];

export const UserProgramRecordSchema = z.object({
  id: z.string().uuid(),
  template_id: z.string().uuid().nullable(),
  template_version: z.number().int().nullable(),
  name: z.string(),
  customizations: z.record(z.string(), z.unknown()),
  status: z.enum(USER_PROGRAM_STATUSES),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserProgramRecord = z.infer<typeof UserProgramRecordSchema>;

// ---------------------------------------------------------------------------
// GET /api/user-programs — query string + response
// ---------------------------------------------------------------------------

export const UserProgramListQuerySchema = z.object({
  include: z.enum(['past']).optional(),
});

export type UserProgramListQuery = z.infer<typeof UserProgramListQuerySchema>;

export const UserProgramListResponseSchema = z.object({
  programs: z.array(UserProgramRecordSchema),
});

export type UserProgramListResponse = z.infer<typeof UserProgramListResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/user-programs/:id — response (resolved with customizations)
// ---------------------------------------------------------------------------

// Effective structure mirrors the template structure with overlays applied.
// These types are intentionally looser than the full ProgramTemplateSchema
// because the resolver stamps additional fields (set_count_delta,
// target_rir_override) onto blocks at runtime.
const EffectiveBlockSchema = z.object({
  exercise_slug: z.string(),
  mev: z.number().int().min(0).optional(),
  mav: z.number().int().min(0).optional(),
  target_reps_low: z.number().int().min(1).optional(),
  target_reps_high: z.number().int().min(1).optional(),
  target_rir: z.number().int().min(1).optional(),
  rest_sec: z.number().int().min(0).optional(),
  set_count_delta: z.number().int().optional(),
  target_rir_override: z.number().int().min(1).optional(),
  cardio: z.object({
    target_duration_sec: z.number().int().optional(),
    target_distance_m: z.number().int().optional(),
    target_zone: z.number().int().min(1).max(5).optional(),
  }).optional(),
}).passthrough();

const EffectiveDaySchema = z.object({
  idx: z.number().int().min(0),
  day_offset: z.number().int().min(0).max(6),
  kind: z.enum(['strength', 'cardio', 'hybrid']),
  name: z.string(),
  blocks: z.array(EffectiveBlockSchema),
});

const EffectiveStructureSchema = z.object({
  _v: z.literal(1),
  days: z.array(EffectiveDaySchema),
});

export const UserProgramDetailResponseSchema = UserProgramRecordSchema.extend({
  effective_name: z.string(),
  effective_structure: EffectiveStructureSchema,
  latest_run_id: z.string().uuid().optional(),
});

export type UserProgramDetailResponse = z.infer<typeof UserProgramDetailResponseSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/user-programs/:id — re-exports from userProgramPatch.ts
// Response: updated UserProgramRecord
// The patch schema itself lives in api/src/schemas/userProgramPatch.ts
// ---------------------------------------------------------------------------

// PATCH response is the same UserProgramRecordSchema (updated row).
export const UserProgramPatchResponseSchema = UserProgramRecordSchema;
export type UserProgramPatchResponse = UserProgramRecord;

// ---------------------------------------------------------------------------
// GET /api/user-programs/:id/warnings — response
// ---------------------------------------------------------------------------

export const ScheduleWarningSchema = z.object({
  code: z.enum([
    'too_many_days_per_week',
    'consecutive_same_pattern',
    'cardio_interval_too_close',
    'hiit_day_before_heavy_lower',
  ]),
  severity: z.enum(['warn', 'block']),
  message: z.string(),
  day_idx: z.number().int().min(0).optional(),
});

export type ScheduleWarning = z.infer<typeof ScheduleWarningSchema>;

export const UserProgramWarningsResponseSchema = z.object({
  warnings: z.array(ScheduleWarningSchema),
});

export type UserProgramWarningsResponse = z.infer<typeof UserProgramWarningsResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/user-programs/:id/start — request body + response
// ---------------------------------------------------------------------------

export const UserProgramStartRequestSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  start_tz: z.string().min(1).max(64),
});

export type UserProgramStartRequest = z.infer<typeof UserProgramStartRequestSchema>;

export const UserProgramStartResponseSchema = z.object({
  mesocycle_run_id: z.string().uuid(),
  start_date: z.string(), // YYYY-MM-DD
  start_tz: z.string(),
  weeks: z.number().int().min(1),
  status: z.string(),
  current_week: z.number().int().min(1),
});

export type UserProgramStartResponse = z.infer<typeof UserProgramStartResponseSchema>;
