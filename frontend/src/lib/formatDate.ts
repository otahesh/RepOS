// frontend/src/lib/formatDate.ts
// The canonical home for display date formatters (2026-07-13 quality pass).
//
// Small-icu-safe discipline (project_alpine_smallicu): production Node is
// Alpine small-icu, which ignores locale tags and reshapes `.format()`'s
// layout (MM/DD/YYYY fallback). Every formatter here assembles its label from
// `formatToParts` fields instead of trusting `.format()`, so output reads the
// same regardless of the runtime ICU build. New date labels belong here —
// don't reach for `toLocaleDateString` in components.

function parts(fmt: Intl.DateTimeFormat, d: Date): Record<string, string> {
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
}

// "Jul 5" (or "Jul 5, 2026" with { year: true }) in the runtime's local zone —
// the shared shape for chart ticks, token dates, and integration rows.
export function formatShortDate(d: Date, opts: { year?: boolean } = {}): string {
  const p = parts(
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: opts.year ? 'numeric' : undefined,
    }),
    d,
  );
  return opts.year ? `${p.month} ${p.day}, ${p.year}` : `${p.month} ${p.day}`;
}

// "Sun, Jul 5" — short weekday prefix (Topbar's masthead date).
export function formatWeekdayShortDate(d: Date): string {
  const p = parts(
    new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    d,
  );
  return `${p.weekday}, ${p.month} ${p.day}`;
}

// "Sunday, Jul 5" — long weekday, tz-independent (the date is a bare calendar
// day, read as UTC midnight so no local shift moves it). Used by the desktop
// backfill toast copy.
export function formatBackfillDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const p = parts(
    new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    d,
  );
  return `${p.weekday}, ${p.month} ${p.day}`;
}

// "Jul 5" / "Jul 5, 2025" for a bare YYYY-MM-DD session date, read in UTC so
// no local shift moves the day. Year appears only when the session isn't from
// the current year.
export function formatSessionDate(dateStr: string, now: Date = new Date()): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const includeYear = d.getUTCFullYear() !== now.getUTCFullYear();
  const p = parts(
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: includeYear ? 'numeric' : undefined,
      timeZone: 'UTC',
    }),
    d,
  );
  return includeYear ? `${p.month} ${p.day}, ${p.year}` : `${p.month} ${p.day}`;
}

// "Jul 5" / "Jul 5, 2025" for an ISO instant, rendered in an explicit IANA
// zone. Year appears only when it differs from the current year in that zone.
export function formatZonedDate(iso: string, tz: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const yearOf = (at: Date): string | undefined =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: tz })
      .formatToParts(at)
      .find((p) => p.type === 'year')?.value;
  const includeYear = yearOf(d) !== yearOf(now);
  const p = parts(
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: includeYear ? 'numeric' : undefined,
      timeZone: tz,
    }),
    d,
  );
  return includeYear ? `${p.month} ${p.day}, ${p.year}` : `${p.month} ${p.day}`;
}
