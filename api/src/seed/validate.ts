import { ExerciseSeedSchema, type ExerciseSeed } from '../schemas/exerciseSeed.js';

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

const MIN_SUM = 0.8;
const MAX_SUM = 4.0;

export function validateSeed(seeds: ExerciseSeed[]): ValidateResult {
  const errors: string[] = [];

  // 1. Per-entry Zod parse + sum bounds + duplicate-slug detection
  const slugs = new Set<string>();
  for (const s of seeds) {
    const parsed = ExerciseSeedSchema.safeParse(s);
    if (!parsed.success) {
      errors.push(`[${s.slug ?? '<unknown>'}] zod: ${parsed.error.message}`);
      continue;
    }
    if (slugs.has(s.slug)) errors.push(`duplicate slug: ${s.slug}`);
    slugs.add(s.slug);

    const sum = Object.values(s.muscle_contributions).reduce((a, b) => a + b, 0);
    if (sum < MIN_SUM || sum > MAX_SUM) {
      errors.push(`[${s.slug}] contribution sum ${sum.toFixed(2)} outside [${MIN_SUM}, ${MAX_SUM}]`);
    }
  }

  // 2. parent_slug references must resolve
  for (const s of seeds) {
    if (s.parent_slug && !slugs.has(s.parent_slug)) {
      errors.push(`[${s.slug}] parent_slug "${s.parent_slug}" not found in seed`);
    }
    if (s.parent_slug === s.slug) {
      errors.push(`[${s.slug}] parent_slug references itself`);
    }
  }

  // 3. Cycle detection (DFS)
  const parentOf = new Map(seeds.filter(s => s.parent_slug).map(s => [s.slug, s.parent_slug!]));
  for (const start of parentOf.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur) {
      if (seen.has(cur)) { errors.push(`parent cycle detected involving "${start}"`); break; }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
