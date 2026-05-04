import { describe, it, expect } from 'vitest';
import { compilePredicates } from '../src/services/predicateCompiler.js';
import type { PredicateT } from '../src/schemas/predicate.js';

describe('compilePredicates', () => {
  it('empty predicate list compiles to TRUE', () => {
    const out = compilePredicates([], '$1');
    expect(out.sql).toBe('TRUE');
    expect(out.params).toEqual([]);
  });

  it('single barbell predicate references the profile param', () => {
    const out = compilePredicates([{ type: 'barbell' } as PredicateT], '$1');
    expect(out.sql).toContain(`$1->>'barbell' = 'true'`);
  });

  it('dumbbells predicate checks min_pair_lb against profile range', () => {
    const out = compilePredicates([{ type: 'dumbbells', min_pair_lb: 50 } as PredicateT], '$1');
    expect(out.sql).toContain(`($1->'dumbbells'->>'max_lb')::int >= 50`);
    expect(out.sql).toContain(`($1->'dumbbells'->>'min_lb')::int <= 50`);
  });

  it('adjustable_bench with incline:true checks the incline subkey', () => {
    const out = compilePredicates(
      [{ type: 'adjustable_bench', incline: true } as PredicateT], '$1'
    );
    expect(out.sql).toContain(`$1->'adjustable_bench'->>'incline' = 'true'`);
  });

  it('machine predicate routes to machines.<name>', () => {
    const out = compilePredicates(
      [{ type: 'machine', name: 'leg_press' } as PredicateT], '$1'
    );
    expect(out.sql).toContain(`$1->'machines'->>'leg_press' = 'true'`);
  });

  it('multiple predicates AND-joined', () => {
    const out = compilePredicates([
      { type: 'barbell' } as PredicateT,
      { type: 'flat_bench' } as PredicateT,
    ], '$1');
    expect(out.sql).toMatch(/^\(.*\) AND \(.*\)$/);
  });
});
