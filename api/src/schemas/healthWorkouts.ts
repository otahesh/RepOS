import { z } from 'zod';

// ---------------------------------------------------------------------------
// Beta W1.4 — POST /api/health/workouts request/response schemas.
//
// SOURCE OF TRUTH for modality:
//   Migration 030 deliberately ships modality as TEXT NOT NULL with NO CHECK
//   constraint — Zod owns the allowlist so we have one place to add new
//   modalities (e.g. 'yoga', 'hiit') without a follow-up migration. Keep
//   this list in sync with the docs/runbooks/ios-shortcuts.md mapping table.
//
// SOURCE: 'Apple Health' | 'Manual' — must match the SQL CHECK on
// health_workouts.source verbatim. Adding a value here that the DB rejects
// would manifest as a 500 from a CHECK violation instead of a 400.
// ---------------------------------------------------------------------------

export const VALID_MODALITIES = [
  'walk',
  'run',
  'cycle',
  'row',
  'swim',
  'elliptical',
  'strength',
  'other',
] as const;
export type WorkoutModality = (typeof VALID_MODALITIES)[number];

export const VALID_WORKOUT_SOURCES = ['Apple Health', 'Manual'] as const;
export type WorkoutSource = (typeof VALID_WORKOUT_SOURCES)[number];

// ---------------------------------------------------------------------------
// POST /api/health/workouts — inbound request body
// ---------------------------------------------------------------------------

export const WorkoutIngestSchema = z
  .object({
    // Accept both '…-04:00' (Apple Health iOS Shortcut) and '…Z' (server-
    // synthesized retries). `offset: true` makes the timezone segment
    // required; bare 'YYYY-MM-DDTHH:MM:SS' is rejected.
    started_at: z.string().datetime({ offset: true }),
    ended_at: z.string().datetime({ offset: true }),
    modality: z.enum(VALID_MODALITIES, {
      error: () => `modality must be one of: ${VALID_MODALITIES.join(', ')}`,
    }),
    // Migration 030 allows distance_m NULL (e.g. strength sessions have no
    // distance). Accept missing, explicit null, or a non-negative integer.
    distance_m: z.number().int().min(0).nullable().optional(),
    duration_sec: z.number().int().positive(),
    source: z.enum(VALID_WORKOUT_SOURCES, {
      error: () => `source must be one of: ${VALID_WORKOUT_SOURCES.join(', ')}`,
    }),
  })
  // Mirror migration 030's CHECK (ended_at > started_at). Catching this in
  // Zod surfaces a 400 with a clear field instead of a 500 from the DB.
  .refine((d) => Date.parse(d.ended_at) > Date.parse(d.started_at), {
    message: 'ended_at must be after started_at',
    path: ['ended_at'],
  });

export type WorkoutIngestInput = z.infer<typeof WorkoutIngestSchema>;

// ---------------------------------------------------------------------------
// POST /api/health/workouts — response body
// 201 on fresh insert (deduped:false), 200 on upsert/dedupe (deduped:true).
// The { workout: {...}, deduped: bool } envelope is per plan W1.4.5
// (`expect(resp.json().workout).toMatchObject(...)`).
// ---------------------------------------------------------------------------

const WorkoutRowSchema = z.object({
  id: z.union([z.number(), z.string()]), // BIGINT may serialize as string
  started_at: z.string(),
  ended_at: z.string(),
  modality: z.enum(VALID_MODALITIES),
  distance_m: z.number().int().nullable(),
  duration_sec: z.number().int(),
  source: z.enum(VALID_WORKOUT_SOURCES),
});

export const WorkoutIngestResponseSchema = z.object({
  workout: WorkoutRowSchema,
  deduped: z.boolean(),
});

export type WorkoutRow = z.infer<typeof WorkoutRowSchema>;
export type WorkoutIngestResponse = z.infer<typeof WorkoutIngestResponseSchema>;
