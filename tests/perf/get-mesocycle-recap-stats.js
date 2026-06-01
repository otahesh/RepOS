import http from 'k6/http';
import {
  BASE_URL, authHeaders, expectOk, IDS,
  steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
} from './lib/common.js';
import { BUDGETS } from './lib/budgets.js';

// PRIMARY SUSPECT. The per-exercise PR CTE in api/src/routes/mesocycles.ts:109
// is the heaviest read. COLD-CACHE DISCIPLINE: restart Postgres immediately
// before this run (README documents the command) so p95 reflects a cold plan,
// not a warmed shared-buffers cache. ND3 contingency keys off this number.
const KEY = 'GET /api/mesocycles/:id/recap-stats';
const BUDGET = BUDGETS[KEY].p95;
const TAG = 'recapstats';

export const options = {
  scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
  thresholds: thresholdsFor(TAG, BUDGET),
};
function hit() {
  expectOk(http.get(`${BASE_URL}/api/mesocycles/${IDS.mesoId}/recap-stats`, { headers: authHeaders() }));
}
export function steady() { hit(); }
export function burst() { hit(); }
export const handleSummary = makeHandleSummary(KEY, BUDGET);
