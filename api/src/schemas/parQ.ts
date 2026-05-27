// api/src/schemas/parQ.ts
import { z } from 'zod';
import { PAR_Q_QUESTIONS, PAR_Q_VERSION, PAR_Q_Q5_JOINT_OPTIONS } from '../constants/parQ.js';

export const ParQStatusResponseSchema = z.object({
  current_version: z.literal(PAR_Q_VERSION),
  acknowledged_version: z.number().int().min(0),
  needs_prompt: z.boolean(),
  questions: z.array(z.string()),
  advisory_active: z.boolean(),  // mirrors users.par_q_advisory_active
});
export type ParQStatusResponse = z.infer<typeof ParQStatusResponseSchema>;

// Q5 follow-up joints. Required to be present (possibly empty array) when
// answers[PAR_Q_Q5_INDEX] === true. Validated server-side; empty array on
// Q5=yes is allowed (the user may not specify joints) but disallowed when
// Q5=false (mismatch).
export const ParQAcceptRequestSchema = z.object({
  version: z.number().int().min(1),
  answers: z.array(z.boolean()).length(PAR_Q_QUESTIONS.length),
  q5_joints: z.array(z.enum(PAR_Q_Q5_JOINT_OPTIONS)).default([]),
});
export type ParQAcceptRequest = z.infer<typeof ParQAcceptRequestSchema>;

export const ParQAcceptResponseSchema = z.object({
  version: z.number().int().min(1),
  accepted_at: z.string(),  // ISO timestamp
  any_yes: z.boolean(),     // true → frontend shows soft-gate copy
  advisory_active: z.boolean(),  // server's resulting users.par_q_advisory_active
  injuries_created: z.number().int().min(0),  // count of user_injuries rows added from Q5 follow-up
});
export type ParQAcceptResponse = z.infer<typeof ParQAcceptResponseSchema>;

// Settings → Health "Mark cleared" affordance.
export const ParQMarkClearedRequestSchema = z.object({});
export const ParQMarkClearedResponseSchema = z.object({
  advisory_active: z.literal(false),
});
