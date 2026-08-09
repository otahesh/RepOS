import http from 'k6/http';
import {
  BASE_URL, authHeaders, expectOk, IDS,
  steadyScenario, burstScenario, thresholdsFor, makeHandleSummary,
} from './lib/common.js';
import { BUDGETS } from './lib/budgets.js';

// COLD, DESTRUCTIVE. POST /start materializes an entire mesocycle and a
// user_program can only be started once (409 'already_started' after the
// first). Hammering one UP_ID therefore yields one 201 then 409s — which is a
// VALID latency sample for the cold materialize path (the 409 still exercises
// the SERIALIZABLE ownership tx). README: for a true throughput number, seed N
// draft user_programs and pass a comma list; v1 measures the single-start cost.
const KEY = 'POST /api/user-programs/:id/start';
const BUDGET = BUDGETS[KEY].p95;
const TAG = 'programstart';

export const options = {
  scenarios: { ...steadyScenario(TAG), ...burstScenario(TAG) },
  thresholds: thresholdsFor(TAG, BUDGET),
};
function hit() {
  const today = new Date().toISOString().slice(0, 10);
  const res = http.post(
    `${BASE_URL}/api/user-programs/${IDS.upId}/start`,
    JSON.stringify({ start_date: today, start_tz: 'America/Indiana/Indianapolis' }),
    { headers: authHeaders({ 'Content-Type': 'application/json' }) },
  );
  expectOk(res, [409]); // already_started after the first 201
}
export function steady() { hit(); }
export function burst() { hit(); }
export const handleSummary = makeHandleSummary(KEY, BUDGET);
