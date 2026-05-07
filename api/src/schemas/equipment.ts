import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET /api/equipment/profile — response
// PUT /api/equipment/profile — request body + response
// POST /api/equipment/profile/preset/:name — response
//
// The full profile schema lives in equipmentProfile.ts. This file defines
// the *response* schemas for the equipment routes (which return the stored
// profile object after any write).
// ---------------------------------------------------------------------------

// The equipment profile response is the stored JSONB object. It can be
// an empty `{ _v: 1 }` or a full profile. We use a loose schema here
// to avoid duplicating the EquipmentProfileSchema validator — the request
// validation already uses it; responses should accept anything the DB returns.
export const EquipmentProfileResponseSchema = z.object({
  _v: z.literal(1),
}).passthrough();

export type EquipmentProfileResponse = z.infer<typeof EquipmentProfileResponseSchema>;
