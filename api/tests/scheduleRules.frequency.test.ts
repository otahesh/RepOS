// api/tests/scheduleRules.frequency.test.ts
import { describe, it, expect } from 'vitest';
import { validateFrequencyLimits } from '../src/services/scheduleRules.js';

const struct = (days: Array<{ kind?: 'strength'|'cardio'|'hybrid'; pattern?: string; rir?: number }>) => ({
  _v: 1 as const,
  days: days.map((d, i) => ({
    idx: i, day_offset: i,
    kind: d.kind ?? 'strength',
    name: `D${i}`,
    blocks: d.pattern ? [{
      exercise_slug: 'x', mev: 4, mav: 8, target_reps_low: 6, target_reps_high: 8,
      target_rir: d.rir ?? 2, rest_sec: 120,
      movement_pattern: d.pattern,
    }] : [],
  })),
});

describe('validateFrequencyLimits', () => {
  it('blocks 7 training days/week', () => {
    const w = validateFrequencyLimits(struct(Array(7).fill({})) as any);
    expect(w.some(x => x.code === 'too_many_days_per_week' && x.severity === 'block')).toBe(true);
  });
  it('warns at 6 training days/week', () => {
    const w = validateFrequencyLimits(struct(Array(6).fill({})) as any);
    expect(w.some(x => x.code === 'too_many_days_per_week' && x.severity === 'warn')).toBe(true);
  });
  it('warns on consecutive same primary pattern at RIR ≤ 2', () => {
    const w = validateFrequencyLimits(struct([
      { pattern: 'squat', rir: 2 },
      { pattern: 'squat', rir: 2 },
    ]) as any);
    expect(w.some(x => x.code === 'consecutive_same_pattern')).toBe(true);
  });
  it('no warning on consecutive different patterns', () => {
    const w = validateFrequencyLimits(struct([
      { pattern: 'squat', rir: 2 },
      { pattern: 'push_horizontal', rir: 2 },
    ]) as any);
    expect(w.some(x => x.code === 'consecutive_same_pattern')).toBe(false);
  });
  it('no warning on same pattern at RIR 3', () => {
    const w = validateFrequencyLimits(struct([
      { pattern: 'squat', rir: 3 },
      { pattern: 'squat', rir: 3 },
    ]) as any);
    expect(w.some(x => x.code === 'consecutive_same_pattern')).toBe(false);
  });
});
