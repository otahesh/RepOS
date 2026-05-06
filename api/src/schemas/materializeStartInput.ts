import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIanaTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidCalendarDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y
    && dt.getUTCMonth() === m - 1
    && dt.getUTCDate() === d;
}

export const MaterializeStartInputSchema = z.object({
  start_date: z.string()
    .regex(ISO_DATE_RE, 'start_date must be YYYY-MM-DD')
    .refine(isValidCalendarDate, { message: 'invalid calendar date' })
    .refine(s => {
      const oneYearOut = new Date();
      oneYearOut.setUTCFullYear(oneYearOut.getUTCFullYear() + 1);
      return new Date(`${s}T00:00:00Z`).getTime() <= oneYearOut.getTime();
    }, { message: 'start_date must be within 1 year from today' }),
  start_tz: z.string()
    .min(1)
    .refine(isValidIanaTz, { message: 'unknown IANA timezone' }),
});

export type MaterializeStartInput = z.infer<typeof MaterializeStartInputSchema>;
