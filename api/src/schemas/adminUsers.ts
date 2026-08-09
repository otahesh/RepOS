import { z } from 'zod';

export const InviteRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(['member', 'admin']).default('member'),
  })
  .strict();
export type InviteRequest = z.infer<typeof InviteRequestSchema>;

/**
 * Q28 — the transition matrix is CLOSED, and **the service owns it, not the
 * schema.** The enum below deliberately accepts all four lifecycle statuses so
 * that `-> invited` and `-> deleting` reach `patchUser` and are refused there
 * with **409 `invalid_transition`**. Narrowing the enum to
 * `['active','suspended']` would reject them at parse time with a 400, which
 * contradicts Q28's contract that *every* rejected transition returns 409
 * (spec line 247) and makes a forbidden transition indistinguishable from a
 * malformed body.
 */
export const UserPatchSchema = z
  .object({
    role: z.enum(['member', 'admin']).optional(),
    status: z.enum(['active', 'suspended', 'invited', 'deleting']).optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'at least one of role or status must be present',
  });
export type UserPatch = z.infer<typeof UserPatchSchema>;
