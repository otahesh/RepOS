// api/tests/scheduleRules.cardio.test.ts
import { describe, it, expect } from 'vitest';
import { validateCardioScheduling } from '../src/services/scheduleRules.js';
import type { ProgramTemplateStructure } from '../src/types/program.js';

const day = (overrides: any) => ({
  idx: overrides.idx ?? 0, day_offset: overrides.day_offset ?? 0,
  kind: overrides.kind ?? 'strength', name: 'D', blocks: overrides.blocks ?? [],
});

describe('validateCardioScheduling', () => {
  it('warns: HIIT day before heavy-lower', () => {
    const structure = { _v: 1 as const, days: [
      day({ idx: 0, day_offset: 0, kind: 'cardio', blocks: [{ exercise_slug: 'rower', mev: 0, mav: 0, target_reps_low: 0, target_reps_high: 0, target_rir: 0, rest_sec: 0, cardio: { target_zone: 5 } }] }),
      day({ idx: 1, day_offset: 1, kind: 'strength', blocks: [{ exercise_slug: 'sq', mev: 4, mav: 8, target_reps_low: 4, target_reps_high: 6, target_rir: 1, rest_sec: 240, movement_pattern: 'squat' }] }),
    ]} as ProgramTemplateStructure;
    const w = validateCardioScheduling(structure);
    expect(w.some(x => x.code === 'hiit_day_before_heavy_lower')).toBe(true);
  });
  it('does NOT warn: Z2 same day as heavy lower', () => {
    const structure = { _v: 1 as const, days: [
      day({ idx: 0, day_offset: 0, kind: 'hybrid', blocks: [
        { exercise_slug: 'sq', mev: 4, mav: 8, target_reps_low: 4, target_reps_high: 6, target_rir: 1, rest_sec: 240, movement_pattern: 'squat' },
        { exercise_slug: 'walk', mev: 0, mav: 0, target_reps_low: 0, target_reps_high: 0, target_rir: 0, rest_sec: 0, cardio: { target_zone: 2, target_duration_sec: 1500 } },
      ]}),
    ]} as ProgramTemplateStructure;
    const w = validateCardioScheduling(structure);
    expect(w.length).toBe(0);
  });
  it('warns: Z4/Z5 same day as heavy lower (interference)', () => {
    const structure = { _v: 1 as const, days: [
      day({ idx: 0, day_offset: 0, kind: 'hybrid', blocks: [
        { exercise_slug: 'sq', mev: 4, mav: 8, target_reps_low: 4, target_reps_high: 6, target_rir: 1, rest_sec: 240, movement_pattern: 'squat' },
        { exercise_slug: 'rower', mev: 0, mav: 0, target_reps_low: 0, target_reps_high: 0, target_rir: 0, rest_sec: 0, cardio: { target_zone: 4 } },
      ]}),
    ]} as ProgramTemplateStructure;
    const w = validateCardioScheduling(structure);
    expect(w.some(x => x.code === 'cardio_interval_too_close')).toBe(true);
  });
});
