import { db } from '../db/client.js';
import { compilePredicates as _compilePredicates } from './predicateCompiler.js';
import { Predicate as _Predicate, type PredicateT } from '../schemas/predicate.js';

// _compilePredicates and _Predicate are reserved for the v3 SQL-translatable
// scaling path. In v1 we evaluate predicates in JS for clarity; when the
// catalog grows, swap to the SQL compiler (T9) for a single-query path.

export type SubResult = {
  from: { slug: string; name: string };
  subs: Array<{ slug: string; name: string; score: number; reason: string }>;
  truncated: boolean;
  total_matches?: number;
  reason?: 'no_equipment_profile' | 'no_equipment_match';
  closest_partial?: { slug: string; name: string };
};

const TRUNCATION = 25;
const SCORE_FLOOR = 100;

export async function findSubstitutions(
  targetSlug: string,
  userEquipmentProfile: Record<string, unknown>,
): Promise<SubResult | null> {
  const { rows: [target] } = await db.query<{
    id: string; name: string; movement_pattern: string; primary_muscle_id: number;
  }>(
    `SELECT id, name, movement_pattern, primary_muscle_id
     FROM exercises WHERE slug=$1 AND archived_at IS NULL`,
    [targetSlug],
  );
  if (!target) return null;

  const onlyV = Object.keys(userEquipmentProfile).filter(k => k !== '_v').length === 0;
  if (onlyV) {
    return { from: { slug: targetSlug, name: target.name }, subs: [], truncated: false, reason: 'no_equipment_profile' };
  }

  // 1. Find candidates that pass equipment predicates
  // We have to do per-row predicate compilation because each candidate's
  // required_equipment differs. Use a single big query with JSONB ops by
  // letting SQL evaluate each candidate's requires[] array against $1.
  const candidates = await db.query<{
    id: string; slug: string; name: string;
    movement_pattern: string; primary_muscle_id: number;
    required_equipment: { _v: number; requires: PredicateT[] };
  }>(
    `SELECT id, slug, name, movement_pattern, primary_muscle_id, required_equipment
     FROM exercises
     WHERE id <> $1 AND archived_at IS NULL`,
    [target.id],
  );

  type Scored = { row: typeof candidates.rows[number]; score: number; reason: string; pattern_match: boolean };
  const passing: Scored[] = [];
  const profile = userEquipmentProfile;

  for (const row of candidates.rows) {
    const reqs = (row.required_equipment?.requires ?? []) as PredicateT[];
    if (!allPredicatesSatisfied(reqs, profile)) continue;

    let score = 0;
    let reason = '';
    const patternMatch = row.movement_pattern === target.movement_pattern;
    const primaryMatch = row.primary_muscle_id === target.primary_muscle_id;
    if (patternMatch) { score += 1000; reason = 'Same pattern'; }
    if (primaryMatch) { score += 500; reason = reason ? `${reason} · same primary` : 'Same primary muscle'; }

    // Overlap subscore via SUM(LEAST(target.contribution, candidate.contribution))
    const { rows: [overlap] } = await db.query<{ overlap: number }>(
      `SELECT COALESCE(SUM(LEAST(t.contribution, c.contribution)), 0)::float8 AS overlap
       FROM exercise_muscle_contributions t
       JOIN exercise_muscle_contributions c ON c.muscle_id = t.muscle_id
       WHERE t.exercise_id=$1 AND c.exercise_id=$2`,
      [target.id, row.id],
    );
    score += Math.round(overlap.overlap * 100);

    if (score < SCORE_FLOOR) continue;
    passing.push({ row, score, reason: reason || 'Muscle overlap', pattern_match: patternMatch });
  }

  passing.sort((a, b) => (b.score - a.score) || a.row.slug.localeCompare(b.row.slug));

  if (passing.length === 0) {
    // Find closest partial: same pattern, ignore equipment
    const { rows: [partial] } = await db.query<{ slug: string; name: string }>(
      `SELECT slug, name FROM exercises
       WHERE id <> $1 AND archived_at IS NULL AND movement_pattern=$2
       ORDER BY slug ASC LIMIT 1`,
      [target.id, target.movement_pattern],
    );
    return {
      from: { slug: targetSlug, name: target.name },
      subs: [], truncated: false, reason: 'no_equipment_match',
      closest_partial: partial ? { slug: partial.slug, name: partial.name } : undefined,
    };
  }

  const sliced = passing.slice(0, TRUNCATION);
  return {
    from: { slug: targetSlug, name: target.name },
    subs: sliced.map(s => ({ slug: s.row.slug, name: s.row.name, score: s.score, reason: s.reason })),
    truncated: passing.length > TRUNCATION,
    ...(passing.length > TRUNCATION ? { total_matches: passing.length } : {}),
  };
}

function allPredicatesSatisfied(predicates: PredicateT[], profile: Record<string, unknown>): boolean {
  for (const p of predicates) {
    if (!satisfies(p, profile)) return false;
  }
  return true;
}

function satisfies(p: PredicateT, prof: Record<string, unknown>): boolean {
  switch (p.type) {
    case 'dumbbells': {
      const dp = prof['dumbbells'];
      if (!dp || dp === false || typeof dp !== 'object') return false;
      const o = dp as { min_lb?: number; max_lb?: number };
      return typeof o.min_lb === 'number' && typeof o.max_lb === 'number'
        && o.min_lb <= p.min_pair_lb && o.max_lb >= p.min_pair_lb;
    }
    case 'adjustable_bench': {
      const ab = prof['adjustable_bench'];
      if (!ab || ab === false || typeof ab !== 'object') return false;
      const o = ab as { incline?: boolean; decline?: boolean };
      if (p.incline && !o.incline) return false;
      if (p.decline && !o.decline) return false;
      return true;
    }
    case 'machine':
      return !!(prof['machines'] as Record<string, unknown>)?.[p.name];
    case 'recumbent_bike':
      return !!prof['recumbent_bike'] && prof['recumbent_bike'] !== false;
    case 'outdoor_walking':
      return !!prof['outdoor_walking'] && prof['outdoor_walking'] !== false;
    default:
      return prof[p.type] === true || (typeof prof[p.type] === 'object' && prof[p.type] !== null);
  }
}
