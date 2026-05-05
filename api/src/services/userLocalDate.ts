// api/src/services/userLocalDate.ts
// Pure helper. Uses Intl.DateTimeFormat + en-CA locale (which formats as
// YYYY-MM-DD natively). No deps. DST + leap-year + TZ-change correct.

const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = FMT_CACHE.get(tz);
  if (!f) {
    // Will throw RangeError on invalid IANA tz — that's the contract.
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    FMT_CACHE.set(tz, f);
  }
  return f;
}

/**
 * Return the user's local calendar date as YYYY-MM-DD for a given tz at
 * a given UTC instant (default: now). DST-correct and leap-year-correct
 * because Intl resolves the wall-clock date for the supplied tz.
 */
export function computeUserLocalDate(tz: string, now: Date = new Date()): string {
  return fmtFor(tz).format(now);
}
