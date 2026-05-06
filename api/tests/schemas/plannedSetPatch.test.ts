import { describe, it, expect } from 'vitest';
import { PlannedSetPatchSchema } from '../../src/schemas/plannedSetPatch.js';

describe('PlannedSetPatchSchema', () => {
  it('accepts override that lifts target_rir to 1', () => {
    const r = PlannedSetPatchSchema.safeParse({
      target_rir: 1, override_reason: 'beat-up today',
    });
    expect(r.success).toBe(true);
  });

  it('rejects override with target_rir = 0', () => {
    const r = PlannedSetPatchSchema.safeParse({ target_rir: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects override with target_reps_low > target_reps_high', () => {
    const r = PlannedSetPatchSchema.safeParse({
      target_reps_low: 12, target_reps_high: 5,
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty patch', () => {
    const r = PlannedSetPatchSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('accepts partial — just rest_sec', () => {
    const r = PlannedSetPatchSchema.safeParse({ rest_sec: 240 });
    expect(r.success).toBe(true);
  });

  it('rejects rest_sec > 900', () => {
    const r = PlannedSetPatchSchema.safeParse({ rest_sec: 901 });
    expect(r.success).toBe(false);
  });

  it('rejects override_reason > 200 chars', () => {
    const r = PlannedSetPatchSchema.safeParse({
      target_rir: 1,
      override_reason: 'x'.repeat(201),
    });
    expect(r.success).toBe(false);
  });
});
