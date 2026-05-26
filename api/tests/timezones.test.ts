// Per I-IANA-TIMEZONES — guard rails for the static IANA list shipped to
// production. The Alpine small-icu nodejs build can't be trusted for
// Intl.supportedValuesOf('timeZone'), so this list IS the prod source of
// truth.
//
// Asserts:
//   - Non-empty and includes a baseline of well-known zones we depend on
//     (UTC + the four contiguous US zones + a sampling of other continents).
//   - No duplicates.
//   - Set parity with the frontend mirror is enforced by
//     `scripts/check-tz-sync.mjs` (run from `npm run validate`); this file
//     adds a smoke-level confirmation by re-running the parity check inline.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IANA_TIMEZONES } from '../src/lib/timezones.js';

function loadFrontendZones(): Set<string> {
  const src = readFileSync(
    resolve(import.meta.dirname, '../../frontend/src/lib/timezones.ts'),
    'utf8',
  );
  const matches = src.match(/'[A-Z][A-Za-z_]+(?:\/[A-Za-z_]+)+'/g) ?? [];
  const set = new Set(matches.map((s) => s.slice(1, -1)));
  if (/'UTC'/.test(src)) set.add('UTC');
  return set;
}

describe('IANA_TIMEZONES static list', () => {
  it('is non-empty', () => {
    expect(IANA_TIMEZONES.length).toBeGreaterThan(50);
  });

  it('includes UTC and the four contiguous-US zones', () => {
    const set = new Set(IANA_TIMEZONES);
    for (const z of [
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
    ]) {
      expect(set.has(z)).toBe(true);
    }
  });

  it('includes a sample of zones from each major continent', () => {
    const set = new Set(IANA_TIMEZONES);
    for (const z of [
      'Europe/London',
      'Asia/Tokyo',
      'Australia/Sydney',
      'Africa/Cairo',
      'America/Sao_Paulo',
      'Pacific/Auckland',
    ]) {
      expect(set.has(z)).toBe(true);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(IANA_TIMEZONES).size).toBe(IANA_TIMEZONES.length);
  });

  it('matches the frontend mirror exactly (set parity)', () => {
    const api = new Set(IANA_TIMEZONES);
    const fe = loadFrontendZones();
    expect(api.size).toBe(fe.size);
    for (const z of api) expect(fe.has(z)).toBe(true);
    for (const z of fe) expect(api.has(z)).toBe(true);
  });
});
