import { describe, it, expect } from 'vitest';
import { UserProgramPatchSchema } from '../../src/schemas/userProgramPatch.js';

describe('UserProgramPatchSchema', () => {
  it('accepts rename', () => {
    const r = UserProgramPatchSchema.safeParse({ op: 'rename', name: 'My PPL' });
    expect(r.success).toBe(true);
  });

  it('rejects rename with empty string', () => {
    const r = UserProgramPatchSchema.safeParse({ op: 'rename', name: '' });
    expect(r.success).toBe(false);
  });

  it('accepts swap_exercise', () => {
    const r = UserProgramPatchSchema.safeParse({
      op: 'swap_exercise',
      day_idx: 0,
      block_idx: 1,
      to_exercise_slug: 'dumbbell-incline-press',
    });
    expect(r.success).toBe(true);
  });

  it('accepts add_set / remove_set', () => {
    expect(UserProgramPatchSchema.safeParse({
      op: 'add_set', day_idx: 0, block_idx: 0,
    }).success).toBe(true);
    expect(UserProgramPatchSchema.safeParse({
      op: 'remove_set', day_idx: 0, block_idx: 0,
    }).success).toBe(true);
  });

  it('accepts change_rir for week', () => {
    const r = UserProgramPatchSchema.safeParse({
      op: 'change_rir', week_idx: 2, day_idx: 0, block_idx: 0, target_rir: 1,
    });
    expect(r.success).toBe(true);
  });

  it('rejects change_rir target_rir = 0', () => {
    const r = UserProgramPatchSchema.safeParse({
      op: 'change_rir', week_idx: 2, day_idx: 0, block_idx: 0, target_rir: 0,
    });
    expect(r.success).toBe(false);
  });

  it('accepts shift_weekday', () => {
    const r = UserProgramPatchSchema.safeParse({
      op: 'shift_weekday', day_idx: 0, to_day_offset: 2,
    });
    expect(r.success).toBe(true);
  });

  it('rejects shift_weekday to_day_offset > 6', () => {
    const r = UserProgramPatchSchema.safeParse({
      op: 'shift_weekday', day_idx: 0, to_day_offset: 7,
    });
    expect(r.success).toBe(false);
  });

  it('accepts skip_day', () => {
    const r = UserProgramPatchSchema.safeParse({
      op: 'skip_day', week_idx: 1, day_idx: 0,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown op', () => {
    const r = UserProgramPatchSchema.safeParse({ op: 'time_travel' });
    expect(r.success).toBe(false);
  });
});
