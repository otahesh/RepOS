import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { findSubstitutions } from '../src/services/substitutions.js';

const TEST_USER_1_PROFILE = {
  _v: 1,
  dumbbells: { min_lb: 10, max_lb: 100, increment_lb: 10 },
  adjustable_bench: { incline: true, decline: true },
  recumbent_bike: { resistance_levels: 12 },
  outdoor_walking: { loop_mi: 0.42 },
};

const EMPTY_PROFILE = { _v: 1 };

beforeAll(async () => {
  // Ensure seed has been applied; tests assume curated catalog is present.
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM exercises WHERE created_by='system' AND archived_at IS NULL`);
  if (rows[0].n < 30) throw new Error('seed not applied — run npm run seed first');

  // Purge any test-scoped exercise rows leaked by prior test runs (e.g. from
  // program-schema.test.ts planned_sets / planned_cardio_blocks / set_logs
  // helpers that didn't clean up due to a crash). These rows have
  // required_equipment=NULL so allPredicatesSatisfied always returns true,
  // causing them to appear in substitution results and break the
  // "zero viable subs" assertion.
  await db.query(`
    DELETE FROM exercises
    WHERE slug LIKE 'ps-test-ex-%'
       OR slug LIKE 'pcb-test-ex-%'
       OR slug LIKE 'sl-test-ex-%'
  `);
});
afterAll(async () => { await db.end(); });

describe('substitutions (spec §9.3)', () => {
  it('12. empty equipment_profile → no_equipment_profile', async () => {
    const r = await findSubstitutions('barbell-bench-press', EMPTY_PROFILE);
    expect(r?.reason).toBe('no_equipment_profile');
    expect(r?.subs).toEqual([]);
  });

  it('13. zero viable subs → no_equipment_match with closest_partial', async () => {
    // Only a recumbent bike — satisfies zero push_horizontal alternatives.
    const onlyRecumbent = { _v: 1, recumbent_bike: { resistance_levels: 12 } };
    const r = await findSubstitutions('barbell-bench-press', onlyRecumbent);
    expect(r?.subs).toEqual([]);
    expect(r?.reason).toBe('no_equipment_match');
    expect(r?.closest_partial).toBeDefined();
  });

  it('14. partial-predicate match excluded (NOT partial-credit)', async () => {
    // User has barbell but no flat_bench → barbell-bench-press should NOT
    // be returned as a sub for any other exercise.
    const profile = { _v: 1, barbell: true /* no flat_bench */ };
    const r = await findSubstitutions('dumbbell-bench-press', profile);
    expect(r?.subs.find(s => s.slug === 'barbell-bench-press')).toBeUndefined();
  });

  it('15. ranking: same pattern beats same primary beats overlap', async () => {
    const r = await findSubstitutions('barbell-bench-press', TEST_USER_1_PROFILE);
    expect(r).not.toBeNull();
    // First result must be same pattern (push_horizontal); score >= 1000.
    expect(r!.subs[0].score).toBeGreaterThanOrEqual(1000);
  });

  it('16. deterministic tiebreak: two calls return identical ordering', async () => {
    const a = await findSubstitutions('barbell-bench-press', TEST_USER_1_PROFILE);
    const b = await findSubstitutions('barbell-bench-press', TEST_USER_1_PROFILE);
    expect(a?.subs.map(s => s.slug)).toEqual(b?.subs.map(s => s.slug));
  });

  it('17. profile change between calls → different sub set', async () => {
    const noBench = { ...TEST_USER_1_PROFILE, adjustable_bench: false };
    const a = await findSubstitutions('barbell-bench-press', TEST_USER_1_PROFILE);
    const b = await findSubstitutions('barbell-bench-press', noBench);
    expect(a?.subs.length).not.toBe(b?.subs.length); // bench-needing subs disappear
  });

  it('18. truncation cap at 25', async () => {
    const r = await findSubstitutions('barbell-bench-press', TEST_USER_1_PROFILE);
    expect(r!.subs.length).toBeLessThanOrEqual(25);
    if (r!.truncated) expect(r!.total_matches).toBeGreaterThan(25);
  });
});
