import http from 'k6/http';
import exec from 'k6/execution';
import {
  BASE_URL, authHeaders, expectOk,
  steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
} from './lib/common.js';
import { BUDGETS } from './lib/budgets.js';

// Rate-limit: >5 writes per (user, date) -> 409 (api/src/routes/weight.ts:54).
// Dedupe: same (user, date, source) within 0.05 lb -> 200 deduped:true.
// To measure the true insert path we give iterations a near-unique date keyed
// off exec.scenario.iterationInTest (globally unique per iteration WITHIN a
// scenario) plus a per-scenario base offset so steady and burst never overlap
// on the shared user. This eliminates the prior `(__VU*100000+__ITER)%9000`
// bug, which collapsed to only 9 residues (100000%9000==1000) and so mapped 50
// burst VUs onto ~9 dates, self-inflicting 409s. Under sustained single-user
// burst some dates may still repeat once the per-scenario 4500-day window
// wraps; those yield EXPECTED 409s, which are now excluded from the 5xx failure
// metric (see common.js response callback) and tolerated by the expectOk(409)
// check below. 'source' stays 'Apple Health'. Requires the health:weight:write
// scope on the token (the only scope-gated endpoint).
const KEY = 'POST /api/health/weight';
const BUDGET = BUDGETS[KEY].p95;
const TAG = 'weightpost';

export const options = {
  scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
  thresholds: thresholdsFor(TAG, BUDGET),
};
function uniqueDate() {
  // Key the day-offset on exec.scenario.iterationInTest (unique per iteration
  // within a scenario), plus a per-scenario base so steady (0..) and burst
  // (4500..) walk disjoint windows on the shared user. Clamp to ~24 years so
  // the date stays valid; see header for the collision/409 contract.
  const base = exec.scenario.name.indexOf('burst') >= 0 ? 4500 : 0;
  const offset = (base + exec.scenario.iterationInTest) % 9000;
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
