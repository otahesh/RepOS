// Client-side predicate evaluator. Mirrors the JS-side logic in
// api/src/services/substitutions.ts. The two must stay in sync as new
// predicate types are added — when adding a type, update both.

export type PredicateT =
  | { type: 'dumbbells'; min_pair_lb: number }
  | { type: 'adjustable_bench'; incline?: boolean; decline?: boolean }
  | { type: 'machine'; name: string }
  | { type: 'recumbent_bike' }
  | { type: 'outdoor_walking' }
  | { type: 'barbell' | 'flat_bench' | 'squat_rack' | 'pullup_bar'
      | 'dip_station' | 'cable_stack' | 'rowing_erg' | 'treadmill' };

export function allPredicatesSatisfied(
  predicates: PredicateT[],
  profile: Record<string, unknown>,
): boolean {
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
      return !!(prof['machines'] as Record<string, unknown> | undefined)?.[p.name];
    case 'recumbent_bike':
      return !!prof['recumbent_bike'] && prof['recumbent_bike'] !== false;
    case 'outdoor_walking':
      return !!prof['outdoor_walking'] && prof['outdoor_walking'] !== false;
    default:
      return prof[p.type] === true || (typeof prof[p.type] === 'object' && prof[p.type] !== null);
  }
}
