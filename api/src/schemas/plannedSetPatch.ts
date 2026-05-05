import { z } from 'zod';

// Per §3.4 PATCH /api/planned-sets/:id — per-day override on a single
// planned_set row. Past-day rows are rejected at the route layer with 409
// (Q9: past sets are read-only history). Empty patch rejected because it
// would record an overridden_at with no actual change.
export const PlannedSetPatchSchema = z.object({
  target_reps_low: z.number().int().min(1).max(50).optional(),
  target_reps_high: z.number().int().min(1).max(50).optional(),
  target_rir: z.number().int().min(1).max(5).optional(),    // RIR 0 banned
  rest_sec: z.number().int().min(15).max(900).optional(),
  target_load_hint: z.string().max(40).optional(),
  override_reason: z.string().min(1).max(200).optional(),
}).refine(
  o => Object.keys(o).length > 0,
  { message: 'patch must contain at least one field' },
).refine(
  o => o.target_reps_low == null
    || o.target_reps_high == null
    || o.target_reps_low <= o.target_reps_high,
  { message: 'target_reps_low must be <= target_reps_high', path: ['target_reps_low'] },
);

export type PlannedSetPatchInput = z.infer<typeof PlannedSetPatchSchema>;
