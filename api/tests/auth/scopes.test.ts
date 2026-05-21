import { describe, it, expect } from 'vitest';
import { VALID_SCOPES, isValidScope, hasScope } from '../../src/auth/scopes.js';

describe('auth/scopes', () => {
  it('VALID_SCOPES contains all v1 scopes', () => {
    expect(VALID_SCOPES).toContain('health:weight:write');
    expect(VALID_SCOPES).toContain('program:write');
    expect(VALID_SCOPES).toContain('health:workouts:write');
  });

  it('isValidScope accepts known scopes, rejects unknown', () => {
    expect(isValidScope('program:write')).toBe(true);
    expect(isValidScope('health:weight:write')).toBe(true);
    expect(isValidScope('health:workouts:write')).toBe(true);
    expect(isValidScope('admin:everything')).toBe(false);
    expect(isValidScope('')).toBe(false);
  });

  it('hasScope checks an array of granted scopes against a required one', () => {
    expect(hasScope(['program:write'], 'program:write')).toBe(true);
    expect(hasScope(['health:weight:write'], 'program:write')).toBe(false);
    expect(hasScope([], 'program:write')).toBe(false);
    expect(hasScope(['health:weight:write', 'program:write'], 'program:write')).toBe(true);
  });
});
