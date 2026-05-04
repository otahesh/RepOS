import type { PredicateT } from '../schemas/predicate.js';

/**
 * Compile a list of equipment predicates into a SQL boolean fragment that
 * evaluates against a JSONB profile expression (e.g. "$1::jsonb" or
 * "u.equipment_profile"). All predicates are AND-joined. Empty list → TRUE.
 *
 * The compiler emits literal numeric / boolean operands (no parameter
 * binding for predicate values) because predicates come from trusted
 * source-controlled seed data, NOT user input. The profile reference
 * is passed in as a SQL expression.
 */
export function compilePredicates(
  predicates: PredicateT[],
  profileExpr: string,
): { sql: string; params: never[] } {
  if (predicates.length === 0) return { sql: 'TRUE', params: [] };

  const clauses = predicates.map(p => `(${compileOne(p, profileExpr)})`);
  return { sql: clauses.join(' AND '), params: [] };
}

function compileOne(p: PredicateT, prof: string): string {
  switch (p.type) {
    case 'dumbbells':
      // Must own dumbbells covering min_pair_lb (max_lb >= N AND min_lb <= N)
      return `(${prof}->'dumbbells') IS NOT NULL `
        + `AND ${prof}->'dumbbells' <> 'false'::jsonb `
        + `AND (${prof}->'dumbbells'->>'max_lb')::int >= ${p.min_pair_lb} `
        + `AND (${prof}->'dumbbells'->>'min_lb')::int <= ${p.min_pair_lb}`;
    case 'adjustable_bench': {
      const parts: string[] = [
        `(${prof}->'adjustable_bench') IS NOT NULL`,
        `${prof}->'adjustable_bench' <> 'false'::jsonb`,
      ];
      if (p.incline) parts.push(`${prof}->'adjustable_bench'->>'incline' = 'true'`);
      if (p.decline) parts.push(`${prof}->'adjustable_bench'->>'decline' = 'true'`);
      return parts.join(' AND ');
    }
    case 'machine':
      return `(${prof}->'machines') IS NOT NULL `
        + `AND ${prof}->'machines'->>'${p.name}' = 'true'`;
    case 'recumbent_bike':
      return `(${prof}->'recumbent_bike') IS NOT NULL `
        + `AND ${prof}->'recumbent_bike' <> 'false'::jsonb`;
    case 'outdoor_walking':
      return `(${prof}->'outdoor_walking') IS NOT NULL `
        + `AND ${prof}->'outdoor_walking' <> 'false'::jsonb`;
    // Boolean-only predicates
    case 'barbell':
    case 'flat_bench':
    case 'squat_rack':
    case 'pullup_bar':
    case 'dip_station':
    case 'cable_stack':
    case 'rowing_erg':
    case 'treadmill':
      return `${prof}->>'${p.type}' = 'true'`;
  }
}
