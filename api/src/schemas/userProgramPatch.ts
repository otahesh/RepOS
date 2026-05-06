// api/src/schemas/userProgramPatch.ts
import { z } from 'zod';

// Per §3.4 PATCH /api/user-programs/:id — discriminated union of customize ops
// that mutate user_programs.customizations and (in the materializer) the
// effective structure. Per Q8, customization is per-day, not per-set numeric.
const SLUG_RE = /^[a-z0-9-]+$/;

export const UserProgramPatchSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('rename'),
    name: z.string().min(1).max(100),
  }),
  z.object({
    op: z.literal('swap_exercise'),
    day_idx: z.number().int().min(0).max(6),
    block_idx: z.number().int().min(0).max(20),
    to_exercise_slug: z.string().regex(SLUG_RE),
  }),
  z.object({
    op: z.literal('add_set'),
    day_idx: z.number().int().min(0).max(6),
    block_idx: z.number().int().min(0).max(20),
  }),
  z.object({
    op: z.literal('remove_set'),
    day_idx: z.number().int().min(0).max(6),
    block_idx: z.number().int().min(0).max(20),
  }),
  z.object({
    op: z.literal('change_rir'),
    week_idx: z.number().int().min(1).max(16),
    day_idx: z.number().int().min(0).max(6),
    block_idx: z.number().int().min(0).max(20),
    target_rir: z.number().int().min(1).max(5),    // RIR 0 banned (Q4)
  }),
  z.object({
    op: z.literal('shift_weekday'),
    day_idx: z.number().int().min(0).max(6),
    to_day_offset: z.number().int().min(0).max(6),
  }),
  z.object({
    op: z.literal('skip_day'),
    week_idx: z.number().int().min(1).max(16),
    day_idx: z.number().int().min(0).max(6),
  }),
  z.object({
    op: z.literal('trim_week'),
    drop_last_n: z.number().int().min(1).max(15),
  }),
]);

export type UserProgramPatchInput = z.infer<typeof UserProgramPatchSchema>;
