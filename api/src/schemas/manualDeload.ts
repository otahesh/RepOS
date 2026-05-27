// api/src/schemas/manualDeload.ts
import { z } from 'zod';

export const ManualDeloadResponseSchema = z.object({
  run_id: z.string().uuid(),
  affected_week_idxs: z.array(z.number().int()),
  affected_day_workouts: z.number().int(),
  affected_planned_sets: z.number().int(),
  removed_planned_sets: z.number().int(),
  triggered_at: z.string(),
});
export type ManualDeloadResponse = z.infer<typeof ManualDeloadResponseSchema>;

export const ManualDeloadUndoResponseSchema = z.object({
  run_id: z.string().uuid(),
  reversed_at: z.string(),
});
export type ManualDeloadUndoResponse = z.infer<typeof ManualDeloadUndoResponseSchema>;
