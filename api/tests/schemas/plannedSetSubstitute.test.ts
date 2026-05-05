import { describe, it, expect } from 'vitest';
import { PlannedSetSubstituteSchema } from '../../src/schemas/plannedSetSubstitute.js';

describe('PlannedSetSubstituteSchema', () => {
  it('accepts a valid substitution', () => {
    const r = PlannedSetSubstituteSchema.safeParse({
      to_exercise_slug: 'dumbbell-bench-press',
      reason: 'no-barbell',
    });
    expect(r.success).toBe(true);
  });

  it('accepts substitution without reason', () => {
    const r = PlannedSetSubstituteSchema.safeParse({
      to_exercise_slug: 'dumbbell-bench-press',
    });
    expect(r.success).toBe(true);
  });

  it('rejects bad slug', () => {
    const r = PlannedSetSubstituteSchema.safeParse({
      to_exercise_slug: 'Dumbbell Bench Press',
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing to_exercise_slug', () => {
    const r = PlannedSetSubstituteSchema.safeParse({ reason: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects scope outside today|future_in_meso', () => {
    const r = PlannedSetSubstituteSchema.safeParse({
      to_exercise_slug: 'dumbbell-bench-press',
      scope: 'forever',
    });
    expect(r.success).toBe(false);
  });

  it('accepts scope=today (default)', () => {
    const r = PlannedSetSubstituteSchema.safeParse({
      to_exercise_slug: 'dumbbell-bench-press',
      scope: 'today',
    });
    expect(r.success).toBe(true);
  });

  it('rejects reason > 200 chars', () => {
    const r = PlannedSetSubstituteSchema.safeParse({
      to_exercise_slug: 'x',
      reason: 'y'.repeat(201),
    });
    expect(r.success).toBe(false);
  });
});
