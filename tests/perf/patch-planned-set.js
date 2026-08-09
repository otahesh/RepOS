import http from 'k6/http';
import {
  BASE_URL, authHeaders, expectOk, IDS,
  steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
} from './lib/common.js';
import { BUDGETS } from './lib/budgets.js';

const KEY = 'PATCH /api/planned-sets/:id';
const BUDGET = BUDGETS[KEY].p95;
const TAG = 'patchplannedset';

export const options = {
  scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
  thresholds: thresholdsFor(TAG, BUDGET),
};
// Idempotent patch: re-set rest_sec to the same value every iteration so
// repeated writes don't drift the row. Body must be non-empty (Zod refine).
function hit() {
  const res = http.patch(
    `${BASE_URL}/api/planned-sets/${IDS.psId}`,
    JSON.stringify({ rest_sec: 120 }),
    { headers: authHeaders({ 'Content-Type': 'application/json' }) },
  );
  expectOk(res);
}
export function steady() { hit(); }
export function burst() { hit(); }
export const handleSummary = makeHandleSummary(KEY, BUDGET);
