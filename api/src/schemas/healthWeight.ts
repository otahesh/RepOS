import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared validation helpers — match the hand-rolled validate() in weight.ts
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isValidTime(s: string): boolean {
  if (!TIME_RE.test(s)) return false;
  const [h, m, sec] = s.split(':').map(Number);
  return h < 24 && m < 60 && sec < 60;
}

const WeightDate = z
  .string()
  .refine(isValidCalendarDate, {
    message: 'date must be a valid YYYY-MM-DD calendar date',
  });

const WeightTime = z
  .string()
  .refine(isValidTime, { message: 'time must be HH:MM:SS' });

export const VALID_SOURCES = ['Apple Health', 'Manual', 'Withings', 'Renpho'] as const;
export type WeightSource = (typeof VALID_SOURCES)[number];

// ---------------------------------------------------------------------------
// POST /api/health/weight — inbound request body
// ---------------------------------------------------------------------------

export const WeightSampleSchema = z.object({
  weight_lbs: z
    .number()
    .finite()
    .min(50.0, { message: 'weight_lbs must be between 50.0 and 600.0' })
    .max(600.0, { message: 'weight_lbs must be between 50.0 and 600.0' }),
  date: WeightDate,
  time: WeightTime,
  source: z.enum(VALID_SOURCES, {
    error: () => `source must be one of: ${VALID_SOURCES.join(', ')}`,
  }),
});

export type WeightSampleInput = z.infer<typeof WeightSampleSchema>;

// ---------------------------------------------------------------------------
// POST /api/health/weight — response body
// 201 on new insert, 200 on dedup.
// ---------------------------------------------------------------------------

export const WeightSampleResponseSchema = z.object({
  id: z.union([z.number(), z.string()]), // BIGINT may be returned as string by pg
  date: z.string(),
  weight_lbs: z.number(),
  deduped: z.boolean(),
});

export type WeightSampleResponse = z.infer<typeof WeightSampleResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/health/weight/backfill — inbound request body
// Max 500 samples per call; each sample is validated with WeightSampleSchema.
// ---------------------------------------------------------------------------

export const WeightBackfillSchema = z.object({
  samples: z
    .array(WeightSampleSchema)
    .min(1)
    .max(500, { message: 'samples array exceeds maximum of 500 items' }),
});

export type WeightBackfillInput = z.infer<typeof WeightBackfillSchema>;

// POST /api/health/weight/backfill — response body
export const WeightBackfillResponseSchema = z.object({
  created: z.number().int().min(0),
  deduped: z.number().int().min(0),
});

export type WeightBackfillResponse = z.infer<typeof WeightBackfillResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/health/weight — query string
// ---------------------------------------------------------------------------

export const VALID_RANGES = ['7d', '30d', '90d', '1y', 'all'] as const;
export type WeightRange = (typeof VALID_RANGES)[number];

export const WeightRangeQuerySchema = z.object({
  range: z.enum(VALID_RANGES).default('90d'),
});

export type WeightRangeQuery = z.infer<typeof WeightRangeQuerySchema>;

// ---------------------------------------------------------------------------
// GET /api/health/weight — response body
// ---------------------------------------------------------------------------

const WeightSampleRowSchema = z.object({
  date: z.string(), // YYYY-MM-DD text
  weight_lbs: z.number(),
  source: z.string(),
});

const WeightStatsSchema = z.object({
  trend_7d_lbs: z.number().nullable(),
  trend_30d_lbs: z.number().nullable(),
  trend_90d_lbs: z.number().nullable(),
  adherence_pct: z.number().nullable(),
  missed_days: z.array(z.string()),
});

// The sync sub-object comes from the health_sync_status join; null when the
// user has never synced.
const SyncStateSchema = z.object({
  source: z.string().nullable(),
  last_success_at: z.string().nullable(), // ISO-8601 timestamp string
  state: z.enum(['fresh', 'stale', 'broken']),
});

const CurrentWeightSchema = z.object({
  weight_lbs: z.number(),
  date: z.string(),
  time: z.string(),
});

export const WeightRangeResponseSchema = z.object({
  current: CurrentWeightSchema.nullable(),
  samples: z.array(WeightSampleRowSchema),
  stats: WeightStatsSchema,
  sync: SyncStateSchema.nullable(),
});

export type WeightRangeResponse = z.infer<typeof WeightRangeResponseSchema>;

// Re-export sub-types for frontend convenience
export type WeightSampleRow = z.infer<typeof WeightSampleRowSchema>;
export type WeightStats = z.infer<typeof WeightStatsSchema>;
export type SyncState = z.infer<typeof SyncStateSchema>;
export type CurrentWeight = z.infer<typeof CurrentWeightSchema>;

// ---------------------------------------------------------------------------
// GET /api/health/sync/status — response body
// Separate endpoint; lightweight; cached 60s.
// ---------------------------------------------------------------------------

export const SyncStatusResponseSchema = z.object({
  source: z.string().nullable(),
  last_success_at: z.string().nullable(), // ISO-8601 timestamp or null
  state: z.enum(['fresh', 'stale', 'broken']),
});

export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;
