// api/tests/userLocalDate.test.ts
import { describe, it, expect } from 'vitest';
import { computeUserLocalDate } from '../src/services/userLocalDate.js';

describe('computeUserLocalDate (spec §3.3)', () => {
  it('returns YYYY-MM-DD in the supplied tz', () => {
    // 2026-05-04T03:00:00Z is 2026-05-03 in Los_Angeles (UTC-7 PDT)
    expect(computeUserLocalDate('America/Los_Angeles', new Date('2026-05-04T03:00:00Z')))
      .toBe('2026-05-03');
    // same instant is 2026-05-04 in UTC
    expect(computeUserLocalDate('UTC', new Date('2026-05-04T03:00:00Z')))
      .toBe('2026-05-04');
  });

  it('DST spring-forward day still resolves once', () => {
    // 2026-03-08 02:00 local NY is the spring-forward; both sides of the gap
    // resolve to a defined date string and never throw.
    const before = new Date('2026-03-08T06:00:00Z'); // 01:00 EST (before jump)
    const after  = new Date('2026-03-08T08:00:00Z'); // 04:00 EDT (after jump)
    expect(computeUserLocalDate('America/New_York', before)).toBe('2026-03-08');
    expect(computeUserLocalDate('America/New_York', after)).toBe('2026-03-08');
  });

  it('DST fall-back day still resolves once', () => {
    // 2026-11-01 02:00 NY falls back to 01:00 EST. The 01:30 hour exists twice;
    // both must resolve to 2026-11-01.
    const first  = new Date('2026-11-01T05:30:00Z'); // 01:30 EDT
    const second = new Date('2026-11-01T06:30:00Z'); // 01:30 EST
    expect(computeUserLocalDate('America/New_York', first)).toBe('2026-11-01');
    expect(computeUserLocalDate('America/New_York', second)).toBe('2026-11-01');
  });

  it('leap year: Feb 29 → Mar 1 boundary', () => {
    expect(computeUserLocalDate('UTC', new Date('2028-02-29T12:00:00Z'))).toBe('2028-02-29');
    expect(computeUserLocalDate('UTC', new Date('2028-03-01T00:00:00Z'))).toBe('2028-03-01');
  });

  it('TZ change behavior: caller passes start_tz, not current tz', () => {
    // Same instant interpreted under two zones gives two different dates.
    const ts = new Date('2026-05-04T01:30:00Z');
    expect(computeUserLocalDate('America/Los_Angeles', ts)).toBe('2026-05-03');
    expect(computeUserLocalDate('Europe/Berlin', ts)).toBe('2026-05-04');
  });

  it('throws on invalid IANA tz', () => {
    expect(() => computeUserLocalDate('Mars/Olympus', new Date())).toThrow();
  });
});
