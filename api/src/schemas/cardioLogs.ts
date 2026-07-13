import { z } from 'zod';
import { performedAtRefine } from './setLogs.js';

// ---------------------------------------------------------------------------
// cardio_logs request/response schemas (measurement model phase 2).
// Session/block grain: one row completes one planned_cardio_block. Mirrors
// setLogs' conventions — optional-absent write fields (never nullable on the
// wire), performed_at bounded by the same skew/backfill refine, DB column
// names aliased to simple API names in SELECT projections.
// ---------------------------------------------------------------------------

export const CardioLogPostSchema = z.object({
  client_request_id: z.string().uuid(),
  planned_cardio_block_id: z.string().uuid(),
  duration_sec: z.number().int().min(1).max(86400),
  distance_m: z.number().int().min(1).max(1_000_000).optional(),
  avg_hr: z.number().int().min(30).max(250).optional(),
  max_hr: z.number().int().min(30).max(250).optional(),
  energy_kcal: z.number().int().min(1).max(10000).optional(),
  // Session RPE (Foster sRPE) — the one effort signal cardio collects.
  srpe: z.number().int().min(1).max(10).optional(),
  performed_at: z.string().datetime({ offset: true }).refine(performedAtRefine, {
    message: 'performed_at must be within the last 365 days and not >5 minutes in the future',
  }),
  notes: z.string().max(500).optional(),
});
export type CardioLogPost = z.infer<typeof CardioLogPostSchema>;

export const CardioLogPatchSchema = z
  .object({
    duration_sec: z.number().int().min(1).max(86400).optional(),
    distance_m: z.number().int().min(1).max(1_000_000).optional(),
    avg_hr: z.number().int().min(30).max(250).optional(),
    max_hr: z.number().int().min(30).max(250).optional(),
    energy_kcal: z.number().int().min(1).max(10000).optional(),
    srpe: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field required',
  });
export type CardioLogPatch = z.infer<typeof CardioLogPatchSchema>;

export const CardioLogListQuerySchema = z.object({
  planned_cardio_block_id: z.string().uuid(),
});
export type CardioLogListQuery = z.infer<typeof CardioLogListQuerySchema>;

export { UuidParamSchema as IdParamSchema } from './idParams.js';

export interface CardioLogRow {
  id: string;
  user_id: string;
  exercise_id: string;
  planned_cardio_block_id: string;
  client_request_id: string;
  duration_sec: number;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  energy_kcal: number | null;
  srpe: number | null;
  source: 'manual' | 'apple_health';
  performed_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
