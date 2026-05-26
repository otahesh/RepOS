// Per I-IANA-TIMEZONES + memory project_alpine_smallicu:
// Alpine apk nodejs is built against small-icu, which ignores Intl locale
// tags AND returns a degenerate Intl.supportedValuesOf('timeZone') list.
// Hard-coded canonical list ships in source so prod has the full set.
//
// Source: IANA tzdata 2024a primary zones. Sync via `tzdata --version` on
// the build host before each release.
//
// SYNC: Must stay identical to frontend/src/lib/timezones.ts.
// PR-time check: `node scripts/check-tz-sync.mjs` (run via the api validate
// script) compares both lists and fails the build on drift.

export const IANA_TIMEZONES: readonly string[] = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Adak',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Halifax',
  'America/St_Johns',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Buenos_Aires',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Stockholm',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Tehran',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Jerusalem',
  'Asia/Riyadh',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Australia/Brisbane',
  'Pacific/Auckland',
  'Pacific/Fiji',
  // Extend as cohort grows; this list is the prod authoritative source.
] as const;
