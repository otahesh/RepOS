import { describe, it, expect } from 'vitest';
import { MaterializeStartInputSchema } from '../../src/schemas/materializeStartInput.js';

describe('MaterializeStartInputSchema', () => {
  it('accepts a valid IANA TZ + ISO date', () => {
    const r = MaterializeStartInputSchema.safeParse({
      start_date: '2026-05-04',
      start_tz: 'America/New_York',
    });
    expect(r.success).toBe(true);
  });

  it('rejects bad date format', () => {
    const r = MaterializeStartInputSchema.safeParse({
      start_date: '5/4/26',
      start_tz: 'America/New_York',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown IANA TZ', () => {
    const r = MaterializeStartInputSchema.safeParse({
      start_date: '2026-05-04',
      start_tz: 'Mars/Olympus',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/timezone|tz/i);
    }
  });

  it('rejects calendar-invalid date (Feb 30)', () => {
    const r = MaterializeStartInputSchema.safeParse({
      start_date: '2026-02-30',
      start_tz: 'UTC',
    });
    expect(r.success).toBe(false);
  });

  it('rejects start_date > 1 year in the future', () => {
    const r = MaterializeStartInputSchema.safeParse({
      start_date: '2030-05-04',
      start_tz: 'UTC',
    });
    expect(r.success).toBe(false);
  });
});
