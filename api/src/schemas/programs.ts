import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared program template shapes
// These re-use the structure types from programTemplate.ts but define the
// *response* shapes returned by the REST routes (includes id, slug, version,
// created_at that the seed schema doesn't produce).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/program-templates — response (list, no structure field)
// ---------------------------------------------------------------------------

export const ProgramTemplateSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  weeks: z.number().int().min(1),
  days_per_week: z.number().int().min(1).max(7),
  version: z.number().int().min(1),
  created_at: z.string(),
});

export type ProgramTemplateSummary = z.infer<typeof ProgramTemplateSummarySchema>;

export const ProgramTemplateListResponseSchema = z.object({
  templates: z.array(ProgramTemplateSummarySchema),
});

export type ProgramTemplateListResponse = z.infer<typeof ProgramTemplateListResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/program-templates/:slug — response (includes structure + seed fields)
// ---------------------------------------------------------------------------

// Structure is stored/returned as arbitrary JSONB. We define a loose schema
// that accepts the known shape without being fragile to new optional fields.
const BlockSchema = z.object({
  exercise_slug: z.string(),
  mev: z.number().int().min(0).optional(),
  mav: z.number().int().min(0).optional(),
  target_reps_low: z.number().int().min(1).optional(),
  target_reps_high: z.number().int().min(1).optional(),
  target_rir: z.number().int().min(1).optional(),
  rest_sec: z.number().int().min(0).optional(),
  cardio: z.object({
    target_duration_sec: z.number().int().optional(),
    target_distance_m: z.number().int().optional(),
    target_zone: z.number().int().min(1).max(5).optional(),
  }).optional(),
}).passthrough();

const DayDefSchema = z.object({
  idx: z.number().int().min(0),
  day_offset: z.number().int().min(0).max(6),
  kind: z.enum(['strength', 'cardio', 'hybrid']),
  name: z.string(),
  blocks: z.array(BlockSchema),
});

export const ProgramTemplateStructureSchema = z.object({
  _v: z.literal(1),
  days: z.array(DayDefSchema),
});

export const ProgramTemplateDetailResponseSchema = ProgramTemplateSummarySchema.extend({
  structure: ProgramTemplateStructureSchema,
  seed_key: z.string().nullable(),
  seed_generation: z.number().int().nullable(),
});

export type ProgramTemplateDetailResponse = z.infer<typeof ProgramTemplateDetailResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/program-templates/:slug/fork — response (user_program row, 201)
// ---------------------------------------------------------------------------

export const ProgramForkResponseSchema = z.object({
  id: z.string().uuid(),
  template_id: z.string().uuid(),
  template_version: z.number().int().min(1),
  name: z.string(),
  customizations: z.record(z.string(), z.unknown()),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'abandoned', 'archived']),
  created_at: z.string(),
});

export type ProgramForkResponse = z.infer<typeof ProgramForkResponseSchema>;
