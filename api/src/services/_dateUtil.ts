// Pure UTC-anchored date arithmetic on YYYY-MM-DD strings.
// Caller has already mapped tz-local "start of day" → this ISO date string,
// so simple UTC add is safe.
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
