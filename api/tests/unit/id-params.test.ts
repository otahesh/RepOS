import { describe, it, expect } from 'vitest';
import { UuidParamSchema, isValidBigintId } from '../../src/schemas/idParams.js';

describe('UuidParamSchema', () => {
  it('accepts a real v4 UUID', () => {
    const r = UuidParamSchema.safeParse({ id: '11111111-2222-4333-8444-555555555555' });
    expect(r.success).toBe(true);
  });
  it('rejects a non-UUID string', () => {
    const r = UuidParamSchema.safeParse({ id: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });
  it('rejects an empty id', () => {
    const r = UuidParamSchema.safeParse({ id: '' });
    expect(r.success).toBe(false);
  });
});

describe('isValidBigintId', () => {
  it('accepts a positive integer string', () => { expect(isValidBigintId('42')).toBe(true); });
  it('rejects a non-numeric string', () => { expect(isValidBigintId('abc')).toBe(false); });
  it('rejects zero and negatives', () => {
    expect(isValidBigintId('0')).toBe(false);
    expect(isValidBigintId('-1')).toBe(false);
  });
  it('rejects values beyond bigint max (would throw 22003 on the DB)', () => {
    expect(isValidBigintId('100000000000000000000000')).toBe(false);
  });
});
