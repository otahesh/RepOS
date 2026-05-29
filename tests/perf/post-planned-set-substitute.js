import http from 'k6/http';
import {
  BASE_URL, authHeaders, expectOk, IDS,
  steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
} from './lib/common.js';
import { BUDGETS } from './lib/budgets.js';

// STATE-MUTATING. Substituting flips the planned_set's exercise_id. Safe to
// hammer because it sets exercise_id to SUB_EX_ID every iteration (converges,
// does not drift). Off by default against prod — opt in per README.
const KEY = 'POST /api/planned-sets/:id/substitute';
const BUDGET = BUDGETS[KEY].p95;
const TAG = 'substitute';

export const options = {
  scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
  thresholds: thresholdsFor(TAG, BUDGET),
};
function hit() {
  const res = http.post(
    `${BASE_URL}/api/planned-sets/${IDS.psId}/substitute`,
    JSON.stringify({ to_exercise_id: IDS.subExId }),
    { headers: authHeaders({ 'Content-Type': 'application/json' }) },
  );
  expectOk(res, [409]); // 409 if the day already passed / non-substitutable state
}
export function steady() { hit(); }
export function burst() { hit(); }
export const handleSummary = makeHandleSummary(KEY, BUDGET);
