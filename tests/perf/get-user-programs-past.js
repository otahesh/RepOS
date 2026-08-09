import http from 'k6/http';
import {
  BASE_URL, authHeaders, expectOk,
  steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
} from './lib/common.js';
import { BUDGETS } from './lib/budgets.js';

const KEY = 'GET /api/user-programs?include=past';
const BUDGET = BUDGETS[KEY].p95;
const TAG = 'userprogramspast';

export const options = {
  scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
  thresholds: thresholdsFor(TAG, BUDGET),
};
function hit() {
  expectOk(http.get(`${BASE_URL}/api/user-programs?include=past`, { headers: authHeaders() }));
}
export function steady() { hit(); }
export function burst() { hit(); }
export const handleSummary = makeHandleSummary(KEY, BUDGET);
