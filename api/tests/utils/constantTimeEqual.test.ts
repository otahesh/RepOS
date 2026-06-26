import { describe, it, expect } from 'vitest';
import { constantTimeEqual } from '../../src/utils/constantTimeEqual.js';

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('s3cret-admin-key', 's3cret-admin-key')).toBe(true);
  });

  it('returns false for equal-length strings differing in one byte', () => {
    expect(constantTimeEqual('s3cret-admin-key', 's3cret-admin-keY')).toBe(false);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(constantTimeEqual('short', 'a-much-longer-secret-value')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});
