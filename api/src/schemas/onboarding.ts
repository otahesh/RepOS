// api/src/schemas/onboarding.ts
import { z } from 'zod';

export const OnboardingCompleteRequestSchema = z.object({
  // Goals are pinned to the users.goal CHECK constraint from migration 026.
  // Cardio-capacity (e.g. 'endurance_zone2') is deliberately NOT in this
  // enum for Beta — per user decision D5 (2026-05-26), cardio first-class
  // is deferred to W7+. See reference_w3_tuning_candidates.md item 13.
  goal: z.enum(['cut', 'maintain', 'bulk']),
});
export type OnboardingCompleteRequest = z.infer<typeof OnboardingCompleteRequestSchema>;

export const OnboardingCompleteResponseSchema = z.object({
  onboarding_completed_at: z.string(),  // ISO timestamp
});
export type OnboardingCompleteResponse = z.infer<typeof OnboardingCompleteResponseSchema>;
