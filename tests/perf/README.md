# RepOS perf baseline (k6) — G9

Authoring closes G9; the **pass/fail RUN is a cutover-window step** (no staging
exists — `project_beta_no_staging`). These scripts measure the 10 hot endpoints
against the budgets in `docs/superpowers/specs/beta/08-qa.md`
§"Latency budget". Budgets live in `lib/budgets.js`; schema in `BASELINE_SCHEMA.md`.

## Prerequisites
- k6 is **not** installed by the repo and **not** in CI: `brew install k6`
  (or https://grafana.com/docs/k6/latest/set-up/install-k6/). Verify `k6 version`.

## Endpoints + scripts
| script | endpoint | budget (p95) | tier |
|---|---|---|---|
| get-mesocycles-today.js | GET /api/mesocycles/today | 200ms | hot |
| get-health-weight-30d.js | GET /api/health/weight?range=30d | 250ms | hot |
| get-health-sync-status.js | GET /api/health/sync/status | 100ms | hot |
| get-user-programs-past.js | GET /api/user-programs?include=past | 400ms | warm |
| get-mesocycle-volume-rollup.js | GET /api/mesocycles/:id/volume-rollup | 500ms | warm |
| get-mesocycle-recap-stats.js | GET /api/mesocycles/:id/recap-stats | 800ms | **cold — primary suspect** |
| post-user-program-start.js | POST /api/user-programs/:id/start | 2000ms | cold |
| patch-planned-set.js | PATCH /api/planned-sets/:id | 150ms | hot |
| post-planned-set-substitute.js | POST /api/planned-sets/:id/substitute | 300ms | warm |
| post-health-weight.js | POST /api/health/weight | 200ms | hot |

Each script runs two scenarios: **steady** (0→25 VUs ramp, 2 min hold) and
**burst** (1→50 VUs in 5s, hold 30s, starts after steady at +2m30s).

## Auth
Every endpoint accepts an **opaque bearer token** (`requireBearerOrCfAccess`).
One token minted with scope `health:weight:write` authenticates ALL ten (only
`POST /api/health/weight` checks scope; the rest ignore it). Set `TOKEN`,
`MESO_ID`, `UP_ID`, `PS_ID`, `SUB_EX_ID` in the environment.

### Local run (seeded repos_test)
The local API listens on **port 3001** (`api/.env` `PORT=3001`; `api/src/index.ts`
defaults to 3001). The k6 lib defaults `BASE_URL` to `http://127.0.0.1:3001`.

1. Migrate + seed + start the API:
   - `cd api && npm run migrate && npm run seed`
   - `cd api && npm run dev`   (serves http://127.0.0.1:3001)
2. Seed a perf target and capture the env exports:
   - `cd api && npx tsx ../tests/perf/seed-perf-target.mjs`
   - paste the printed `export TOKEN=... MESO_ID=... PS_ID=... UP_ID=... SUB_EX_ID=...` lines.
3. Run a script:
   - `BASE_URL=http://127.0.0.1:3001 BASELINE_OUT=tests/perf/beta-baseline-$(date +%F)-today.json k6 run tests/perf/get-mesocycles-today.js`

### Prod run (cutover window — coordinate with the alpha tester)
- **There is no staging.** Runs hit `https://repos.jpmtech.com` during the
  pre-cutover window only, after the alpha tester is notified (these scripts
  generate real DB rows; the write scripts mutate state). Confirm a maintenance
  window before starting.
- The prod token is minted at the edge: the alpha tester (or admin) hits
  `POST /api/tokens` through CF Access (browser path derives identity from the
  JWT — body `user_id` ignored) with `{ "label": "perf", "scopes": ["health:weight:write"] }`,
  or an admin uses the `X-Admin-Key` path with an explicit `user_id`. Capture
  the returned `token` once (shown only at mint).
- Seed prod targets the same way only if the cutover plan allows it; otherwise
  point `MESO_ID`/`PS_ID`/`UP_ID` at the alpha tester's own resources.
- `BASE_URL=https://repos.jpmtech.com TOKEN=... MESO_ID=... k6 run get-mesocycle-recap-stats.js`

## nginx per-IP rate limit — MUST bypass for the run (found 2026-07-10)
`docker/nginx/repos.conf` throttles `/api` at **10 r/s per client IP,
burst=20** (`limit_req zone=api`). All k6 VUs share the load-generator's IP,
so a 25-VU run trips the limiter by design: the first firing showed 82%
req_failed and a 4.1s p95 that measured the DoS shield, not the app. Before a
run, raise the zone rate in the RUNNING container (ephemeral — a container
recreate restores the baked config):

```
docker exec RepOS sh -lc "sed -i 's|zone=api:10m   rate=10r/s|zone=api:10m   rate=2000r/s|' \
  /etc/nginx/http.d/default.conf && nginx -t && nginx -s reload"
```

Restore afterwards with the reverse sed + `nginx -s reload` (or recreate the
container) and verify `rate=10r/s` is back. Real clients each have their own
IP, so the per-IP limit never binds a legitimate 25-user load.

## Cold-cache discipline (the recap-stats test that matters)
Before the **recap-stats** run, force a cold plan/buffer cache. On the Unraid
box, restart Postgres inside the container (see `reference_unraid_redeploy` for
the recreate recipe) or `docker exec RepOS sv restart postgres` (the s6 service
name is `postgres` — confirmed in `docker/root/etc/s6-overlay/s6-rc.d/postgres`).
Run recap-stats FIRST after restart so its p95 is genuinely cold.

## Destructive / stateful scripts — opt in
- `post-user-program-start.js` materializes a mesocycle and 409s on a
  re-start. For a true throughput number, seed N draft user_programs; v1
  measures the single cold-start cost.
- `post-planned-set-substitute.js` flips a planned_set's exercise. Converges to
  SUB_EX_ID; safe to repeat but still a write — run only on a throwaway user.
- `post-health-weight.js` varies `date` per VU/iteration to dodge the
  >5-writes/(user,date)/24h 409 and the same-day dedupe. It still writes real
  weight rows — use the seeded perf user, not a real account. (`time` is sent
  as `HH:MM:SS` per the weight schema's TIME_RE.)

## Output
Each run writes a `repos.perf.baseline/1` JSON (see `BASELINE_SCHEMA.md`).
At cutover, merge the per-endpoint files into
`tests/perf/beta-baseline-<YYYY-MM-DD>.json` and `git add -f` it as the
committed B9 artifact.

## ND3 — pre-budgeted contingency (DO NOT BUILD until the run proves the cliff)
If the recap-stats run shows **p95 > 1600ms (2× the 800ms budget) at 25 VUs**,
OR **any 5xx in the burst**, materialize a `recap_stats_cache` table refreshed
by a trigger on session-end (~2 eng-days). See `tests/perf/ND3-recap-cache.md`.
YAGNI until the cutover number demands it.
