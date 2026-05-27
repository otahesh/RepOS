import { z } from 'zod';
import { MUSCLE_LANDMARKS } from '../services/_muscleLandmarks.js';

export const MUSCLE_SLUGS = Object.keys(MUSCLE_LANDMARKS) as (keyof typeof MUSCLE_LANDMARKS)[];
const VALID_SLUGS = new Set<string>(MUSCLE_SLUGS as string[]);

// MV ≤ MEV < MAV < MRV; MV≥0; MRV≤50 (master plan §320)
// PLUS clinical floors and ceilings [C-LANDMARKS-CLINICAL-FLOORS]:
//   - MEV >= max(2, seed.mev * 0.5) per muscle
//   - MRV <= min(50, seed.mrv * 1.5) per muscle
//   - MAV - MEV >= 2 (non-trivial gap)
//   - MRV - MAV >= 2 (non-trivial gap)
// The per-muscle bounds are enforced via a sibling schema map (one schema per
// slug) so error messages name the slug.
//
// Surface ALL per-row errors, not first-error-wins: callers iterate Object.entries
// of the input and collect every failure into a fieldErrors map. The endpoint
// returns 400 with `{ fieldErrors: { chest: 'MEV below clinical floor 5', ... } }`.

// NOTE: no `.max()` on the base. The per-slug clinical ceiling (mrvCeiling,
// always <=50) in buildSingleLandmarkSchema produces a per-ROW "MRV above
// clinical ceiling N" error for over-range input. If the base capped at 50,
// an out-of-range value would fail the WHOLE-body parse (collapsing to
// `_root: malformed body`) instead of surfacing as a per-row error — which
// breaks the per-row-error contract [C-LANDMARKS-CLINICAL-FLOORS]. A generous
// upper guard rejects absurd input while keeping clinical violations per-row.
const SingleLandmarkBaseSchema = z.object({
  mv: z.number().int().min(0).max(200).optional(),
  mev: z.number().int().min(0).max(200),
  mav: z.number().int().min(0).max(200),
  mrv: z.number().int().min(0).max(200),
});

// Per-slug validator with clinical floors/ceilings derived from MUSCLE_LANDMARKS seed.
export function buildSingleLandmarkSchema(slug: string) {
  const seed = MUSCLE_LANDMARKS[slug as keyof typeof MUSCLE_LANDMARKS];
  if (!seed) throw new Error(`buildSingleLandmarkSchema: unknown slug '${slug}'`);
  const mevFloor = Math.max(2, Math.floor(seed.mev * 0.5));
  const mrvCeiling = Math.min(50, Math.ceil(seed.mrv * 1.5));
  return SingleLandmarkBaseSchema.superRefine((l, ctx) => {
    if (l.mv !== undefined && l.mv > l.mev) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MV must be <= MEV' });
    if (l.mev < mevFloor) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `MEV below clinical floor ${mevFloor}` });
    if (l.mrv > mrvCeiling) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `MRV above clinical ceiling ${mrvCeiling}` });
    if (l.mav - l.mev < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MAV - MEV must be >= 2' });
    if (l.mrv - l.mav < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MRV - MAV must be >= 2' });
  });
}

// PATCH body: parse the whole `overrides` map and collect per-slug failures.
//
// DEVIATION FROM PLAN PSEUDOCODE (documented): the plan drafted
// `z.record(MuscleSlugEnum, SingleLandmarkBaseSchema)`. Under zod v4 (this
// repo is on 4.4.3) a record keyed by an ENUM is EXHAUSTIVE — it demands every
// enum key be present, so a partial overrides map (e.g. just `chest`) fails
// with "expected object, received undefined" for every other muscle. The
// LandmarksEditor PATCHes only changed rows, so the map MUST be partial. We
// therefore key the outer record on `z.string()` (partial-friendly) and reject
// unknown slugs as a per-row fieldError below — preserving the same
// per-row-error contract the plan specifies.
export function parseLandmarksPatch(body: unknown):
  | { ok: true; overrides: Record<string, { mev: number; mav: number; mrv: number; mv?: number }> }
  | { ok: false; fieldErrors: Record<string, string> } {
  const shape = z.object({ overrides: z.record(z.string(), SingleLandmarkBaseSchema) }).safeParse(body);
  if (!shape.success) return { ok: false, fieldErrors: { _root: 'malformed body' } };
  const out: Record<string, { mev: number; mav: number; mrv: number; mv?: number }> = {};
  const fieldErrors: Record<string, string> = {};
  for (const [slug, v] of Object.entries(shape.data.overrides)) {
    if (!VALID_SLUGS.has(slug)) {
      fieldErrors[slug] = `unknown muscle slug`;
      continue;
    }
    const per = buildSingleLandmarkSchema(slug).safeParse(v);
    if (!per.success) {
      fieldErrors[slug] = per.error.issues.map((i) => i.message).join('; ');
    } else {
      out[slug] = per.data;
    }
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, overrides: out };
}

export type ResolvedLandmarks = Record<string, { mev: number; mav: number; mrv: number; mv?: number }>;
