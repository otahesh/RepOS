import { z } from 'zod';

// ---------------------------------------------------------------------------
// Beta W1.2 — set_logs request / response schemas.
//
// The DB column names are historical (`performed_load_lbs`, `performed_reps`,
// `performed_rir`) but the API and frontend speak in the simpler Beta names
// (`weight_lbs`, `reps`, `rir`). The route SQL aliases the DB names back to
// these in SELECT projections so handlers can return rows directly.
// ---------------------------------------------------------------------------

// 5 minutes of forward skew tolerance — covers clients with a fast clock
// (iOS Shortcuts can drift) without letting a malicious caller post a
// far-future performed_at that would hold the 24h audit window open
// indefinitely. 365 days of backfill tolerance — anything older should
// flow through a separate backfill affordance, not the live logger.
const FORWARD_SKEW_MS = 5 * 60 * 1000;
const MAX_BACKFILL_MS = 365 * 24 * 60 * 60 * 1000;

export function performedAtRefine(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return t <= now + FORWARD_SKEW_MS && t >= now - MAX_BACKFILL_MS;
}

export const SetLogPostSchema = z
  .object({
    client_request_id: z.string().uuid(),
    planned_set_id: z.string().uuid(),
    weight_lbs: z.number().min(0).max(2000).optional(),
    reps: z.number().int().min(0).max(100).optional(),
    // Duration sets (holds, timed carries): seconds of unbroken time under
    // load. Optional-absent like every other performed field.
    duration_sec: z.number().int().min(1).max(3600).optional(),
    rir: z.number().int().min(0).max(5).optional(),
    rpe: z.number().int().min(1).max(10).optional(),
    performed_at: z
      .string()
      .datetime({ offset: true })
      // Reviewer Critical: an unbounded `performed_at` keeps the 24h audit
      // window open forever (post a row dated 2099 → still editable in 2098).
      // Bound to (now - 365d, now + 5min] so the audit gate retains its
      // "historical analytics can't be silently rewritten" guarantee.
      .refine(performedAtRefine, {
        message: 'performed_at must be within the last 365 days and not >5 minutes in the future',
      }),
    notes: z.string().max(500).optional(),
  })
  // Rollback-skew + junk-row guard: a set log must measure SOMETHING. Old
  // clients always send reps for reps sets — no compat break. This also makes
  // a new-client hold POST against a rolled-back pre-duration API fail loudly
  // (400 → row stays pending in the offline queue) instead of silently
  // stripping duration_sec and 201-ing an empty row.
  .refine((v) => v.reps != null || v.duration_sec != null, {
    message: 'either reps or duration_sec is required',
    path: ['reps'],
  });
export type SetLogPost = z.infer<typeof SetLogPostSchema>;

export const SetLogPatchSchema = z
  .object({
    weight_lbs: z.number().min(0).max(2000).optional(),
    reps: z.number().int().min(0).max(100).optional(),
    duration_sec: z.number().int().min(1).max(3600).optional(),
    rir: z.number().int().min(0).max(5).optional(),
    rpe: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field required',
  });
export type SetLogPatch = z.infer<typeof SetLogPatchSchema>;

export const SetLogListQuerySchema = z.object({
  planned_set_id: z.string().uuid(),
});
export type SetLogListQuery = z.infer<typeof SetLogListQuerySchema>;

// :id param schema — re-exported from the shared module so there is one
// canonical UUID-param validator. GET uses SetLogListQuerySchema instead.
export { UuidParamSchema as IdParamSchema } from './idParams.js';
export type { UuidParam as IdParam } from './idParams.js';

// ---------------------------------------------------------------------------
// Shape returned to clients. The numeric(5,1) `performed_load_lbs` column is
// SELECTed as `performed_load_lbs::float AS weight_lbs` — pg's default text
// parser would otherwise hand back a string. The other two performed_* columns
// are SMALLINT, which pg already returns as JS number.
// ---------------------------------------------------------------------------
export interface SetLogRow {
  id: string;
  user_id: string;
  exercise_id: string;
  planned_set_id: string;
  client_request_id: string;
  weight_lbs: number | null;
  reps: number | null;
  duration_sec: number | null;
  rir: number | null;
  rpe: number | null;
  performed_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
