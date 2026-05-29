import http from 'k6/http';
import { check } from 'k6';

// --- Config from env (README documents these) -----------------------------
// BASE_URL   e.g. http://127.0.0.1:3001  (local)  | https://repos.jpmtech.com (prod)
// TOKEN      opaque bearer "<16hex>.<64hex>" minted via POST /api/tokens
// MESO_ID    a mesocycle_run_id owned by the token's user (for :id endpoints)
// UP_ID      a user_program_id owned by the token's user (for /start)
// PS_ID      a planned_set_id owned by the token's user (for PATCH/substitute)
// SUB_EX_ID  a candidate exercise_id for substitute
//
// Local default port is 3001: api/.env sets PORT=3001 and api/src/index.ts
// defaults to 3001. `npm run dev` therefore serves http://127.0.0.1:3001.
export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001';
export const TOKEN = __ENV.TOKEN || '';
export const IDS = {
  mesoId: __ENV.MESO_ID || '',
  upId: __ENV.UP_ID || '',
  psId: __ENV.PS_ID || '',
  subExId: __ENV.SUB_EX_ID || '',
};

export function authHeaders(extra) {
  return Object.assign(
    { Authorization: `Bearer ${TOKEN}` },
    extra || {},
  );
}

// Steady state: 25 VUs for 2 min, with a 15s ramp-up so connections warm
// gradually (per 08-qa.md "25 VUs for 2 min, ramping").
export function steadyScenario(tag) {
  return {
    [`${tag}_steady`]: {
      executor: 'ramping-vus',
      exec: 'steady',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 25 },
        { duration: '2m', target: 25 },
        { duration: '5s', target: 0 },
      ],
      tags: { scenario: `${tag}_steady` },
      gracefulRampDown: '5s',
    },
  };
}

// Burst: spike 1->50 VUs in 5s, hold 30s (per 08-qa.md "Burst").
// Starts after steady finishes (~2m25s) so the two never overlap and the
// cold-cache discipline (Postgres restart between) is observable per-scenario.
export function burstScenario(tag) {
  return {
    [`${tag}_burst`]: {
      executor: 'ramping-vus',
      exec: 'burst',
      startVUs: 1,
      startTime: '2m30s',
      stages: [
        { duration: '5s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '5s', target: 0 },
      ],
      tags: { scenario: `${tag}_burst` },
      gracefulRampDown: '5s',
    },
  };
}

// Thresholds builder: encodes the p95 budget on the steady scenario and the
// burst contract (zero 5xx + p99 < 2x budget) on the burst scenario.
export function thresholdsFor(tag, p95Budget) {
  return {
    [`http_req_duration{scenario:${tag}_steady}`]: [`p(95)<${p95Budget}`],
    [`http_req_duration{scenario:${tag}_burst}`]: [`p(99)<${p95Budget * 2}`],
    [`http_req_failed{scenario:${tag}_burst}`]: ['rate==0'],
  };
}

// Shared response check: 2xx (or an explicitly-allowed status, e.g. 409 for
// the weight rate-limit / 200 dedupe). Returns the body for downstream use.
export function expectOk(res, allow) {
  const ok = res.status >= 200 && res.status < 300;
  const allowed = allow ? allow.includes(res.status) : false;
  check(res, {
    'status acceptable': () => ok || allowed,
    'no 5xx': () => res.status < 500,
  });
  return res;
}

// beta-baseline-<date>.json summary writer. k6 calls handleSummary() once at
// the end; each script re-exports this. Writes BOTH stdout (human) and the
// committed baseline artifact. The artifact path is passed via env so the
// README's run loop names it beta-baseline-$(date +%F).json.
export function makeHandleSummary(endpointKey, p95Budget) {
  return function handleSummary(data) {
    const outPath =
      __ENV.BASELINE_OUT || `tests/perf/beta-baseline-${endpointKey.replace(/[^a-z0-9]/gi, '_')}.json`;
    const record = {
      schema: 'repos.perf.baseline/1',
      endpoint: endpointKey,
      p95_budget_ms: p95Budget,
      base_url: BASE_URL,
      ran_at: new Date().toISOString(),
      scenarios: {},
    };
    // Pull per-scenario p50/p95/p99 + 5xx rate out of k6's metric tree.
    const dur = data.metrics.http_req_duration;
    const failed = data.metrics.http_req_failed;
    record.scenarios.combined = {
      p50_ms: dur && dur.values ? dur.values['p(50)'] : null,
      p95_ms: dur && dur.values ? dur.values['p(95)'] : null,
      p99_ms: dur && dur.values ? dur.values['p(99)'] : null,
      req_failed_rate: failed && failed.values ? failed.values.rate : null,
      passed_p95_budget:
        dur && dur.values ? dur.values['p(95)'] < p95Budget : null,
    };
    return {
      stdout: JSON.stringify(record, null, 2) + '\n',
      [outPath]: JSON.stringify(record, null, 2),
    };
  };
}
