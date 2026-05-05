// api/tests/recoveryFlags.test.ts
import { describe, it, expect } from 'vitest';
import {
  registerEvaluator, getRegisteredFlagKeys, evaluateAll,
  type RecoveryFlagEvaluator,
} from '../src/services/recoveryFlags.js';

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
