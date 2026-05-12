# Round 2 — Engineering Composite Position

> Synthesizer: planning lead
> Inputs: `03-backend.md`, `04-frontend.md`, `07-infra.md`
> Adjudicated cross-team disputes from `01-sports-med.md`, `02-clinical-research.md`, `05-design.md`, `06-uiux.md`, `08-qa.md`
>
> This is the position Engineering will defend in the adversarial round. QA is dispatched to attack it. Where QA wins, the position updates. Where Engineering wins, QA's challenge is recorded as "considered and overruled with rationale."

---

## Headline discoveries (changes scope dramatically)

1. **CF Access auth is already 90% built.** `api/src/middleware/cfAccess.ts` verifies JWT against team JWKS, validates `aud` + `iss`, resolves email → users row, auto-provisions on first sight, sets `req.userId`. `GET /api/me` is built. Frontend `AuthProvider` is built. Every protected route already uses `requireBearerOrCfAccess`. **Backend audit confirms every protected route scopes by `req.userId` and never accepts `user_id` from request body.** This collapses the auth scope from "L" to "S".
2. **GHCR builds + nightly backups + log rotation already shipped.** CLAUDE.md's V2-out-of-scope list is stale. `.github/workflows/docker.yml` builds + pushes `:sha-<short>` and `:latest`. `docker/root/etc/s6-overlay/s6-rc.d/backup/` runs nightly `pg_dump -Fc | gzip` to `/config/backups/`, 14-day retention. s6-log handles per-service rotation. Remaining gaps are operational discipline (DR test, alerting, branch protection), not implementation.

This means Beta is mostly: **finish the live workout logger, harden the existing infrastructure, deliver clinical features Sports Med + Clinical Research call out, polish UI for live data.**

---

## Beta scope (Engineering's position)

### Wave 0 — Auth flip + cleanup (1-2 days)
Cheapest possible Beta on-ramp. Done first because it unblocks everything QA wants to test multi-user.

- **W0.1 (S, Backend):** Set `CF_ACCESS_ENABLED=true` in `/mnt/user/appdata/repos/.env`. Verify Owner-Only policy attached to whole-host app + Bypass policy still covers `/api/health/*`. Recreate container.
- **W0.2 (S, Frontend):** Delete `PLACEHOLDER_USER_ID` constant + `'disabled'` AuthStatus branch in `auth.tsx`. Update test fixtures. Add multi-user smoke test (mock-signed JWTs).
- **W0.3 (S, Backend):** Add startup sanity guards: refuse boot if `CF_ACCESS_ENABLED=true` without `CF_ACCESS_AUD`/`CF_ACCESS_TEAM_DOMAIN`; refuse boot if `POSTGRES_PASSWORD='changeme'`; log allow-list count at boot.
- **W0.4 (S, Frontend):** Account menu — Sidebar avatar becomes Radix Popover with display name, email, "Account settings", "Sign out" (calls `/cdn-cgi/access/logout`).
- **W0.5 (S, Backend):** Backfill placeholder-owned rows to real user record after first real CF Access login (one-time SQL transaction wrapped in pre-flight backup).

**Acceptance:** From outside the home network, `https://repos.jpmtech.com/` redirects to CF Access. After login, user lands on `/`. `curl -H 'Authorization: Bearer <admin_key>'` to admin endpoints still works. iOS Shortcut bearer flow still works (Bypass policy verified).

### Wave 1 — Live data foundation (5-7 days)
The largest Beta piece. Sequenced because so much else depends on it.

- **W1.1 (M, Backend):** `set_logs` migration 028 — add `user_id`, `exercise_id`, `rpe`, `created_at`, `updated_at` columns; backfill from planned_set chain; idempotency dedupe index `(planned_set_id, date_trunc('minute', performed_at))`; per-user + per-exercise indices for stalled-PR/overreaching queries; updated_at trigger.
- **W1.2 (M, Backend):** `POST /api/set-logs`, `PATCH /api/set-logs/:id` (24h immutable audit window), `DELETE /api/set-logs/:id`, `GET /api/set-logs?planned_set_id=`. All ownership-checked via JOIN to `mesocycle_runs.user_id`. Server derives `user_id` + `exercise_id` from `planned_set_id` lookup.
- **W1.3 (L, Frontend):** `<TodayLoggerMobile>` — per-set UI with weight + reps + RIR slider + auto-rest-timer + skip + swap. Mobile primary; desktop shows "follow on phone" placeholder. State accumulates in component, flushes on each log. Optimistic local + best-effort sync via IndexedDB queue keyed by client UUID. Banner: "OFFLINE · N sets queued" / "SYNCED" on reconnect.
- **W1.4 (M, Backend):** `POST /api/health/workouts` ingestion endpoint mirroring `health_weight_samples` shape: `(started_at, ended_at, modality, distance_m?, duration_sec?, source)`, `(user_id, started_at, source)` dedupe key. New `health:workouts:write` scope; mint a new bearer token. Plus iOS Shortcut authoring guide.

**Acceptance:** Full click-path: sign in → start mesocycle → mobile → "Start Workout" → log a set → set persists → desktop shows volume rollup updated. Apple Health Workouts auto-sync via Shortcut, populate cardio adherence in volume rollup.

### Wave 2 — Onboarding + clinical safety (3-5 days)

- **W2.1 (S, Backend):** Add `users.onboarding_completed_at TIMESTAMPTZ`, `users.par_q_acknowledged_at TIMESTAMPTZ`, `users.par_q_version INT`, `users.active_injuries TEXT[]` (free-text array, e.g. `['shoulder_left']`), `users.muscle_landmarks JSONB DEFAULT '{}'` (sparse override), `users.preferences JSONB DEFAULT '{}'` (units, first_day_of_week).
- **W2.2 (M, Frontend):** Onboarding flow — 5 steps: WELCOME → EQUIPMENT (reuse existing wizard) → GOAL → PROGRAM (filtered catalog) → READY. Desktop full, mobile lite (presets only). Skip on steps 2-4. Triggers when `onboarding_completed_at IS NULL`. Per Design's spec.
- **W2.3 (S, Backend + Frontend):** PAR-Q-lite — 8-item yes/no screen at first sign-in after onboarding. Soft-gate any-yes ("talk to your clinician; the app stays read-only-progression"). Stored once with version + accepted_at. Re-prompts on version bump.
- **W2.4 (M, Sports Med + Backend):** Abs/core taxonomy seed — add `core` muscle slug, ~6-8 exercises (Pallof press, dead bug, suitcase carry, hanging leg raise, ab wheel, side plank), per-muscle landmarks (MV 0, MEV 6, MAV 12, MRV 18). Append 1-2 core blocks to each curated program's late-session slot.
- **W2.5 (S, Backend):** Manual mid-mesocycle deload trigger — `POST /api/mesocycles/:id/deload-now`. Service rewrites remaining week's `planned_sets` to deload values (sets/2, RIR+2). Append `mesocycle_run_events` row with payload `{trigger:'manual_deload'}`.
- **W2.6 (S, Frontend):** "Deload this week" button on Today/Program page. Two-step confirm. Service-side reversal via mesocycle_run_events within 24h.

**Acceptance:** New user signs in → PAR-Q gate → onboarding → first program → first workout reaches live logger. Existing user can deload mid-meso with two-step confirm.

### Wave 3 — Clinical signals + injury swap (2-3 days)

- **W3.1 (M, Backend):** Wire `stalledPrEvaluator` and `overreachingEvaluator` against the existing recoveryFlags registry. Stalled-PR: 3 consecutive sessions same exercise, no load/rep increase, RIR 0. Overreaching: ≥3 sessions/7d at RIR 0 on compounds AND weekly volume ≥ MAV. Both read from `set_logs` written by Wave 1.
- **W3.2 (S, Backend):** Injury-aware substitution ranker. Read `users.active_injuries`, penalize candidates whose `joint_stress_profile[joint] IN ('mod','high')` for any active injury. Surface as advisory in substitution sheet — never a hard block.
- **W3.3 (S, Frontend):** "Got a tweak?" surface on `<TodayWorkoutMobile>` — opens `<MidSessionSwapSheet>` pre-loaded with injury context. "You noted: 'left knee meniscus.' Consider substitution if barbell back squat is loaded."
- **W3.4 (S, Frontend):** Settings → Injury notes — multi-select chips (shoulder_left, shoulder_right, low_back, knee_left, knee_right, elbow, wrist) plus free-text. Saves to `users.active_injuries`.

**Acceptance:** Logging RIR 0 across 3 compound sessions surfaces overreaching toast. Logging stagnant load on same exercise 3 weeks surfaces stalled-PR. Marking shoulder_left as active demotes overhead pressing in mid-session swap suggestions.

### Wave 4 — Desktop authoring + landmarks editor (2-3 days)

- **W4.1 (M, Frontend):** Desktop exercise picker — `<DesktopSwapSheet>` side-sheet (480px) wrapping existing `<ExercisePicker>`. Triggered from DayCard's onSwap. "Apply to: this block / every occurrence" radio. Replaces the `alert()` placeholder at `MyProgramPage.tsx:113`.
- **W4.2 (S, Backend):** `GET /api/users/me/landmarks` + `PATCH /api/users/me/landmarks` — reads `users.muscle_landmarks` JSONB, merges with hardcoded canonical defaults from `_muscleLandmarks.ts` for the response.
- **W4.3 (M, Frontend):** `/settings/program-prefs` page (new sub-nav under Settings). Volume landmarks editor — table per muscle, MV/MEV/MAV/MRV inputs, validation enforces `MV ≤ MEV < MAV < MRV` and `MV≥0, MRV≤50`. Behind a feature flag (default ON for Beta) per UI/UX. Desktop only; mobile shows read-only summary.
- **W4.4 (S, Backend):** Honor `?intent=deload` on `POST /api/mesocycles/run-it-back` — reduces target sets per block by ~40%, pins RIR to 3 across the run. Replaces frontend's NH7 workaround.
- **W4.5 (S, Frontend):** MesocycleRecap deload-intent button now actually generates a deload meso (no longer "frontend strips the link").

**Acceptance:** Desktop user can swap exercises across an entire mesocycle from MyProgramPage. Power user can edit per-muscle MEV/MAV/MRV; changes apply to next mesocycle, active runs preserved. End-of-meso deload button generates a real deload run.

### Wave 5 — Backups + restore UI (3-4 days)

- **W5.1 (S, Infra):** Add post-write integrity check to `repos-backup.sh` — `gunzip | pg_restore -l` validates TOC; on fail, delete bad file + exit non-zero. Catches the empty-gzip silent-fail mode.
- **W5.2 (S, Infra):** Healthchecks.io alerting — backup-job heartbeat (cron-mode "every 1 day, 30 min grace"), `/health` ping from Unraid host cron every 10 min. Email channel. Cloudflare Tunnel notifications enabled.
- **W5.3 (M, Backend):** `GET /api/backups` (list with sidecar JSON), `POST /api/backups` (manual snapshot now), `POST /api/backups/:id/restore` (CF Access + admin-key + typed-confirmation), `DELETE /api/backups/:id`, `GET /api/backups/:id/download`. Restore flow: pg_restore into `repos_restore` side-DB, run migrations, atomic rename, keep `repos_old_<ts>` for 24h.
- **W5.4 (M, Frontend):** `/settings/backups` page — table of snapshots (timestamp, size, trigger, verified-restorable badge), Backup Now button, Restore (heavy two-step confirm: type RESTORE), Delete (light confirm). Desktop only; mobile shows read-only snapshot list. Force-reload after restore. Per Design + UI/UX specs.
- **W5.5 (S, Infra):** Documented DR test — `scp` latest dump to dev mac, `pg_restore -l` smoke, restore into ephemeral postgres:16-alpine container, run integration smoke. Once per Beta release as deploy gate; quarterly thereafter.
- **W5.6 (S, Infra):** Docker daemon log rotation — `/etc/docker/daemon.json` with `max-size=50m max-file=5`. Reload daemon.

**Acceptance:** User can take a manual backup from Settings → Backups, see it in the list. Test restore in a staging DB end-to-end. Healthchecks.io alerts on backup-job failure or `/health` outage.

### Wave 6 — Account ops + destructive UX hardening (2-3 days)

- **W6.1 (S, Backend):** `DELETE /api/me` — typed-confirmation body (`confirm: 'DELETE my account'`); cascades via existing `ON DELETE CASCADE` on FK to `users(id)`; returns 204 + 302 to CF Access logout.
- **W6.2 (S, Frontend):** `/settings/account` Beta expansion — display name editable, timezone editable (IANA selector), units preference. Danger zone with Delete Account (typed-email-to-confirm modal per Design). Per Design's spec.
- **W6.3 (S, Frontend):** Live-data destructive-action confirms — `Abandon mesocycle` becomes type-program-name-to-confirm. Equipment-profile-reset-with-active-program shows confirm.
- **W6.4 (S, Frontend):** Replace remaining `alert()` calls (4 sites) with toasts.
- **W6.5 (S, Frontend):** Mid-session swap success toast (open thread from last session) — 5s visible toast with undo.
- **W6.6 (S, Frontend):** Term tooltip audit on Beta-new surfaces. AST coverage check (`scripts/check-term-coverage.cjs`) blocks PR on missing terms.

**Acceptance:** User can self-serve delete account. Every destructive action has a confirm pattern matched to its severity. No `alert()` reaches the user. Every term-of-art on a Beta surface has a `<Term>` tooltip.

### Wave 7 — In-app feedback + Beta cohort tooling (1-2 days)

- **W7.1 (S, Backend):** `POST /api/feedback` — captures `body, user_id, route, app_sha, user_agent, created_at`. New `feedback` table.
- **W7.2 (S, Frontend):** Bug-icon trigger in AppShell footer (or Settings → Feedback) — single textarea, optional screenshot, "send" button. POSTs to `/api/feedback`.
- **W7.3 (S, Backend):** Webhook forward — feedback row also POSTs to a configured webhook (Slack/email).
- **W7.4 (S, Backend):** `GET /api/admin/feedback` — admin-key gated; engineer pulls + triages.

**Acceptance:** Beta user submits feedback from inside the app; engineer sees it in webhook delivery within 5s. Triaged-at column updated on review.

### Wave 8 — Beta entry gates (3-5 days, runs in parallel with above)

These are QA-non-negotiable per `08-qa.md`. Engineering acknowledges + commits.

- **W8.1 (Critical, QA + Infra):** CI runs full vitest suite — add `services: postgres:16-alpine` to `test.yml`, three jobs: api-unit, api-integration, frontend-unit. Required checks on `main`. **Engineering defers to QA position.**
- **W8.2 (Critical, QA + Backend):** Multi-user contamination matrix tests — ~25 routes × 1 cross-user isolation test each, fixture `mkUserPair()` in `api/tests/helpers/`. Engineering's "audit by inspection" position is overruled by QA. **Engineering yields. Cost: ~1 engineer-day.**
- **W8.3 (Critical, QA + Frontend):** Playwright E2E suite — auth flow, golden user journey (sign-in → onboarding → start program → log set → recap), iOS Shortcut bearer-token weight POST + chart updates. ~15 tests. Run against local docker-compose mirror.
- **W8.4 (Critical, QA):** k6 baseline — scripts in `tests/perf/`, two scenarios per hot endpoint (steady 25 VUs, burst 1→50 VUs), cold-cache discipline. Output `tests/perf/beta-baseline-<date>.json` + README. **Engineering yields on Backend's "performance is fine" position.**
- **W8.5 (Critical, Infra + QA):** Branch protection on `main` — required PR review, required status checks (api-unit, api-integration, frontend-unit, typecheck, build), linear history.
- **W8.6 (Critical, Infra + QA):** Bug-triage + rollback runbook in `docs/runbooks/` — severity tiers, time-to-mitigate, image-rollback recipe (memory `reference_unraid_redeploy.md` formalized as `docker/scripts/rollback.sh`), DB-restore recipe. Dry-fire tested.
- **W8.7 (Critical, QA + Infra):** External post-deploy smoke — Playwright/curl job pings `repos.jpmtech.com` post-deploy, verifies 302→CF Access (logged-out), `/api/health/sync/status` returns 401 from public, deployed bundle hash matches build.
- **W8.8 (Critical, QA):** User-reachability audit — every Beta surface reachable from `/` in ≤3 clicks, walked through and recorded.
- **W8.9 (Critical, QA + Infra):** Pre-Beta security re-review — auth audit, IDOR audit on all new routes, PLACEHOLDER_USER_ID grep+block, runtime guard rejecting placeholder UUID at insert. All Critical + Important findings closed before cutover per `feedback_ship_clean.md`.

---

## Disputes Engineering will defend

These are positions where Engineering disagrees with another team's findings. QA, you're invited to challenge.

### D1. Account deletion ships in Beta (full implementation, not stub)
- Backend says S; Frontend says "stub mailto: for Beta, real flow at GA"; UI/UX says ship in `/settings/danger`.
- **Engineering position: ship full deletion in Beta.** GDPR posture for live data is non-negotiable per the Beta definition. Backend cost is ~20 lines + cascades that already exist. Frontend cost is one modal (Design has the spec). Neither is heavy enough to defer.

### D2. Apple Health Workouts ingestion ships in Beta (no UI, passive)
- Clinical Research says Beta-blocker on positioning grounds.
- **Engineering position: agree.** New scope `health:workouts:write`, mint new bearer token, route is ~50 lines mirroring weight ingest. iOS Shortcut authoring is a 1-day task for someone familiar with Shortcuts (we already have the weight Shortcut as template).

### D3. User-editable landmarks editor ships in Beta (behind feature flag, default ON)
- Sports Med + Frontend conditional + UI/UX agree (with feature flag).
- Clinical Research says defer ("users haven't completed enough mesos to know what to edit").
- **Engineering position: ship.** Clinical Research is right that *most* users shouldn't touch it. Feature-flag default-ON for Beta because the alpha tester is a power user and is likely first Beta user. Quietly disable via flag if user research shows nobody uses it. Cost is small; preserves option value.

### D4. Active Sessions page does NOT ship in Beta (deferred to GA)
- UI/UX has `/settings/sessions` listing live sessions per device with revoke action.
- **Engineering position: defer.** Active Sessions requires a Backend session table that doesn't exist and isn't a CF Access pattern (CF Access JWT is stateless; we don't track sessions). Implementing a parallel session table to support this UI is out of Beta scope. Beta gets only the simple "Sign out" button.

### D5. Standalone Library page (`/library`) does NOT ship in Beta
- UI/UX has it as Beta-new top-level nav.
- **Engineering position: defer.** `<ExercisePicker>` is reachable via DayCard onSwap (Wave 4) and `<MidSessionSwapSheet>`. Standalone library is GA polish.

### D6. History page does NOT ship in Beta
- UI/UX has it as Beta-new top-level nav.
- **Engineering position: defer.** Per-mesocycle recap stats already render on MyProgramPage. Global `/history` is GA.

### D7. Cardio session live logger does NOT ship in Beta
- UI/UX classifies cardio session entry as mobile primary.
- Frontend defers cardio logger to post-Beta patch release per `feedback_cardio_first_class.md` "scheduling not deprioritizing."
- **Engineering position: defer.** Apple Health Workouts ingestion (W1.4) covers cardio adherence passively. Cardio live logger ships in patch release post-Beta launch, reusing 70% of strength logger. Documented in PASSDOWN.

### D8. Onboarding "schedule days" step does NOT ship in Beta
- UI/UX has 7-step including "what days do you train."
- **Engineering position: 5-step (skip schedule).** V1 templates have fixed weekday assignments. User can deviate by simply doing today's workout on a different day. Schedule customization is post-Beta polish.

### D9. "Cardio-only" goal in onboarding does NOT ship in Beta
- UI/UX includes 4 goals incl. cardio + conditioning.
- **Engineering position: 3 goals — hypertrophy (recommended) + strength + maintain.** No cardio-only template exists in V1; offering the goal without a matching program is misleading. Defer to GA when we add cardio templates.

### D10. Migration rollback policy: forward-only with two-step destructive
- QA demands every migration ships with inverse OR explicit accept-residual-risk per migration.
- Infra spec is forward-only with two-step destructive (add-then-drop).
- **Engineering position: Infra wins, but with QA's gate.** Two-step destructive pattern (add column → backfill → switch reads → switch writes → drop in *next* migration) is the policy. Every destructive step (Step 2) must include a documented data-rescue plan in PR. QA's rehearsal demand satisfied by W8.6 — pick latest non-trivial migration, run it forward → restore-from-backup → reapply against scratch DB.

### D11. Beta data-cutover: Path A (hard reset) for programs/mesocycles, preserve weight history
- QA proposes Path A for everything.
- Backend has procedure for either.
- **Engineering position: split — wipe programs/mesocycles, preserve weight history.** The user's mesocycle data is alpha-throwaway-aware; clean slate is honest. Weight samples are simple ID-keyed numbers; preserving them is risk-free and provides continuity. Two-table backfill: `health_weight_samples`, `health_sync_status`. Other tables wipe.

### D12. Beta cohort: 5-10 users for first 2 weeks, scale to 25 thereafter
- QA's recommendation.
- **Engineering position: agree.** Hold the line at 10 for week 1.

### D13. Beta duration: ~6 months target
- Infra's assumption; nobody else specs.
- **Engineering position: 6 months. Define exit metrics.** Beta exits to GA when: (a) 30 days no Sev-1 incidents, (b) all entry gates remain green, (c) at least 5 users have completed a full mesocycle. If we don't define exit, Beta becomes permanent.

---

## Out-of-scope clarifications

These are V2/GA-deferred per V1 plan deferrals + this round's analysis. Engineering will not relitigate.

- Stimulus reports (SF/JFR/Pump/Burn per Israetel) — Clinical Research D2.
- Multi-metric tracking: body fat % stays out (BIA noise vs signal). Resting HR ingest is nice-to-have, attached to W1.4 Workouts ingestion if budget allows.
- RIR 0 ceiling relaxation — defer with opt-in flag in user prefs (Clinical Research N3 conditional).
- Multiple concurrent active mesocycles — V1 single-active is correct for Beta cohort.
- Auto-upgrade of customized programs on template version bump — V1 re-fork is correct.
- Per-injury structured contraindication filtering UI — Wave 3 ships free-text + advisory swap; structured filtering is GA.
- Mobile-side authoring tools (full ForkWizard on phone) — defer per `project_device_split`.
- Warmup/cooldown/mobility module — Sports Med says correctly deferred.
- Auto-deload on flag — Sports Med says advisory-only is correct for Beta.
- Withings/Renpho direct integration — Engineering Handoff §10 V2.
- WAL archiving / PITR — Infra defers to post-Beta; daily pg_dump is sufficient RPO.
- Multi-region / HA Postgres — out of scope.
- GHCR image signing (cosign) — single-publisher single-puller, no win.
- Notification settings panel (email/push) — defer; banner suffices.
- Theme switcher (light mode) — RepOS is dark.
- Source-priority UI for weight syncs — multi-source enabled in V1 backend; UI is post-Beta.

---

## Engineering's open questions for QA in Round 2

1. **Acceptable test isolation runtime?** Adding ~50 integration tests will lengthen the api/tests suite linearly. Plan: shared `repos_test` DB with `--no-file-parallelism`, OR per-file DB transactions with rollback, OR ephemeral PG per CI run. Pick the trade-off.
2. **Staging environment.** No staging exists. Where do load tests run? Where do Playwright tests run? Local docker-compose is fine for dev but isn't production topology. Acceptable for Beta? Or do we spec a sibling staging container at `repos-staging.jpmtech.com`?
3. **Visual regression tests** — `08-qa.md` calls them "Important." We pushed back on cost. Negotiate?
4. **Front-end MSW integration tests** — `08-qa.md` calls "test the mock" pattern an Important gap. Negotiate?
5. **Per-migration inverse SQL** — we propose two-step destructive pattern. Does QA accept with W8.6 as gate?
6. **Beta exit criteria** — "30 days no Sev-1 + 5 users complete mesocycle" — does QA agree, or hold a higher bar?
7. **CF Access expiry recovery UX** — when JWT expires mid-set-log, frontend stashes log buffer in localStorage, redirects to CF Access login, hydrates after re-auth. QA testable?

---

*End of Engineering Composite Position. QA — your turn.*
