// api/tests/recoveryFlags.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  registerEvaluator, getRegisteredFlagKeys, evaluateAll,
  bodyweightCrashEvaluator, _resetRegistryForTest,
  type RecoveryFlagEvaluator,
} from '../src/services/recoveryFlags.js';
import 'dotenv/config';
import { db } from '../src/db/client.js';

describe('recoveryFlags registry (spec §7.2)', () => {
  it('registry accepts a stub evaluator without errors (#3-ready)', () => {
    const stub: RecoveryFlagEvaluator = {
      key: 'overreaching',
      version: 1,
      evaluate: async () => ({ triggered: false }),
    };
    registerEvaluator(stub);
    expect(getRegisteredFlagKeys()).toContain('overreaching');
  });

  it('evaluateAll runs every registered evaluator and returns triggered ones', async () => {
    registerEvaluator({
      key: 'unit_always_fires',
      version: 1,
      evaluate: async () => ({ triggered: true, message: 'always', payload: { foo: 1 } }),
    });
    registerEvaluator({
      key: 'unit_never_fires',
      version: 1,
      evaluate: async () => ({ triggered: false }),
    });
    const out = await evaluateAll({ userId: '00000000-0000-0000-0000-000000000000', weekIdx: 1, runId: '00000000-0000-0000-0000-000000000000' });
    const fired = out.filter(o => o.triggered);
    expect(fired.find(f => f.key === 'unit_always_fires')).toBeDefined();
    expect(fired.find(f => f.key === 'unit_never_fires')).toBeUndefined();
  });
});

beforeEach(() => {
  _resetRegistryForTest();
});

let userId: string;

beforeAll(async () => {
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.bw.${Date.now()}@repos.test`],
  );
  userId = u.id;
});
afterAll(async () => {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  await db.end();
});

describe('bodyweight-crash evaluator (spec §7.2)', () => {
  it('triggers when 7d trend ≤ -2.0 lb AND program goal != cut', async () => {
    // DEVIATION FROM PLAN: plan used hardcoded 2026-04-20..27; we use
    // CURRENT_DATE-relative dates so the test works regardless of when
    // it runs. The evaluator filters CURRENT_DATE-INTERVAL '8 days'.
    // i=0 → 7 days ago (oldest), i=7 → today (newest).
    // Weights descend 200..196.5 (= -3.5 over 7 days; trend = -2.0 exactly).
    for (let i = 0; i < 8; i++) {
      await db.query(
        `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
         VALUES ($1, (CURRENT_DATE - ($2::int * INTERVAL '1 day'))::date, '08:00', $3, 'Manual')
         ON CONFLICT (user_id, sample_date, source) DO UPDATE SET weight_lbs=EXCLUDED.weight_lbs`,
        [userId, 7 - i, 200 - i * 0.5],
      );
    }
    const r = await bodyweightCrashEvaluator.evaluate({
      userId, runId: null, weekIdx: 1,
    });
    expect(r.triggered).toBe(true);
    if (r.triggered) {
      expect(r.message).toMatch(/dropping/i);
      expect(r.payload?.trend_7d_lbs).toBeDefined();
    }
  });

  it('does NOT trigger on small drops', async () => {
    // Wipe samples and insert near-flat data (also CURRENT_DATE-relative).
    await db.query(`DELETE FROM health_weight_samples WHERE user_id=$1`, [userId]);
    for (let i = 0; i < 8; i++) {
      await db.query(
        `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
         VALUES ($1, (CURRENT_DATE - ($2::int * INTERVAL '1 day'))::date, '08:00', $3, 'Manual')
         ON CONFLICT (user_id, sample_date, source) DO UPDATE SET weight_lbs=EXCLUDED.weight_lbs`,
        [userId, 7 - i, 200 - i * 0.1],
      );
    }
    const r = await bodyweightCrashEvaluator.evaluate({ userId, runId: null, weekIdx: 1 });
    expect(r.triggered).toBe(false);
  });

  it('registry interface accepts the bodyweight-crash evaluator alongside a stub overreaching evaluator (#3-ready)', () => {
    registerEvaluator(bodyweightCrashEvaluator);
    registerEvaluator({
      key: 'overreaching', version: 1,
      evaluate: async () => ({ triggered: false }),
    });
    const keys = getRegisteredFlagKeys();
    expect(keys).toContain('bodyweight_crash');
    expect(keys).toContain('overreaching');
  });
});
