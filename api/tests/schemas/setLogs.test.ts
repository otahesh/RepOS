import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { SetLogPostSchema, SetLogPatchSchema } from '../../src/schemas/setLogs.js';

const base = () => ({
  client_request_id: randomUUID(),
  planned_set_id: randomUUID(),
  performed_at: new Date().toISOString(),
});

describe('SetLogPostSchema — measurement model', () => {
  it('accepts a reps log (existing shape unchanged)', () => {
    const r = SetLogPostSchema.safeParse({ ...base(), weight_lbs: 185, reps: 8, rir: 2 });
    expect(r.success).toBe(true);
  });

  it('accepts a duration-only log (no reps)', () => {
    const r = SetLogPostSchema.safeParse({ ...base(), duration_sec: 42 });
    expect(r.success).toBe(true);
  });

  it('accepts a weighted hold (duration + load)', () => {
    const r = SetLogPostSchema.safeParse({ ...base(), duration_sec: 40, weight_lbs: 70, rir: 2 });
    expect(r.success).toBe(true);
  });

  it('rejects a log with neither reps nor duration_sec', () => {
    // Rollback-skew + junk-row guard: a set log must measure SOMETHING.
    const r = SetLogPostSchema.safeParse({ ...base(), weight_lbs: 100 });
    expect(r.success).toBe(false);
  });

  it('rejects duration_sec out of range', () => {
    expect(SetLogPostSchema.safeParse({ ...base(), duration_sec: 0 }).success).toBe(false);
    expect(SetLogPostSchema.safeParse({ ...base(), duration_sec: 3601 }).success).toBe(false);
    expect(SetLogPostSchema.safeParse({ ...base(), duration_sec: 40.5 }).success).toBe(false);
  });
});

describe('SetLogPatchSchema — measurement model', () => {
  it('accepts a duration_sec-only patch', () => {
    const r = SetLogPatchSchema.safeParse({ duration_sec: 45 });
    expect(r.success).toBe(true);
  });

  it('still rejects an empty patch', () => {
    expect(SetLogPatchSchema.safeParse({}).success).toBe(false);
  });
});
