import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET /api/muscles — response
// ---------------------------------------------------------------------------

export const MuscleSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  group_name: z.string(),
  display_order: z.number().int().min(0),
});

export type Muscle = z.infer<typeof MuscleSchema>;

export const MuscleListResponseSchema = z.object({
  muscles: z.array(MuscleSchema),
});

export type MuscleListResponse = z.infer<typeof MuscleListResponseSchema>;
