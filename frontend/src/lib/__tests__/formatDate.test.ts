import { describe, it, expect } from 'vitest';
import {
  formatShortDate,
  formatWeekdayShortDate,
  formatBackfillDate,
  formatSessionDate,
  formatZonedDate,
} from '../formatDate';

describe('formatDate lib', () => {
  it('formatShortDate renders "Mon D" and "Mon D, YYYY" with year', () => {
    const d = new Date(2026, 6, 5); // local Jul 5 2026
    expect(formatShortDate(d)).toBe('Jul 5');
    expect(formatShortDate(d, { year: true })).toBe('Jul 5, 2026');
  });

  it('formatWeekdayShortDate renders "Ddd, Mon D"', () => {
    expect(formatWeekdayShortDate(new Date(2026, 6, 5))).toBe('Sun, Jul 5');
  });

  it('formatBackfillDate reads the bare date in UTC (no local shift)', () => {
    expect(formatBackfillDate('2026-07-05')).toBe('Sunday, Jul 5');
  });

  it('formatSessionDate includes the year only for non-current years', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    expect(formatSessionDate('2026-07-05', now)).toBe('Jul 5');
    expect(formatSessionDate('2025-12-31', now)).toBe('Dec 31, 2025');
  });

  it('formatZonedDate localizes the instant to the given zone', () => {
    const now = new Date('2026-07-13T12:00:00Z');
    // 2026-07-06 03:00 UTC is still Jul 5 in Los Angeles.
    expect(formatZonedDate('2026-07-06T03:00:00Z', 'America/Los_Angeles', now)).toBe('Jul 5');
    expect(formatZonedDate('2026-07-06T03:00:00Z', 'UTC', now)).toBe('Jul 6');
    // Year shown when it differs from the current year in that zone.
    expect(formatZonedDate('2025-07-06T03:00:00Z', 'UTC', now)).toBe('Jul 6, 2025');
  });
});
