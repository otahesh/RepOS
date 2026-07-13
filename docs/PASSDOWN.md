# PASSDOWN — Beta cutover operational log

Operational record for the pre-cutover prod window and Beta period. Newest
entries first. Referenced by `docs/runbooks/beta-cutover-checklist.md`,
`docs/runbooks/bug-triage.md`, and `docs/runbooks/dr-dry-fire.md`.

---

## Measurement-model wave — 2026-07-12 — SHIPPED (PRs #61–#66)

Design session ran as a three-specialist agent team (sports science /
competitive research / codebase audit) + adversarial review; user-approved
design + implementation plan at
`docs/superpowers/plans/2026-07-12-measurement-model.md` (plan carries the
full review record). Six stacked PRs, each independently green on the 8
required checks; 092 (DROP NOT NULL) rehearsed against the live prod dump
(`tests/dr/dryrun-092.txt` — 0 XOR violations, in-flight rows untouched).

Shipped: `exercises.measurement (reps|duration)`; duration targets/logs as
sparse columns with XOR CHECK; side-plank prescribed 3×30–45s (was "8–15
reps"); logger duration mode (count-up hold timer, HOLD chip, optional RPE
via the single effort seam); history/recap render holds; stalled-PR
evaluator measurement guard; `cardio_logs` + inline cardio completion
(closes the W1 "prescribed but never completable" gap); hold Best-Time PRs
+ new-best toast.

**In-flight-run protection (the invariant to remember):** render mode
derives from each planned row's populated targets, never from the
exercise's current classification — the active mesocycle's side-plank rows
keep the reps UI until the next materialization. Pre-wave side-plank "reps"
history is unit-ambiguous and quarantined from duration prefill/PRs.

---

## Post-deploy smoke live firing (G13) — 2026-07-10 — GREEN

One-time infra + first live firing completed:
- CF Access service token `repos-post-deploy-smoke`
  (id `964010ab-fedb-412e-9d48-a36ae705b174`) minted via API; Service Auth
  policy ("post-deploy-smoke service token", `non_identity`, precedence 2)
  appended to the whole-host `repos` Access app (existing "Owner Only"
  allow policy untouched). Outside-in check with the token: `GET /` → 200.
- Repo secrets `CF_ACCESS_SVC_CLIENT_ID` / `CF_ACCESS_SVC_CLIENT_SECRET` set.
- `post-deploy-smoke` workflow_dispatch against deployed
  `e03562e9278eee9f23e1baeef0028abe4fd66130` → **success, zero failed steps**
  (302 whole-host gate, 401 public API, bundle fingerprint match):
  https://github.com/otahesh/RepOS/actions/runs/29123394516
- Standing procedure: fire after every prod recreate with `expected_sha` =
  the deployed full SHA (`docs/runbooks/beta-cutover-checklist.md` §W8.7).

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

## Supervised browser block (G3 + G5) — 2026-07-11 — GREEN (both gates)

Operator: jmeyer (CF Access, jason@jpmtech.com). Agent-driven browser against
production. Eight defects found; all fixed and deployed same-day (PRs #51–#56
plus two prod `.env` gaps). Prod ended the window on `3fa7bc5`, healthy,
post-deploy smoke green (run 29161181834).

### G3 — signed-in flows — GREEN

- (a) unauth → 302 to CF Access: re-verified live.
- (b) signed-in lands `/`: verified; Today card + weight chart render.
- Golden journey: mobile logger (`/today/:runId/log`, 390px viewport) logged a
  set live → `POST /api/set-logs` 201 through the edge (also proves the
  PR #42 regression fix in prod). Desktop correctly refuses live logging.
  Onboarding leg N/A (already-onboarded account; covered by CI e2e).
- Overreaching advisory: fired and rendered live on Today (screenshot
  `g3-recovery-flag-banner-live.png`, kept off-repo). Data staged via real
  API logging (3 distinct RIR-0 compound sessions inside 7d); condition 2
  required a temporary `landmarks_snapshot` tweak (glutes mav 12→3 via psql,
  reverted) because a 2-day beginner week cannot reach any legal MAV override
  — evaluator working as designed. DISMISS verified live (only the dismissed
  card removed). All staged data deleted after; day statuses + snapshot
  restored; `recovery_flag_events`/dismissal artifacts purged.
- (c) sign-out clears + re-redirects to CF Access login: verified.
- (d) sign-out-everywhere: ConfirmDialog → bearers revoked (probe token
  401 through the edge) → CF Access session terminated → lands on CF
  sign-in with `logged_out` message. Required defect fix #6 below.
- (f) bearer mint→use→revoke→401: verified 2026-07-10 (prior window).

### G5 — on-prod restore rehearsal — GREEN

Per `docs/runbooks/dr-dry-fire.md`. First attempt (17:01 UTC) was RED —
defect #8 below; DB untouched, maintenance cleared via
`POST /api/maintenance/clear`, fix deployed, rehearsal re-run clean:

```
## DR dry-fire 2026-07-11
- Backup taken at: 17:12:36 UTC  (filename: repos-20260711T171235Z.dump.gz,
  manual, verified_restorable=good, sidecar present)
- restore-into-ephemeral.sh: GREEN (28 tables, users intact; last-run.txt
  stamped, committed in PR #56)
- Restore kicked off at: 17:14:04 UTC (typed-RESTORE, fresh CF JWT)
- Maintenance flag observed by frontend at: ≤17:14:09 UTC (banner visible at
  first 4s-poll check; screenshot g5-maintenance-banner-live.png off-repo)
- pg_restore + migrations completed at: 17:14:08 UTC (sentinel status=ok;
  pre-restore-20260711T171404Z.sql.gz + sidecar created)
- /api/maintenance/clear succeeded at: 17:15:28 UTC (204); banner gone
- Post-clear smoke set-log: 201 (row deleted after — state back to baseline)
- device_tokens post-restore: zero live bearers (C-DEVICE-TOKENS-RESTORE);
  iOS Shortcut re-minted 17:16:37 UTC (token id 8) + verified 201 via edge
- Total downtime (confirm → clear): 84s; DB itself back at +4s
- Result: GREEN
```

### Defects found and fixed in this window

1. **`REPOS_ADMIN_EMAILS` missing from prod `.env`** — every CF-Access admin
   route fail-closed 403 (`admin_check_misconfigured`); the admin path had
   never been exercised in prod (G12 used X-Admin-Key). Fixed in prod `.env`
   + container recreate.
2. **W3 recovery-flag advisory UI never built** — evaluators/API/telemetry
   shipped tested, but no component called `listRecoveryFlags`; clinical
   advisories were invisible (a genuine live `bodyweight_crash` included).
   `RecoveryFlagBanner` on Today, both viewports (PR #51 + review fixes).
3. **CSP blocked Google Fonts** — prod rendered fallback fonts since the CSP
   shipped. Self-hosted via @fontsource + guard test (PR #52).
4. **Vite inlined font subsets as `data:` URIs** — blocked by CSP
   (`default-src 'self'`, no `font-src`). `assetsInlineLimit: 0` (PR #53).
5. **`PUBLIC_ORIGIN` missing from prod `.env`** — CSRF origin guard
   fail-closed 403 on signout-everywhere. Fixed in prod `.env`.
6. **signout-everywhere/account-delete cleared `CF_Authorization` server-side**
   — the follow-up `/cdn-cgi/access/logout` arrived cookieless, CF errored,
   edge session survived, team-domain SSO silently re-signed the browser in.
   Bearers revoked but browser never signed out. Cookie left intact now;
   CF logout owns teardown (PR #54).
7. **nginx implicit slash-redirect broke `GET /api/backups`** — the W5
   `location /api/backups/` block 301'd the bare path to
   `http://…/api/backups/` (scheme downgrade; CSP blocked). Root cause of the
   parked 2026-06-26 "backups page doesn't work" report. Exact-match location
   + `absolute_redirect off` + guard test (PR #55). NOTE: browsers cache the
   old 301 — a hard-reload may be needed once per client.
8. **`REPOS_SCRIPTS_DIR` path mismatch — restore never executable in prod** —
   runner spawn-detaches `${REPOS_SCRIPTS_DIR:-/app/scripts}/run-restore.sh`
   (stdio ignored) but the image ships scripts at `/scripts`. First rehearsal:
   sentinel stuck `running`, API never SIGTERMed, no pg_restore, DB untouched.
   `ENV REPOS_SCRIPTS_DIR=/scripts` in the Dockerfile + guard test (PR #56).

### Known follow-ups (non-blocking, tracked)

- **Nightly backup integrity check fails intermittently** (2026-06-27 and
  2026-07-11, 2 of ~45 nights): dump writes "ok", immediate
  `gunzip|pg_restore -l` fails, bad file correctly deleted + failure recorded.
  Suspect Unraid FUSE read-after-write on `/mnt/user/appdata`. Candidate fix:
  retry-once in `repos-backup.sh`. **Watch tonight's 03:15 UTC run.**
- **Malformed CF login URL for `/api/*` 401s** — `buildLoginUrl()` appends a
  path to `/cdn-cgi/access/login/<host>`, which CF 404s; during the first
  restore attempt the SPA bounced to that 404. Frontend/API follow-up.
- **Transient `invalid_cf_access_jwt` (~4.7s responses) at restore kickoff** —
  JWKS refresh stall under the kickoff's synchronous spawn work; resolved
  itself. Watch for recurrence.
- Env-gap pattern (defects 1, 5, 8): three feature-critical env vars never
  reached prod. Candidate: boot-time env validation warning (log-level) for
  known feature vars, or a `.env.example` sync check in CI.

## G14 + G15 + Beta cutover (Milestone 1) — 2026-07-11

### G14 — Cohort + comms — GREEN

N=1 cohort: jmeyer (jason@jpmtech.com), the alpha tester.

- Cohort cap ≤10: enforced at the edge — the whole-host CF Access app admits
  only allow-listed identities; 1 user provisioned.
- PAR-Q-lite: signed — `par_q_acknowledgments` row, version 2, all-No answers,
  accepted 2026-06-26 15:25 UTC.
- Contact path: documented in `docs/runbooks/beta-triage.md` (in-app Send
  feedback → `feedback` table → Discord webhook; Sev tiers + TTA defined).
- First-run Beta disclaimer: **built this window** (it did not exist — PR #58:
  `BetaDisclaimer` gate, `users.beta_disclaimer_ack_at`, migration 081, gate
  order disclaimer → onboarding → PAR-Q). Surfaced live on prod and
  acknowledged by the cohort: ack stamped 2026-07-11 17:51 UTC.

### G15 — Exit criteria + cadence — GREEN (cutover scope)

- `docs/runbooks/beta-exit-criteria.md` reviewed this window; conditions match
  D13. The "no blocking gaps in final 14 days" clause is the GA-exit check,
  evaluated by the weekly cadence during Beta (per the dashboard's
  done-predicate scope note).
- Weekly cadence: documented in the runbook; review #1 recorded below.
  Calendar entry: operator action — add a weekly Friday ~09:05 ET recurring
  event (agent-side calendar write was permission-blocked).

### Weekly Beta review #1 — 2026-07-11

1. 30 days no Sev-1: **IN PROGRESS** — clock anchored at 2026-07-06 (W1
   set-log 400 regression resolution, the last Sev-1-class incident). No
   Sev-1 since.
2. Zero Sev-2 in final 14 days: **GREEN today** — all 8 defects found in the
   browser block were fixed same-day; nothing open.
3. Zero PAR-Q-bypass: **GREEN** — none observed; gate order now enforces
   disclaimer → onboarding → PAR-Q before any workout surface.
4. DR dry-fire within 30 days: **GREEN** — 2026-07-11 rehearsal (this
   PASSDOWN, §DR dry-fire).
5. No outstanding Important security findings: **GREEN** — G11 closed; the
   PR #51 adversarial review's 4 Important findings all landed pre-merge.
6. ≥5 users full mesocycle + feedback: **RED (expected)** — GA signal; cohort
   is N=1 as of today.

### Post-cutover scaling plan (per master-plan risk row)

- **N=1** (jmeyer) for the first 48h — watch: nightly backup integrity,
  sync pill, set-log flow, recovery-flag noise.
- **N=5** mid-week-1 — provision via CF Access allow-list; each new user gets
  the first-run disclaimer + PAR-Q automatically (both are now product gates,
  not manual steps); record each in the comms log here.
- **N=10** end-of-week-1 — cap per G14. Any Sev-1 pauses cohort growth and
  resets the exit-criteria clock.

### Cutover sign-off — Milestone 1 EXECUTED 2026-07-11

- CF Access default-on: live since W0, re-verified continuously (every
  post-deploy smoke asserts the 302 challenge; last: run 29162240816 sha
  `bc026fc`).
- Alpha data: wiped at W0 per the split-cutover SQL
  (`scripts/cutover/001-placeholder-to-jmeyer.sql`; weight history preserved
  via reattribution — G8 evidence). Lifting data created since is the alpha
  tester's own on-product data; the Milestone-2 mesocycle starts from the
  user's current active run.
- Alpha tester CF-provisioned, PAR-Q-signed, disclaimer-acked: all verified
  above.
- **All G1–G15 green. Beta cutover authorized AND executed — the system is
  live on production for the Beta cohort. Milestone 2 (one full mesocycle
  end-to-end with no Sev-1) begins now.**
