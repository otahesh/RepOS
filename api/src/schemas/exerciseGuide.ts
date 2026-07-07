import { z } from 'zod';

// Seed-authoring shape for exercise setup cards (W2 of the logging redesign).
// Content rules mirror the DB CHECKs in migration 080 so authoring errors
// fail at validate() time with a path, not as a constraint violation mid-tx.
export const ExerciseGuideSeedSchema = z.object({
  exercise_slug: z.string().regex(/^[a-z0-9-]+$/, 'lowercase-kebab'),
  // The "30-second answer": concrete equipment settings / angles / positions.
  setup_callout: z.string().min(40).max(600),
  // Structured numbers behind W3's app-rendered annotation tags
  // (e.g. { bench_angle_deg: 30 }). Never baked into images.
  // Required (no .default): runSeed inserts opts.entries, not validation.data,
  // so Zod defaults would never materialize — authoring must be explicit.
  setup_facts: z.record(z.string().regex(/^[a-z0-9_]+$/), z.union([z.number(), z.string()])),
  cues: z.array(z.string().min(8).max(120)).length(3),
  donts: z.array(z.string().min(8).max(120)).length(2),
  // Populated in W3: { start: "/exercise-media/<slug>-start.webp", end: ... }
  // Required for the same reason as setup_facts — author `media: {}` until W3.
  media: z.object({ start: z.string().optional(), end: z.string().optional() }),
});

export type ExerciseGuideSeed = z.infer<typeof ExerciseGuideSeedSchema>;

// Response shape for GET /api/exercises/:slug/guide — mirrored manually in
// frontend/src/lib/api/exerciseGuide.ts (see api/src/schemas/README.md).
export type ExerciseGuideResponse = {
  slug: string;
  setup_callout: string;
  setup_facts: Record<string, number | string>;
  cues: string[];
  donts: string[];
  media: { start?: string; end?: string };
};
