import { describe, it, expect } from 'vitest';
import {
  INJURY_JOINTS,
  INJURY_SEVERITIES,
  UserInjuryUpsertRequestSchema,
  UserInjuryItemSchema,
} from '../../src/schemas/userInjuries.js';

describe('userInjuries schemas', () => {
  it('exports the 7-key joint enum', () => {
    expect(INJURY_JOINTS).toEqual([
      'shoulder_left','shoulder_right','low_back',
      'knee_left','knee_right','elbow','wrist',
    ]);
  });

  it('exports the 3-tier severity enum', () => {
    expect(INJURY_SEVERITIES).toEqual(['low','mod','high']);
  });

  it('UserInjuryUpsertRequestSchema accepts a valid payload', () => {
    const res = UserInjuryUpsertRequestSchema.safeParse({
      joint: 'knee_left', severity: 'mod', notes: 'meniscus', onset_at: '2026-02-15',
    });
    expect(res.success).toBe(true);
  });

  it('UserInjuryUpsertRequestSchema rejects unknown joint', () => {
    const res = UserInjuryUpsertRequestSchema.safeParse({ joint: 'ankle', severity: 'mod' });
    expect(res.success).toBe(false);
  });

  it('UserInjuryUpsertRequestSchema defaults severity=mod, notes=empty when omitted', () => {
    const res = UserInjuryUpsertRequestSchema.parse({ joint: 'knee_left' });
    expect(res.severity).toBe('mod');
    expect(res.notes).toBe('');
  });

  it('UserInjuryItemSchema requires created_at + updated_at as ISO strings', () => {
    const res = UserInjuryItemSchema.safeParse({
      joint: 'wrist', severity: 'low', notes: '', onset_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    expect(res.success).toBe(true);
  });
});
