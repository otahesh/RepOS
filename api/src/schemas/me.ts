import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET /api/me — response
// CF-Access-derived identity; gated by requireCfAccess.
// ---------------------------------------------------------------------------

export const MeResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().nullable(),
  timezone: z.string(),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
