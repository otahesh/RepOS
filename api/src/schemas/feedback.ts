// api/src/schemas/feedback.ts
// Beta W7 — request schema for POST /api/feedback. `.trim()` runs before the
// length checks so a whitespace-only body is rejected and the stored value is
// trimmed. `.strict()` rejects unknown keys (a client cannot smuggle user_id —
// identity is taken from the authenticated request, never the body).
import { z } from 'zod';

export const FeedbackCreateSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    route: z.string().max(512).optional(),
  })
  .strict();
export type FeedbackCreate = z.infer<typeof FeedbackCreateSchema>;
