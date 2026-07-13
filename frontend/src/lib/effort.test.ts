import { describe, expect, it } from 'vitest';
import { rpeFromRir, rirFromRpe, rowMode } from './effort';
import type { TodaySet } from './api/mesocycles';

describe('effort seam — the ONLY rir<->rpe conversion in the app', () => {
  it('converts both directions and round-trips', () => {
    expect(rpeFromRir(2)).toBe(8);
    expect(rirFromRpe(8)).toBe(2);
    for (let rir = 0; rir <= 5; rir++) expect(rirFromRpe(rpeFromRir(rir))).toBe(rir);
  });
});

describe('rowMode — derives from populated targets, not exercise.measurement', () => {
  const mk = (patch: Partial<TodaySet>) => patch as TodaySet;

  it('duration targets present → duration mode', () => {
    expect(rowMode(mk({ target_duration_low_sec: 30 }))).toBe('duration');
  });

  it('no duration targets → reps mode', () => {
    expect(rowMode(mk({ target_duration_low_sec: null, target_reps_low: 8 }))).toBe('reps');
  });

  it('legacy in-flight row: duration EXERCISE materialized pre-092 with reps targets → reps mode', () => {
    expect(
      rowMode(
        mk({
          target_duration_low_sec: null,
          target_reps_low: 8,
          exercise: { measurement: 'duration' } as TodaySet['exercise'],
        }),
      ),
    ).toBe('reps');
  });

  it('absent field (old mock/fixture) → reps mode', () => {
    expect(rowMode(mk({}))).toBe('reps');
  });
});
