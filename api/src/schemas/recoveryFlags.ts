import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const KNOWN_FLAGS = ['bodyweight_crash', 'overreaching', 'stalled_pr'] as const;
export type RecoveryFlagKey = (typeof KNOWN_FLAGS)[number];

// ---------------------------------------------------------------------------
// GET /api/recovery-flags — response
// ---------------------------------------------------------------------------

// The flag shape is extensible: bodyweight_crash includes trend_7d_lbs;
// future flags may include other payload fields. We accept passthrough.
export const RecoveryFlagItemSchema = z.object({
  flag: z.enum(KNOWN_FLAGS),
  message: z.string(),
  trend_7d_lbs: z.number().optional(),
}).passthrough();

export type RecoveryFlagItem = z.infer<typeof RecoveryFlagItemSchema>;

export const RecoveryFlagListResponseSchema = z.object({
  flags: z.array(RecoveryFlagItemSchema),
});

export type RecoveryFlagListResponse = z.infer<typeof RecoveryFlagListResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/recovery-flags/dismiss — request body
// ---------------------------------------------------------------------------

export const RecoveryFlagDismissRequestSchema = z.object({
  flag: z.enum(KNOWN_FLAGS),
});

export type RecoveryFlagDismissRequest = z.infer<typeof RecoveryFlagDismissRequestSchema>;

// POST /api/recovery-flags/dismiss — 204 no body; no response schema needed
