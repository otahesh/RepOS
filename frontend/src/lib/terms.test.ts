import { describe, it, expect } from 'vitest';
import { TERMS, type TermKey } from './terms';

const ALL_KEYS: TermKey[] = [
  'RIR','RPE','MEV','MAV','MRV','mesocycle','deload','hypertrophy','AMRAP',
  'Z2','Z4','Z5','peak_tension_length','push_horizontal','pull_horizontal',
  'push_vertical','pull_vertical','hinge','squat','lunge','carry','rotation',
  'anti_rotation','compound','isolation','accumulation','working_set',
  'PAT','bearer_token','session','IANA_timezone','truncated_ip_24',
];

describe('TERMS dictionary', () => {
  it('has every required key', () => {
    for (const k of ALL_KEYS) expect(TERMS[k]).toBeDefined();
  });
  it('has exactly the required keys (no silent additions)', () => {
    expect(Object.keys(TERMS).length).toBe(ALL_KEYS.length);
  });
  it('every entry has non-empty short/full/plain/whyMatters', () => {
    for (const [k, v] of Object.entries(TERMS)) {
      expect(v.short, `${k}.short`).toMatch(/\S/);
      expect(v.full, `${k}.full`).toMatch(/\S/);
      expect(v.plain.length, `${k}.plain`).toBeGreaterThan(20);
      expect(v.whyMatters.length, `${k}.whyMatters`).toBeGreaterThan(20);
    }
  });
  it('full forms are unique', () => {
    const fulls = Object.values(TERMS).map(t => t.full.toLowerCase());
    expect(new Set(fulls).size).toBe(fulls.length);
  });
});

describe('W6 term additions', () => {
  it.each(['PAT','bearer_token','session','IANA_timezone','truncated_ip_24'] as const)('has TERMS entry for %s', (k) => {
    expect(TERMS[k as keyof typeof TERMS]).toBeDefined();
    expect(TERMS[k as keyof typeof TERMS].short.length).toBeGreaterThan(0);
    expect(TERMS[k as keyof typeof TERMS].plain.length).toBeGreaterThan(0);
  });
});
