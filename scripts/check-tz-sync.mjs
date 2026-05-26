#!/usr/bin/env node
// Per I-IANA-TIMEZONES — fail the build if api/src/lib/timezones.ts and
// frontend/src/lib/timezones.ts drift apart. Both files ship the same static
// IANA list as a workaround for Alpine's small-icu nodejs build, which
// returns a degenerate Intl.supportedValuesOf('timeZone') list.
//
// Run: `node scripts/check-tz-sync.mjs`
// Exit codes: 0 = identical sets, 1 = drift detected.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const apiPath = resolve(repoRoot, 'api/src/lib/timezones.ts');
const fePath = resolve(repoRoot, 'frontend/src/lib/timezones.ts');

/**
 * Pull single-quoted IANA zone strings out of a TS source file. The list
 * literal is the only place quoted strings shaped like `Region/City` appear,
 * so a regex on the file is good enough — no TS parser dependency.
 */
function extractZones(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const matches = src.match(/'[A-Z][A-Za-z_]+(?:\/[A-Za-z_]+)+'/g) ?? [];
  const set = new Set(matches.map((s) => s.slice(1, -1)));
  // The literal 'UTC' (no slash) is the only special case.
  if (/'UTC'/.test(src)) set.add('UTC');
  return set;
}

const apiZones = extractZones(apiPath);
const feZones = extractZones(fePath);

const onlyApi = [...apiZones].filter((z) => !feZones.has(z)).sort();
const onlyFe = [...feZones].filter((z) => !apiZones.has(z)).sort();

if (onlyApi.length === 0 && onlyFe.length === 0) {
  console.log(
    `check-tz-sync: OK — both files share ${apiZones.size} IANA zones.`,
  );
  process.exit(0);
}

console.error('check-tz-sync: DRIFT detected.');
if (onlyApi.length) {
  console.error(`  Only in api/src/lib/timezones.ts (${onlyApi.length}):`);
  for (const z of onlyApi) console.error(`    - ${z}`);
}
if (onlyFe.length) {
  console.error(`  Only in frontend/src/lib/timezones.ts (${onlyFe.length}):`);
  for (const z of onlyFe) console.error(`    - ${z}`);
}
process.exit(1);
