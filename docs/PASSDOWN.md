# PASSDOWN — Beta cutover operational log

Operational record for the pre-cutover prod window and Beta period. Newest
entries first. Referenced by `docs/runbooks/beta-cutover-checklist.md`,
`docs/runbooks/bug-triage.md`, and `docs/runbooks/dr-dry-fire.md`.

---

## Feedback prod smoke (G12) — 2026-07-10 — GREEN

Submitted as the non-admin perf user over the bearer path against prod
(`POST /api/feedback` → 201, feedback id 3). Row visible via
`GET /api/admin/feedback` immediately; `webhook_delivered_at` stamped
2026-07-10T20:31:40Z — 5s after the 20:31:35Z submit, inside the ≤5s gate.
Discord webhook returned 2xx (`FEEDBACK_WEBHOOK_URL` added to prod `.env`
2026-07-10). Triage cadence: `docs/runbooks/beta-triage.md`.

## k6 perf baseline (G9) — 2026-07-10 — GREEN with 2 renegotiated budgets

Artifact: `tests/perf/beta-baseline-2026-07-10.json` (all 10 hot endpoints,
steady 0→25 VU + burst 1→50 VU, origin-direct `http://192.168.88.65`,
cold-cache recap-first, app `e03562e` with `--memory=2g --cpus=2` caps).

- **Zero 5xx and zero failed requests across every script** — the hard burst
  criterion passes outright.
- **recap-stats (the ND3 primary suspect): p95 253→232ms vs 800ms budget.
  The ND3 `recap_stats_cache` contingency is NOT needed.**
- 8/10 endpoints inside budget. Two renegotiated:
  - `GET /api/mesocycles/today` p95 378ms vs 200ms budget
  - `PATCH /api/planned-sets/:id` p95 221ms vs 150ms budget
  - Rationale: quiet single-shot latencies are well inside budget (today
    ~80ms, patch <100ms); the misses appear only under 25 closed-loop VUs —
    roughly 100× the N≤10 Beta cohort — as pure queueing on the 2-CPU cap.
    Profiled before renegotiating: no N+1 (substitution fallback confirmed
    not firing), no missing-index signal. Follow-up candidate post-Beta:
    consolidate today's 7 sequential queries.
- Getting an honest run took three fixes, all shipped:
  1. nginx `limit_req` 10r/s-per-IP throttled the single-IP load generator
     (run 1: 82% failures). Documented ephemeral bypass in `tests/perf/README.md`.
  2. argon2 per-request bearer verification capped the API at ~16 req/s
     (run 2: uniform ~8s p95). Fixed by the verified-token cache (PR #47)
     plus `last_used_at` debounce (PR #48) — bearer round-trip 159ms→11ms.
  3. `s6-svc -r postgres` sends a SMART shutdown that hangs behind the API's
     connection pool (run 3: Postgres rejected connections for the entire
     32-min window → mass 500s; clean shutdown, no data loss). Safe
     stop-api-first sequence documented in `tests/perf/README.md`.
- Perf seed data: user `perf.g9-20260710@repos.test`
  (`fa45cab4-2b85-4fd0-adca-1264f752b708`), token label `perf-g9`, ~9k
  weight rows + 2 programs + 1 active mesocycle. Delete the user (cascades)
  after the cutover window.

## Sev-1 dry-fire (G10) — 2026-07-10 — GREEN

Synthetic Sev-1 ("core flow down") declared and mitigated via image rollback
per `docs/runbooks/bug-triage.md`.

- Declaration: 17:59:01 UTC
- Decision (rollback to last-known-good `sha-69c5a09`): 17:59:01 UTC
- Mitigation verified (container healthy on pinned image, outside-in 302,
  `/health` 200): 17:59:41 UTC
- **Declaration → mitigation: 40 seconds** (target < 10 min) — GREEN
- Roll-forward to `sha-28ccfc9` complete + verified: 18:00:51 UTC
- Mitigation path: `docker/scripts/rollback.sh 69c5a09` from the dev mac.

Finding (fixed same day): `rollback.sh` env-preservation carried the OLD
image's baked `APP_SHA` into the recreated container, so the rolled-back
container *reported* the new sha — a verification trap mid-incident. Fixed by
stripping `APP_SHA` from the captured env (`docker/scripts/rollback.sh` +
assertion in `tests/dr/rollback.test.sh`). Image pin was verified via
`docker inspect .Config.Image` during the drill.

Note: the container now runs with the `--memory=2g --cpus=2` caps (rollback.sh
recipe), which the plain `redeploy.sh` path does not apply.
