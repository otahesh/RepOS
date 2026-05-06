import { describe, it, expect } from 'vitest';
import { computeWarmupSets } from '../src/services/warmupSets.js';

describe('computeWarmupSets', () => {
  it('returns 3 sets at 40/60/80% rounded to nearest 5 lb', () => {
    const out = computeWarmupSets(225);
    expect(out).toEqual([
      { pct: 40, load_lbs: 90,  rir: 5 },
      { pct: 60, load_lbs: 135, rir: 5 },
      { pct: 80, load_lbs: 180, rir: 5 },
    ]);
  });
  it('rounds to nearest 5 lb increment, not floor', () => {
    expect(computeWarmupSets(135)[0]).toEqual({ pct: 40, load_lbs: 55, rir: 5 }); // 54 → 55
  });
  it('returns empty for working load < 45 lb (bar-only — skip warmups)', () => {
    expect(computeWarmupSets(40)).toEqual([]);
  });
});
