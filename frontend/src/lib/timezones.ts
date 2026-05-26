// Mirror of api/src/lib/timezones.ts. Keep in sync at PR time;
// AccountProfileEditor + any other tz UI imports from here.
//
// Per memory project_alpine_smallicu, we can't rely on
// Intl.supportedValuesOf on the prod runtime — and the same logic applies to
// the frontend bundle: shipping a static list keeps the dropdown source of
// truth in code review, not in a runtime quirk that varies by browser.
//
// SYNC: Must stay identical to api/src/lib/timezones.ts. Verified by
// scripts/check-tz-sync.mjs at PR time.

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
