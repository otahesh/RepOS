import { z } from 'zod';

// ---------------------------------------------------------------------------
// Beta W1.2 — set_logs request / response schemas.
//
// The DB column names are historical (`performed_load_lbs`, `performed_reps`,
// `performed_rir`) but the API and frontend speak in the simpler Beta names
// (`weight_lbs`, `reps`, `rir`). The route SQL aliases the DB names back to
// these in SELECT projections so handlers can return rows directly.
// ---------------------------------------------------------------------------

export const SetLogPostSchema = z.object({
  client_request_id: z.string().uuid(),
  planned_set_id: z.string().uuid(),
  weight_lbs: z.number().min(0).max(2000).optional(),
  reps: z.number().int().min(0).max(100).optional(),
  rir: z.number().int().min(0).max(5).optional(),
  rpe: z.number().int().min(1).max(10).optional(),
  performed_at: z.string().datetime({ offset: true }),
  notes: z.string().max(500).optional(),
});
export type SetLogPost = z.infer<typeof SetLogPostSchema>;

export const SetLogPatchSchema = z
  .object({
    weight_lbs: z.number().min(0).max(2000).optional(),
    reps: z.number().int().min(0).max(100).optional(),
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

// shared by PATCH; DELETE/GET will use it in W1.2.14+
export const IdParamSchema = z.object({
  id: z.string().uuid(),
});
export type IdParam = z.infer<typeof IdParamSchema>;

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
  rir: number | null;
  rpe: number | null;
  performed_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
