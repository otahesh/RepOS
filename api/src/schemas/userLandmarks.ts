import { z } from 'zod';
import { MUSCLE_LANDMARKS } from '../services/_muscleLandmarks.js';

export const MUSCLE_SLUGS = Object.keys(MUSCLE_LANDMARKS) as (keyof typeof MUSCLE_LANDMARKS)[];
const MuscleSlugEnum = z.enum(MUSCLE_SLUGS as [string, ...string[]]);

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

const SingleLandmarkBaseSchema = z.object({
  mv: z.number().int().min(0).optional(),
  mev: z.number().int().min(0).max(50),
  mav: z.number().int().min(0).max(50),
  mrv: z.number().int().min(0).max(50),
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
export function parseLandmarksPatch(body: unknown):
  | { ok: true; overrides: Record<string, { mev: number; mav: number; mrv: number; mv?: number }> }
  | { ok: false; fieldErrors: Record<string, string> } {
  const shape = z.object({ overrides: z.record(MuscleSlugEnum, SingleLandmarkBaseSchema) }).safeParse(body);
  if (!shape.success) return { ok: false, fieldErrors: { _root: 'malformed body' } };
  const out: Record<string, { mev: number; mav: number; mrv: number; mv?: number }> = {};
  const fieldErrors: Record<string, string> = {};
  for (const [slug, v] of Object.entries(shape.data.overrides)) {
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
