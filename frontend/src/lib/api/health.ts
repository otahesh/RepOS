/**
 * Frontend types for the health/weight API surface.
 *
 * These types are manually kept in sync with the canonical Zod schemas at:
 *   api/src/schemas/healthWeight.ts
 *
 * They are structurally identical to the `z.infer<typeof …Schema>` types
 * produced by those schemas. The frontend does not install zod, so we
 * cannot import the inferred types directly; instead we mirror them here.
 *
 * IMPORTANT: If you change a response shape in the API route or the Zod
 * schema, update this file too. The contract tests in
 *   api/tests/contract/healthWeight.contract.test.ts
 * will catch API ↔ schema drift, but they do NOT catch schema ↔ frontend-type
 * drift — that gap is closed once zod is added to the frontend workspace and
 * these types are replaced with true `z.infer<>` aliases.
 *
 * Cross-package strategy: path-alias via tsconfig (Option A) was evaluated but
 * requires zod in the frontend for the API schema imports to type-check. Until
 * zod is a frontend dependency, this manual mirror is the lowest-friction
 * approach. See api/src/schemas/README.md for the full rationale.
 */

// ---------------------------------------------------------------------------
// POST /api/health/weight
// ---------------------------------------------------------------------------

export type WeightSource = 'Apple Health' | 'Manual' | 'Withings' | 'Renpho';

export interface WeightSampleInput {
  weight_lbs: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  source: WeightSource;
}

export interface WeightSampleResponse {
  id: number | string; // BIGINT returned as string by pg
  date: string;
  weight_lbs: number;
  deduped: boolean;
}

// ---------------------------------------------------------------------------
// POST /api/health/weight/backfill
// ---------------------------------------------------------------------------

export interface WeightBackfillInput {
  samples: WeightSampleInput[]; // 1–500 items
}

export interface WeightBackfillResponse {
  created: number;
  deduped: number;
}

// ---------------------------------------------------------------------------
// GET /api/health/weight
// ---------------------------------------------------------------------------

export type WeightRange = '7d' | '30d' | '90d' | '1y' | 'all';

export interface WeightSampleRow {
  date: string; // YYYY-MM-DD text
  weight_lbs: number;
  source: string;
}

export interface WeightStats {
  trend_7d_lbs: number | null;
  trend_30d_lbs: number | null;
  trend_90d_lbs: number | null;
  adherence_pct: number | null;
  missed_days: string[];
}

export interface SyncState {
  source: string | null;
  last_success_at: string | null; // ISO-8601 timestamp
  state: 'fresh' | 'stale' | 'broken';
}

export interface CurrentWeight {
  weight_lbs: number;
  date: string;
  time: string;
}

export interface WeightRangeResponse {
  current: CurrentWeight | null;
  samples: WeightSampleRow[];
  stats: WeightStats;
  sync: SyncState | null;
}

// ---------------------------------------------------------------------------
// GET /api/health/sync/status
// ---------------------------------------------------------------------------

export interface SyncStatusResponse {
  source: string | null;
  last_success_at: string | null; // ISO-8601 timestamp
  state: 'fresh' | 'stale' | 'broken';
}
