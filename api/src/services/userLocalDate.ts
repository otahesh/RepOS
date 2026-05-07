// api/src/services/userLocalDate.ts
// Pure helper. Uses Intl.DateTimeFormat.formatToParts so the YYYY-MM-DD
// output is locale-independent — the runtime Node in our Alpine image
// ships with small-icu (English-only), which means `format()` ignores
// locales like 'en-CA' or 'sv-SE' and falls back to the default
// 'MM/DD/YYYY' shape. That made the old implementation produce
// '05/07/2026' in production, which then string-compared as < the
// to_char('YYYY-MM-DD') start_date and made getTodayWorkout
// silently return no_active_run for every active mesocycle.
// formatToParts returns structured tokens regardless of ICU build, so
// reading year/month/day fields and joining them with dashes is safe
// on every Node configuration.
// No deps. DST + leap-year + TZ-change correct.

const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = FMT_CACHE.get(tz);
  if (!f) {
    // Will throw RangeError on invalid IANA tz — that's the contract.
    f = new Intl.DateTimeFormat('en-US', {
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
  const parts = fmtFor(tz).formatToParts(now);
  let y = '', m = '', d = '';
  for (const p of parts) {
    if (p.type === 'year') y = p.value;
    else if (p.type === 'month') m = p.value;
    else if (p.type === 'day') d = p.value;
  }
  return `${y}-${m}-${d}`;
}
