# beta-baseline-<date>.json — schema `repos.perf.baseline/1`

Each k6 endpoint script emits one JSON document via `handleSummary`. The
committed cutover artifact is the **merge** of per-endpoint runs into
`tests/perf/beta-baseline-<YYYY-MM-DD>.json` (one object per endpoint, or an
array — see "Assembling the artifact" below).

## Per-endpoint object

| field | type | meaning |
|---|---|---|
| `schema` | string | always `"repos.perf.baseline/1"` |
| `endpoint` | string | the budget KEY, e.g. `"GET /api/mesocycles/today"` |
| `p95_budget_ms` | number | the budget this endpoint is measured against |
| `base_url` | string | target, e.g. `https://repos.jpmtech.com` |
| `ran_at` | string | ISO-8601 UTC timestamp of the run |
| `scenarios.combined.p50_ms` | number\|null | observed p50 over the run |
| `scenarios.combined.p95_ms` | number\|null | observed p95 |
| `scenarios.combined.p99_ms` | number\|null | observed p99 |
| `scenarios.combined.req_failed_rate` | number\|null | http_req_failed rate (0 = no failures) |
| `scenarios.combined.passed_p95_budget` | bool\|null | `p95_ms < p95_budget_ms` |

## Pass/fail (the cutover call, NOT authoring)
- **Steady (25 VUs):** PASS iff `scenarios.combined.passed_p95_budget === true`.
- **Burst (1→50 VUs):** PASS iff `req_failed_rate === 0` AND `p99_ms < 2 * p95_budget_ms`.
- These map to the k6 `thresholds` in `lib/common.js#thresholdsFor`; k6 exit
  code is non-zero if any threshold is breached, so the run is self-grading.

## Assembling the artifact
Run each script with `BASELINE_OUT=tests/perf/beta-baseline-$(date +%F)-<key>.json`,
then concatenate the per-endpoint objects into a JSON array committed as
`tests/perf/beta-baseline-$(date +%F).json` and `git add -f` it (the scratch
per-endpoint files are .gitignored).
