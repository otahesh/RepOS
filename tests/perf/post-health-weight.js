import http from 'k6/http';
import {
  BASE_URL, authHeaders, expectOk,
  steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
} from './lib/common.js';
import { BUDGETS } from './lib/budgets.js';

// Rate-limit: >5 writes per (user, date) -> 409 (api/src/routes/weight.ts:54).
// Dedupe: same (user, date, source) within 0.05 lb -> 200 deduped:true.
// To measure the true insert path we give every iteration a UNIQUE date keyed
// off __VU/__ITER, walking backwards from today, so no (user,date) sees >1
// write. 'source' stays 'Apple Health'. Requires the health:weight:write scope
// on the token (the only scope-gated endpoint).
const KEY = 'POST /api/health/weight';
const BUDGET = BUDGETS[KEY].p95;
const TAG = 'weightpost';

export const options = {
  scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
  thresholds: thresholdsFor(TAG, BUDGET),
};
function uniqueDate() {
  // Distinct (VU,ITER) -> distinct day offset; clamp to the last ~25 years so
  // the date stays valid and never collides across the run.
  const offset = (__VU * 100000 + __ITER) % 9000;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
function hit() {
  const res = http.post(
    `${BASE_URL}/api/health/weight`,
    // time must be HH:MM:SS (api/src/schemas/healthWeight.ts TIME_RE), not HH:MM.
    JSON.stringify({ weight_lbs: 185.5, date: uniqueDate(), time: '06:30:00', source: 'Apple Health' }),
    { headers: authHeaders({ 'Content-Type': 'application/json' }) },
  );
  expectOk(res, [409]); // tolerate rare 409 if a date ever repeats
}
export function steady() { hit(); }
export function burst() { hit(); }
export const handleSummary = makeHandleSummary(KEY, BUDGET);
