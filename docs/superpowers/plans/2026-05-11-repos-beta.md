# RepOS Beta — Master Implementation Plan

> **For agentic workers:** This is the **master plan** for the RepOS alpha→Beta transition. It is a scope / acceptance / dependency document, not a per-step TDD plan. **Each wave (W0–W8) gets its own per-step TDD plan written immediately before that wave is dispatched.** Use `superpowers:writing-plans` to author the per-wave plans; use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to execute them.
>
> Wave-level checkboxes (`- [ ]`) here track wave completion, not step completion.

**Goal:** Take RepOS from alpha (single-user placeholder auth, throwaway data, "ship-fast" posture) to Beta (5–10 real users on real CF Access auth, live workout logging, clinical-safety surfaces, backup/restore, "ship-clean" posture with a 15-gate entry checklist).

**Architecture:** No new architectural axes. Beta is the *consolidation* milestone: flip CF Access auth from "build but-bypassed" to "default-on," finish the live workout logger (the alpha's biggest hole), wire clinical signals to real `set_logs` data, harden destructive operations (account delete, restore, deload), and lock 15 binary acceptance gates (G1–G15) before any user other than the alpha tester touches the system. **Beta launches in-place on the existing production surface** — same IP (`192.168.88.65`), same URL (`https://repos.jpmtech.com`), same Cloudflare Tunnel + Access app. Alpha data is wiped at cutover (per the split data-cutover decision); weight history is preserved via idempotent reattribution SQL. **There is no separate staging environment** — see "No staging — pre-cutover prod is the validation surface" below.

**Tech stack:** Unchanged from alpha. Fastify 5 + TypeScript + Postgres 16 (`api/`); Vite 5 + React 18 + TypeScript (`frontend/`); s6-overlay v3 + nginx + Postgres 16 inside one Docker image; GHCR build pipeline; Cloudflare Tunnel + Access ingress; Unraid host. New ops surfaces: Healthchecks.io for backup heartbeat + `/health` outage alerting, k6 for performance baseline.

**Source specs (committed before plan):**
- `docs/superpowers/specs/beta/01-sports-med.md` through `08-qa.md` — Round-1 specialist findings.
- `docs/superpowers/specs/beta/round2-engineering-composite.md` — Engineering composite position.
- `docs/superpowers/specs/beta/round2-qa-challenges.md` — QA adversarial challenges (G1–G15 verbatim originate here).
- `docs/superpowers/specs/beta/round3-engineering-response.md` — Engineering closes deadlocks (ND1–ND6 resolved).
- `docs/superpowers/specs/beta/round3-qa-confirmation.md` — QA confirms bar locked + 4 wave-plan amendments + ND4-amended G5.

---

## Pre-flight observations (read before starting any wave)

These are non-obvious facts about the current repo state that shape the plan. Verify each one before starting W0 — if any has drifted, surface it before dispatch.

### What the alpha actually shipped (collapses Beta scope)

1. **CF Access auth is ~90% built and bypassed via `CF_ACCESS_ENABLED=false`.** `api/src/middleware/cfAccess.ts` verifies the CF Access JWT against the team JWKS, validates `aud` + `iss`, resolves email → `users` row, auto-provisions on first sight, and sets `req.userId`. `GET /api/me` is built. Frontend `AuthProvider` is built. **Backend audit confirms every protected route already uses `requireBearerOrCfAccess` and scopes by `req.userId` (server-derived), never accepts `user_id` from request body.** Beta auth = flip the env flag + delete `PLACEHOLDER_USER_ID` fallback. No new middleware. No new session layer.
2. **GHCR builds, nightly backups, log rotation, runtime guards already ship.** `.github/workflows/docker.yml` builds + pushes `:sha-<short>` and `:latest`. `docker/root/etc/s6-overlay/s6-rc.d/backup/` runs nightly `pg_dump -Fc | gzip` → `/config/backups/`, 14-day retention. s6-log handles per-service rotation. **The `CLAUDE.md` "v2-out-of-scope" list is stale on these three items** — Infra spec flagged it. Update CLAUDE.md as part of W0 cleanup.
3. **Local dev DB does not exist.** The standalone `repos-postgres` container at `192.168.88.2:5432` was retired during the monolithic-container deploy. `npm test` from a fresh checkout has no DB to talk to. **Per-wave plans MUST provision a Postgres** (e.g. `docker run -d --name repos-test-pg -p 5433:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=repos_test postgres:16`) as their pre-flight step. No staging container exists or will be built — see below.

### No staging — pre-cutover prod is the validation surface (USER OVERRIDE 2026-05-11)

QA Round 3 locked ND2: "staging environment is Beta-blocking." Engineering accepted. **User explicitly overrode this on 2026-05-11:** "No way..This will be a live beta, we continue to use the same IP, URL everything, we move the alpha into the trash and launch the beta product asap."

The trade: faster shipping in exchange for accepting production-only failure modes (CF Access policy, CF Tunnel ingress, real DNS, production Node + small-icu Intl behavior, production Postgres pool sizing) as residual risk. These were going to get validated against `repos-staging.jpmtech.com`; instead they get validated in the **pre-cutover prod window** — the period between W0 close (CF Access flipped on, alpha data wiped, cutover SQL run) and when the first non-alpha-tester user signs in.

**Operational implications for the validation surface:**
- W5.5 DR test: runs against `postgres:16-alpine` ephemeral container (already specified), using the latest prod dump pulled via `scp` from `/mnt/user/appdata/repos/config/backups/`. No staging.
- W8.3 Playwright E2E: runs against **`repos.jpmtech.com` itself**, during the pre-cutover window, using a CF-Access-provisioned test user (the alpha tester's account suffices, plus one second CF Access JWT for cross-user contamination cases).
- W8.4 k6 baseline: runs against `repos.jpmtech.com` during the pre-cutover window, when only the alpha tester might be logging. Production-rep load test with no real-user collateral.
- **Mitigation discipline:** the first ~48h post-cutover, cohort stays at **N=1 (the alpha tester only)**. If clean signal, scale to 5 users mid-week-1, 10 by end of week-1.

**G3, G9, G12 acceptance language is amended in this plan** to swap "against staging environment" → "against production CF Access topology (pre-cutover window)." This is a user-driven override of QA's locked verbatim language; treat the amended forms as Beta-binding.
4. **Existing live deploy state.** Container at `192.168.88.65` on `br0`, public via `https://repos.jpmtech.com`. Secrets at `/mnt/user/appdata/repos/.env`. Per memory `reference_deployment.md`. Production redeploy = `docker stop && docker rm && docker run` with the env-preserving recipe in memory `reference_unraid_redeploy.md` — NOT `docker restart` (which keeps the old image).

### Alpha data posture (drives the cutover decision)

Memory `project_alpha_state.md`: until the user declares Release, all DB content is throwaway. The Beta data cutover is therefore **split**:
- **Wipe** `programs`, `mesocycles`, `mesocycle_runs`, `planned_sets`, `day_workouts`, `planned_cardio_blocks`, `set_logs`, dismissals — alpha programs were exploratory.
- **Preserve** `health_weight_samples`, `health_sync_status` — 2 months of real weight history from the alpha tester, idempotently reattributed from the placeholder UUID to the real CF-Access-provisioned user via the cutover SQL.

Cutover is sentinel-gated (column `health_weight_samples.migrated_from_placeholder_at TIMESTAMPTZ`) so re-runs are no-ops. **Path A fallback** (wipe weight too) is available if any of the 4 ND5 conditions can't be met. See W0.5 below.

### Round 3 deliberation outcomes locked into this plan

- **6 deadlocks resolved** (ND1–ND6). ND4 was a strategic concession: Engineering swapped pg_restore-side-DB-rename for **maintenance-mode restore** because the test surface for the rename was scarier than the cost of accepting ~30–60s of downtime during a rare admin-only operation.
- **15 binary acceptance gates (G1–G15)** locked verbatim from QA Round 2, with G5 amended in QA Round 3 to fold in 3 new ND4 tests (restore-crash-recovery, sigterm-drain, restore-migration-failure).
- **Maintenance flag MUST be persisted** (`maintenance_mode` table row or sentinel file at `/config/maintenance.flag`), NOT in-process boolean. In-process boolean dies with the API process if it crashes mid-restore — the API would come back up "normal" against a half-restored DB. This is ND4 new failure mode 1 and is non-negotiable.
- **W3 critical path includes W1.4** (Apple Health Workouts ingest), not just W1.1–W1.3. Recovery scoring needs cardio strain per memory `feedback_cardio_first_class.md`. Documented as a footnote on the wave plan, not just "W3 depends on W1."
- **Cardio manual entry: patch-on-complaint SLA (7 days).** D7 deferred the cardio live logger to post-Beta. If a Beta user reports the manual-cardio-at-the-gym gap via the W7 feedback loop, the cardio logger patch ships within 7 days. Cardio logger reuses ~70% of strength logger surface; estimated 3 engineer-days. Tracked in PASSDOWN.

### Memories that override default behavior

| Memory | Effect on this plan |
|--------|----------------------|
| `feedback_ship_clean.md` | All Critical + Important security findings close before Beta. No "v1.5 backlog." Drives G11. |
| `feedback_user_reachability_dod.md` | Every Beta surface reachable from `/` in ≤3 clicks. Component tests + clean build ≠ shipped. Drives G7. |
| `feedback_get_plan_reviewed.md` | After synthesis, dispatch specialists to re-review. Drives the Phase-5 step described under "Plan-level execution sequence" below. |
| `feedback_worktree_isolation.md` | Agent prompts dispatched per wave must stay in worktree — no absolute-path `cd` into `/Users/jasonmeyer.ict/Projects/RepOS`. Override CLAUDE.md cwd guidance when dispatching. |
| `feedback_cardio_first_class.md` | Cardio is equal-weight to strength. Drives W1.4 (Workouts ingest) + the D7 patch SLA. W3 depends on W1.4 because recovery flags read cardio strain. |
| `feedback_terms_of_art_tooltips.md` | Every term-of-art in Beta-new UI gets a `<Term>` tooltip. Drives W6.6. |
| `project_device_split.md` | Desktop = data management; mobile = live workout. Drives W1.3 (mobile-primary logger), W4 (desktop-only authoring), W5.4 (desktop-only restore UI). |
| `project_responsive_chrome.md` | Mobile-vs-desktop is responsive AppShell, NOT a `/mobile/*` subtree. Applies to every UI wave. |
| `project_alpine_smallicu.md` | Production Node is small-icu; use `formatToParts` not locale tags when shape matters. Applies wherever new UI formats dates. |
| `project_arr_style_db_recovery.md` | Backup/restore follows *arr-style snapshot pattern. Drives W5. |
| `feedback_act_with_agency.md` | Broad directives mean decide + dispatch, not ask piecemeal. Applies to W0–W8 dispatch. |
| `reference_unraid_redeploy.md` | Container redeploy needs stop+rm+run, not restart. Drives W8.6 rollback runbook. |

### What's explicitly OUT of Beta scope

(Engineering Round 2 disputes D4–D9; not relitigated.)

- Active Sessions page with per-device revoke UI (CF Access is stateless; a parallel session table is GA scope). **W6.7 "Sign out everywhere" is the agreed floor.**
- Standalone Library page at `/library` (reachable via swap flows; standalone is GA polish).
- History page at `/history` (per-mesocycle recap renders on `MyProgramPage`; global history is GA).
- Cardio live logger UI (Apple Health Workouts ingest in W1.4 covers passive case; manual-cardio-at-gym gap is documented + patch-SLA-bound).
- Onboarding "schedule days" step (templates have fixed weekday assignments; deviation = "do today's workout on a different day").
- "Cardio-only" goal in onboarding (no cardio template exists in V1; offering goal without matching program is misleading).
- Stimulus reports (SF/JFR/Pump/Burn per Israetel) — Clinical Research D2.
- Body fat %, resting HR ingest (RHR may piggyback W1.4 if cheap, otherwise defer).
- Multiple concurrent active mesocycles (V1 single-active is correct for Beta cohort).
- Auto-upgrade of customized programs on template version bump (V1 re-fork is correct).
- Per-injury structured contraindication filtering UI (free-text + advisory swap in W3 is enough).
- Mobile-side full ForkWizard (`project_device_split`).
- Warmup/cooldown/mobility module.
- Auto-deload-on-flag (advisory-only for Beta per Sports Med).
- Withings/Renpho direct integration.
- WAL archiving / PITR (daily pg_dump RPO sufficient).
- Multi-region / HA Postgres.
- GHCR image signing (cosign) — single-publisher, single-puller.
- Notification settings panel.
- Light theme.
- Source-priority UI for weight syncs.
- Visual regression tests (downgraded to "Beta-nice-to-have, GA-required" — Playwright E2E covers user-visible regressions).
- Frontend MSW integration tests (real-API Playwright is the same loop with fewer moving parts).

---

## Plan-level execution sequence (six phases)

This is the meta-process around the 9 implementation waves. Treat it like a wrapper around W0–W8.

1. **Phase 0 — Lock spec.** Round 1–3 deliberation complete. Specs sit at `docs/superpowers/specs/beta/`. **Status: DONE.**
2. **Phase 1 — Write this master plan.** Scope / acceptance / dependency graph at wave granularity. G1–G15 verbatim. **Status: this document.**
3. **Phase 2 — Specialist re-review.** Per memory `feedback_get_plan_reviewed.md`: dispatch the 8 Round-1 specialists (Sports Med, Clinical Research, Backend, Frontend, Design, UI/UX, Infra, QA) back to re-read this plan against their own Round-1 findings. Surface gaps. Fold corrections in-line. **Status: PENDING after this doc lands.**
4. **Phase 3 — User decisions.** Surface the 4 open user-decisions (listed under "Open user decisions" below) and any new questions from Phase 2 review. Wait for explicit answers before W0 dispatch.
5. **Phase 4 — Per-wave plan + dispatch loop.** For each wave W0 → W8 in critical-path order:
   - Write a **per-wave TDD plan** at `docs/superpowers/plans/2026-05-11-beta-W<n>-<subject>.md` using `superpowers:writing-plans` (default TDD-step granularity applies — this is where the writing-plans skill is used unmodified).
   - Dispatch the wave via `superpowers:subagent-driven-development` (fresh subagent per task, review between tasks) into an isolated git worktree per `superpowers:using-git-worktrees`.
   - After wave merges to `main`, update G-table progress + run W8 acceptance for any gates the wave touches.
6. **Phase 5 — Beta entry gate review.** When all 9 waves merge: walk G1–G15 line-by-line. Every gate is binary pass/fail. Any red = Beta slips. Document the result in `PASSDOWN.md` under "Beta entry gate review <date>."
7. **Phase 6 — Cohort cutover.** Per W8.4 contingency + G14: invite the first 10 users (probably starts with the alpha tester + a small handful of trusted testers). Each gets a first-run disclaimer + signed PAR-Q-lite + documented contact path. Begin the 6-month Beta clock. Weekly Beta review cadence per G15.

---

## Wave overview

| Wave | Subject | Cost (eng-days) | Critical-path? | Parallelizable with |
|------|---------|-----------------|-----------------|----------------------|
| **W0** | Auth flip + cleanup + JWKS rotation test | 1–2 | YES (blocks everything) | nothing |
| **W1** | Live data foundation (set_logs API + Logger UI + Workouts ingest) | 5–7 | YES (longest pole) | W2 from W1-day-3 |
| **W2** | Onboarding + clinical safety (PAR-Q, deload, core taxonomy) | 3–5 | NO | W1 from W1-day-3 |
| **W3** | Clinical signals + injury swap | 2–3 | YES (needs W1.1–W1.4 merged) | nothing until W1 closes |
| **W4** | Desktop authoring + landmarks editor | 2–3 | NO | W2/W3/W5/W6 from W0 close |
| **W5** | Backups + restore UI (maintenance-mode) | 3–4 | NO | W2/W3/W4/W6 from W0 close |
| **W6** | Account ops + destructive UX hardening + Sign out everywhere | 2–3 | NO | W2/W3/W4/W5 from W0 close |
| **W7** | In-app feedback loop | 1–2 | NO | runs in trailing 1–2 days |
| **W8** | Beta entry gates | 3–5 | runs continuously across W0–W7 | always; closes after W7 |

**Total:** 9 waves, ~3–4 engineering-weeks at solo+agents pace, ~2 weeks with multi-worktree dispatch where the dependency graph permits.

**Critical path:** `W0 → W1 (all four sub-waves W1.1, W1.2, W1.3, W1.4) → W3`. Everything else (W2/W4/W5/W6/W7) parallelizes from W0 close. W8 is continuous.

**Dispatch model:**
- **Single-engineer + agents (default):** Serialize W0. Then dispatch W1 + W2 in parallel worktrees. When W1 merges, dispatch W3. When W3 merges, dispatch W4/W5/W6 in parallel. W7 trails. W8 runs continuously.
- **Multi-agent (parallel-heavy):** Each wave's tasks are bounded enough to dispatch as parallel worktree agents once W0 settles the auth surface. Use `superpowers:dispatching-parallel-agents` once a wave plan exists.

---

## W0 — Auth flip + cleanup + JWKS rotation test

**Goal:** Turn `CF_ACCESS_ENABLED=false` (alpha bypass) into `CF_ACCESS_ENABLED=true` (Beta default), delete every `PLACEHOLDER_USER_ID` fallback, wipe alpha data while preserving weight history, and prove JWKS cache invalidation works.

**Why first:** Every multi-user contamination test in W8.2 needs CF Access live to be meaningful. Every set_logs write in W1 must be attributed to a real CF-Access-provisioned UUID, not the placeholder. The cutover SQL must run before any W1 row lands.

**Sequencing inside W0:** W0.1 → W0.5 strictly serial (cutover SQL is the gating event). W0.6 (JWKS rotation test) parallelizes with W0.1–W0.5.

### W0 task surface (per-wave TDD plan will expand each)

- [ ] **W0.1 — Flip CF_ACCESS_ENABLED.** Set `CF_ACCESS_ENABLED=true` in `/mnt/user/appdata/repos/.env`. Verify Owner-Only policy attached to whole-host app; verify Bypass policy still covers `/api/health/*` paths used by the iOS Shortcut. Recreate container per `reference_unraid_redeploy.md` recipe. Smoke from outside the home network: `https://repos.jpmtech.com/` returns 302 → CF Access challenge.
- [ ] **W0.2 — Delete PLACEHOLDER_USER_ID from frontend.** Remove the constant + the `'disabled'` AuthStatus branch in `frontend/src/auth.tsx`. Update test fixtures to mint mock CF Access JWTs. Add a multi-user frontend smoke test (mock-signed JWTs) that proves two different `req.userId` values produce two different in-app states.
- [ ] **W0.3 — Startup sanity guards (6 guards total).** Refuse boot if:
  1. `CF_ACCESS_ENABLED=true` without `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN`.
  2. `POSTGRES_PASSWORD='changeme'`.
  3. **(NEW per Phase-2 backend review)** `DATABASE_URL` is unset. Round-1 backend spec required this guard; was missing in original W0.3 draft.
  4. **(NEW per QA Round 2)** `NODE_ENV=production` AND a row exists with `user_id = '00000000-0000-0000-0000-000000000001'` after cutover. Runtime SELECT in bootstrap; exit non-zero with clear log if found.
  5. **(NEW per QA Round 3 / ND4 failure mode 1)** Persisted maintenance flag exists at boot — API boots into maintenance mode (503 on `/api/*` except `/api/maintenance/*`), does NOT auto-clear. Admin must explicitly clear via the maintenance escape-hatch route.
  6. Log allow-list count at boot.
- [ ] **W0.4 — Account menu + logout.** Sidebar avatar becomes Radix Popover with display name, email, "Account settings," "Sign out" (`/cdn-cgi/access/logout`). **Acceptance includes Playwright assertion (G3.b/c):** after logout + page reload, attempt to access a cached SPA route → 302 to CF Access. Logged-out state must not retain server-side data via cached SPA.
- [ ] **W0.5 — Placeholder-to-real-user cutover SQL (HARDENED per ND5).** Numbered script at `scripts/cutover/001-placeholder-to-jmeyer.sql`. Idempotent + sentinel-gated.
  - **Named owner:** Backend engineer (the W0 implementer).
  - **Pre-flight:** triggers `pg_dump` snapshot via `scripts/pre-restore-snapshot.sh` (also used by W5.3) before any UPDATE.
  - **Sentinel column:** `ALTER TABLE health_weight_samples ADD COLUMN migrated_from_placeholder_at TIMESTAMPTZ NULL` (migration ships with this script).
  - **Cutover SQL** UPDATEs only `WHERE user_id = '00000000-0000-0000-0000-000000000001' AND migrated_from_placeholder_at IS NULL`. Same logic for `health_sync_status`.
  - **Test 1 (synthetic):** `tests/cutover/synthetic.test.sh` — seeds placeholder rows in `repos_test`, runs the script, asserts row counts + idempotency on re-run.
  - **Test 2 (alpha-clone):** `tests/cutover/alpha-clone.test.sh` — restores a `pg_dump` of jmeyer's actual alpha database (taken 2026-05-07 or later) into an ephemeral Postgres, runs the script, asserts:
    - Placeholder count after cutover = 0.
    - jmeyer count after cutover = (original placeholder count) + (original jmeyer count, likely 0).
    - `SELECT id FROM health_weight_samples GROUP BY id HAVING count(*) > 1` returns 0 (no duplicates).
  - **Drives G8.**
- [ ] **W0.6 — JWT cache invalidation test on JWKS rotation (NEW per Phase-2 backend + QA review).** Promoted from Risk register to explicit W0 task. `api/tests/integration/jwks-rotation.test.ts` — mocked JWKS endpoint, assert JWT signed by rotated-out key returns 401 within 60s, JWT signed by new key returns 200. Tune `jose`'s `createRemoteJWKSet` `cacheMaxAge` + `cooldownDuration` so the cache busts within budget. Document the chosen TTL in `api/src/middleware/cfAccess.ts` block comment. Drives G3 + G11.

> **W0.6 (staging container) is REMOVED per user decision 2026-05-11.** Original ND2 spec called for a sibling container at `192.168.88.66` + `repos-staging.jpmtech.com`. Superseded by user override; see "No staging — pre-cutover prod is the validation surface" in Pre-flight observations. The original W0.7 (JWKS rotation test) is renumbered to W0.6.

### W0 acceptance (wave-completion gate)

- From outside the home network, `https://repos.jpmtech.com/` 302s to CF Access.
- After login, user lands on `/`. Their `req.userId` is the real CF-Access-provisioned UUID, never the placeholder.
- `curl -H 'Authorization: Bearer <admin_key>'` to admin endpoints still works (admin key path is preserved).
- iOS Shortcut bearer flow against `/api/health/weight` still works (CF Access Bypass policy preserved).
- Grep across `api/` + `frontend/` for `PLACEHOLDER_USER_ID` returns hits only in test files.
- Runtime guard rejects `INSERT` with `user_id = '00000000-0000-0000-0000-000000000001'` in `NODE_ENV=production`.
- `scripts/cutover/001-placeholder-to-jmeyer.sql` runs cleanly against alpha-clone with documented before/after row counts.
- CLAUDE.md "v2-out-of-scope" list updated to remove GHCR + nightly backups + log rotation (already shipped).
- JWKS rotation test (W0.6) green: mocked-rotated-out key returns 401 within 60s; new key returns 200.

### W0 contributes to: G1, G2, G3, G7, G8, G10, G13.

---

## W1 — Live data foundation (set_logs API + Live Logger UI + Workouts ingest)

**Goal:** Ship the live workout logger end-to-end. This is the alpha's biggest hole and the longest pole in Beta. By wave-close: a Beta user signs in, starts a mesocycle, opens the mobile logger, logs sets (offline-tolerant), and the rows feed the volume rollup + the recovery flag evaluators (the latter wires in W3).

**Why second:** W0 is the only thing it depends on (CF Access + real `req.userId`). Everything else in W2/W3/W4 either depends on W1 (W3 directly; W4 swap UI consumes set_logs schema) or parallelizes from W0 close (W2/W5/W6).

**Sequencing inside W1:** W1.1 → W1.2 → W1.3 strict serial (schema → routes → UI). W1.4 parallelizes with W1.2/W1.3.

### W1 task surface

- [ ] **W1.1 — `set_logs` schema (migration 028).** Add `user_id`, `exercise_id`, `rpe`, `client_request_id UUID NOT NULL`, `created_at`, `updated_at` columns. Backfill `user_id` + `exercise_id` from planned_set chain (mesocycle_run.user_id, planned_set.exercise_id). Idempotency dedupe index: `UNIQUE (planned_set_id, date_trunc('minute', performed_at))`. Per-user + per-exercise compound indices for the W3 stalled-PR and overreaching queries. `updated_at` trigger.
  - **Dedupe contract (per QA):** `POST /api/set-logs` with same `client_request_id` UUID returns `200 {deduped: true, set_log_id: <existing>}`. Same minute, same planned_set_id, different client_request_id also returns 200 deduped:true (same-minute double-tap during a workout is the most common offline-replay case).
- [ ] **W1.2 — `set_logs` CRUD routes with 24h audit window.**
  - `POST /api/set-logs` (body: `client_request_id`, `planned_set_id`, `weight_lbs`, `reps`, `rir`, `performed_at`). Server derives `user_id` + `exercise_id` from `planned_set_id` lookup. Ownership-checked via JOIN to `mesocycle_runs.user_id = req.userId`.
  - `PATCH /api/set-logs/:id` — 200 if `performed_at + 24h > now()`; **409** `{error: 'audit_window_expired', performed_at, max_edit_at}` if past 24h.
  - `DELETE /api/set-logs/:id` — same 24h window. Past 24h → 409 surfaced in UI as "Set logged 25h ago — locked. Add a correction set instead?"
  - `GET /api/set-logs?planned_set_id=<id>` for client reconciliation after offline replay.
- [ ] **W1.3 — `<TodayLoggerMobile>` with offline contract (the longest task).** Per-set UI: weight + reps + RIR slider (0–5) + auto-rest-timer + skip + swap. Mobile primary; desktop shows "follow on phone" placeholder. State accumulates in component, flushes on each log. **IndexedDB queue keyed by `client_request_id` UUID.** Banner: "OFFLINE · N sets queued" / "SYNCED" on reconnect.
  - **All 8 offline scenarios O1–O8 ship as part of this task** with Playwright + IndexedDB-inspection tests. The full O1–O8 matrix lives in `round2-qa-challenges.md` "Hard-line additions §1":
    | # | Scenario | Required behavior |
    |---|----------|---------|
    | O1 | Server returns 409 on queued set | Banner "1 set rejected — tap to review"; set marked rejected; user can edit+resubmit or delete; does NOT silently drop |
    | O2 | Page reload mid-queue | Queue persists in IndexedDB; on reload, banner "N sets queued" + resume flush; no double-submit |
    | O3 | Device switch mid-workout (phone → tablet) | New device sees same `mesocycle_run` state; sets logged offline on phone surface on tablet after phone reconnects; server-timestamp wins on conflict |
    | O4 | Network drop mid-flush | Queue marks in-flight as "pending"; exponential-backoff retry; idempotency-key prevents double-submit |
    | O5 | Same set logged twice (double-tap) | Server dedupe returns 200 + prior row id |
    | O6 | IndexedDB quota exceeded | Banner "Storage full — clear older offline sessions in Settings"; user can clear; app does not crash |
    | O7 | Queue abandoned 7d | On reopen, queue intact; user can flush or clear; staleness surfaced |
    | O8 | Set logged with `planned_set_id` that server has since deleted | 404 on flush; banner "1 set could not sync — original workout no longer exists"; moves to "rejected" bucket |
  - **CF Access expiry mid-set-log:** if JWT expires while user is logging, frontend stashes log buffer in localStorage AND IndexedDB queue, redirects to CF Access login, hydrates after re-auth. **Safari-private-mode case** (no localStorage) shows blocking modal: "Your session expired. Sign in to save N unlogged sets." (G3.e covers this.)
  - **Data-loss budget for offline: ZERO sets silently dropped.** Every queued set either lands or surfaces a user-visible failure with a path to retry/edit/delete. This is the bar.
- [ ] **W1.4 — Apple Health Workouts ingest endpoint.** New table `health_workouts`. New scope `health:workouts:write`. New bearer token mint flow. `POST /api/health/workouts` body: `(started_at, ended_at, modality, distance_m?, duration_sec?, source)`. Dedupe key: `(user_id, started_at, source)`. 5-writes-per-day-per-user 409 limit (mirrors weight ingest). iOS Shortcut authoring guide at `docs/runbooks/ios-shortcuts.md` (committed to repo, not Notion).
  - **Scope-contamination test inheritance:** ships its W8.2 row — a `health:weight:write`-only token attempting `POST /api/health/workouts` returns 403.
- [ ] **W1.5 — End-to-end Playwright case for W1/W3 integration (folds into W8.3 too).** "Logging 3 RIR-0 sessions on a compound exercise via `POST /api/set-logs` surfaces the overreaching toast on the next `/api/recovery-flags` poll." This is the data-flow proof that W1 set_logs feed W3 evaluators.

### W1 acceptance (wave-completion gate)

- Full click-path: sign in → start mesocycle → mobile route → "Start Workout" → log set → row appears in `set_logs` with correct `user_id` + `exercise_id` + `client_request_id` → desktop `MyProgramPage` shows volume rollup updated.
- Mobile logger queues sets while offline (airplane mode) and flushes on reconnect without double-submission. All 8 O1–O8 cases pass.
- `POST /api/health/workouts` with valid `health:workouts:write` bearer ingests a workout; with `health:weight:write`-only bearer returns 403.
- iOS Shortcut authoring guide at `docs/runbooks/ios-shortcuts.md` is committed and end-to-end-runnable by a user who has never seen the Shortcut.
- W1.5 Playwright case green.

### W1 contributes to: G2, G3 (specifically G3.e), G4 (entirely), G7.

---

## W2 — Onboarding + clinical safety (PAR-Q, deload, core taxonomy)

**Goal:** Ship the new-user first-run flow (5 steps, skip schedule per D8), the PAR-Q-lite clinical safety gate, the manual mid-mesocycle deload trigger, and the core (abs) muscle taxonomy with seed exercises.

**Why parallel with W1 from day-3:** W2 doesn't depend on `set_logs` data; it depends on `users` table columns + curated programs. Both exist. Can start as soon as a parallel worktree opens.

### W2 task surface

- [ ] **W2.1 — `users` table additions.** Migration: `onboarding_completed_at TIMESTAMPTZ`, `par_q_acknowledged_at TIMESTAMPTZ`, `par_q_version INT`, `active_injuries TEXT[] DEFAULT '{}'` (free-text, e.g. `['shoulder_left']`), `muscle_landmarks JSONB DEFAULT '{}'` (sparse override map), `preferences JSONB DEFAULT '{}'` (units, first_day_of_week).
  - **PAR-Q ack model amendment (per QA Round 2):** PAR-Q acknowledgments are NOT overwritten on version bump. New table `par_q_acknowledgments(user_id UUID, version INT, accepted_at TIMESTAMPTZ, PRIMARY KEY(user_id, version))`. Audit trail preserved.
- [ ] **W2.2 — Onboarding 5-step flow.** WELCOME → EQUIPMENT (reuse existing wizard) → GOAL → PROGRAM (filtered catalog) → READY. Desktop full; mobile lite (presets only, no full picker). Skippable on steps 2–4 (default to "recommended"). Triggers when `onboarding_completed_at IS NULL`. Per Design spec.
- [ ] **W2.3 — PAR-Q-lite 8-item screen.** First sign-in after onboarding. Soft-gate on any "yes" → "Talk to your clinician; the app stays read-only-progression." Stored as `par_q_acknowledgments` row.
  - **Re-prompt test (per QA):** bump `par_q_version` in DB → next page load re-prompts AND prior `par_q_acknowledged_at` is preserved per-version (new row, not UPDATE).
- [ ] **W2.4 — Core/abs taxonomy seed.** Add `core` muscle slug to taxonomy. Seed 6–8 core exercises: Pallof press, dead bug, suitcase carry, hanging leg raise, ab wheel, side plank, etc. Per-muscle landmarks `(MV=0, MEV=6, MAV=12, MRV=18)`. Append 1–2 core blocks to each curated program's late-session slot.
  - **Cutover semantics (per QA):** ships as a NEW program template version. Existing alpha-tester forks reference the OLD version and don't change underfoot. Per-mesocycle materialization-at-start preserves this.
- [ ] **W2.5 — Manual mid-mesocycle deload.** `POST /api/mesocycles/:id/deload-now` rewrites remaining-week's `planned_sets` to deload values: `floor(target_sets * 0.6)` for sets reduction (minimum 1 set; floor of 0.6×1 = 0 → clamps to 1), RIR pinned to **3** (not 4 — preserves some training stimulus). Append `mesocycle_run_events` row `{trigger:'manual_deload'}`.
  - **Reversal:** `POST /api/mesocycles/:id/deload-now/undo`. 24h window. Integration tests for both directions; named route in spec (per QA — original spec was silent on the reversal route name).
  - **Test boundaries:** 3-set block reduces to 1, 5-set to 3, 1-set stays 1.
- [ ] **W2.6 — "Deload this week" button on Today/Program page.** Two-step confirm (medium-tier per `05-design.md` §"Restore-from-backup confirmation pattern" — the file `Design_Spec_Destructive_Confirms.md` does not exist; `05-design.md` is the source of truth for confirm-tier patterns). Mobile + desktop. Reversal surfaced in MesocycleRecap.

### W2 acceptance (wave-completion gate)

- New user signs in → PAR-Q gate → onboarding → first program → first workout reaches the W1.3 live logger.
- PAR-Q "yes" answer shows soft-gate but does NOT prevent app use; copy is "talk to your clinician; the app stays read-only-progression."
- PAR-Q version bump in DB re-prompts on next page load; prior acks preserved in `par_q_acknowledgments`.
- Existing alpha-tester user can deload mid-meso with two-step confirm; reversal works within 24h; no reversal allowed past 24h.
- Curated programs now have core blocks; existing forked alpha programs are NOT silently mutated (referenced OLD template version).

### W2 contributes to: G7, G11, G14 (PAR-Q sign-off requirement).

---

## W3 — Clinical signals + injury swap

**Goal:** Wire the recovery flag evaluators (stalled-PR + overreaching) against the `set_logs` data written by W1. Ship the injury-aware substitution ranker. Ship the mid-session swap surface ("Got a tweak?"). Ship the Settings injury notes UI.

**Critical-path dependency:** W1.1 + W1.2 + W1.3 + W1.4 ALL merged. **W1.4 is non-optional** for W3 correctness — recovery scoring reads cardio strain per `feedback_cardio_first_class.md`. Recovery flags computed against incomplete data (no cardio) would degrade toast accuracy. Spelled out here so the wave plan footnote isn't lost.

### W3 task surface

- [ ] **W3.1 — Wire `stalledPrEvaluator` + `overreachingEvaluator`.** Both read from `set_logs` (W1.1) AND `health_workouts` (W1.4).
  - **Stalled-PR rule:** 3 consecutive sessions same exercise, no load/rep increase, RIR 0.
  - **Overreaching rule:** ≥3 sessions/7d at RIR 0 on compounds AND weekly volume ≥ MAV. Cardio strain factors into volume per `feedback_cardio_first_class.md`.
- [ ] **W3.2 — Injury-aware substitution ranker.** Read `users.active_injuries`. Penalize candidates whose `joint_stress_profile[joint] IN ('mod','high')` for any active injury. Surface as advisory in substitution sheet — **never a hard block.**
  - **Test the click-through path (per QA Round 2):** injured-shoulder_left user opens swap sheet, sees overhead press demoted with "high shoulder load" advisory, clicks-through anyway, set logs successfully. Advisory ≠ block.
- [ ] **W3.3 — "Got a tweak?" surface on `<TodayWorkoutMobile>`.** Opens `<MidSessionSwapSheet>` pre-loaded with injury context. Copy: "You noted: 'left knee meniscus.' Consider substitution if barbell back squat is loaded."
- [ ] **W3.4 — Settings → Injury notes UI.** Multi-select chips: shoulder_left, shoulder_right, low_back, knee_left, knee_right, elbow, wrist. Plus free-text field. Saves to `users.active_injuries`. Desktop + mobile (mobile is read+edit; the chips work on small screens).

### W3 acceptance (wave-completion gate)

- Logging 3 RIR-0 sessions on a compound (via `POST /api/set-logs` from W1.2) surfaces overreaching toast on next `/api/recovery-flags` poll. (This is the W1.5 Playwright case; it lands its assertion in W3.)
- Logging stagnant load on same exercise 3 weeks surfaces stalled-PR.
- Marking `shoulder_left` as active demotes overhead pressing in mid-session swap suggestions but does NOT block selection.
- Click-through path on advisory works (set logs successfully).

### W3 contributes to: G2, G7.

---

## W4 — Desktop authoring + landmarks editor

**Goal:** Ship the desktop `<DesktopSwapSheet>` (replaces the `alert()` placeholder at `MyProgramPage.tsx:113`). Ship the user-editable volume landmarks editor behind a feature flag (default ON for Beta). Ship the end-of-mesocycle deload-intent button.

**Why parallel:** Doesn't depend on `set_logs` writes for correctness; it depends on the routes from W1.2 + the landmarks schema from W4.2. Can run alongside W2/W3/W5/W6 once W0 closes.

### W4 task surface

- [ ] **W4.1 — `<DesktopSwapSheet>` side-sheet (480px) wrapping existing `<ExercisePicker>`.** Triggered from `DayCard.onSwap`. "Apply to: this block / every occurrence" radio. Replaces `alert()` at `MyProgramPage.tsx:113`.
  - **"Every occurrence" multi-row UPDATE (per QA):** ownership checked at every row, not just the first. Integration test: every-occurrence UPDATE returns 404 if any single row's parent `mesocycle_run.user_id` mismatches `req.userId`.
- [ ] **W4.2 — Landmarks routes.** `GET /api/users/me/landmarks` reads `users.muscle_landmarks` JSONB, merges with hardcoded canonical defaults from `_muscleLandmarks.ts` for the response. `PATCH /api/users/me/landmarks` validates `MV ≤ MEV < MAV < MRV` AND `MV≥0, MRV≤50`, writes JSONB.
- [ ] **W4.3 — `/settings/program-prefs` page (new sub-nav under Settings).** Volume landmarks editor — table per muscle, MV/MEV/MAV/MRV inputs. Validation enforces the constraints above. Behind feature flag `BETA_LANDMARKS_EDITOR` (default ON for Beta). Desktop only; mobile shows read-only summary.
  - **Tests required (per QA D3 conditions):**
    1. Validation tests (MV ≤ MEV < MAV < MRV, MV≥0, MRV≤50).
    2. Edited landmarks apply to NEXT mesocycle and DO NOT mutate active runs.
    3. Flipping feature flag OFF mid-Beta hides the UI without breaking pages that read landmarks.
- [ ] **W4.4 — Honor `?intent=deload` on `POST /api/mesocycles/run-it-back`.** Reduces target sets per block by ~40% (same `floor(target_sets * 0.6)`, min 1, as W2.5). Pins RIR to 3. Replaces frontend's NH7 workaround.
- [ ] **W4.5 — MesocycleRecap deload-intent button now actually generates a deload meso.** (No longer "frontend strips the link.")

### W4 acceptance (wave-completion gate)

- Desktop user can swap exercises across an entire mesocycle from `MyProgramPage` (no more `alert()`).
- Power user can edit per-muscle MEV/MAV/MRV; changes apply to the NEXT mesocycle; active runs preserved.
- Toggling `BETA_LANDMARKS_EDITOR=false` mid-Beta hides the UI; pages that READ landmarks (e.g. volume rollup) still function.
- End-of-meso deload button generates a real deload mesocycle run with sets reduced + RIR pinned.

### W4 contributes to: G2 (new routes contamination matrix), G7, G11.

---

## W5 — Backups + restore UI (maintenance-mode strategy)

**Goal:** Ship the manual backup snapshot button, the restore-from-snapshot UI, the integrity check, the alerting (Healthchecks.io), and the DR test script. **Restore uses maintenance-mode strategy** per ND4 (not atomic-rename).

**Why parallel:** Doesn't depend on W1 set_logs writes for correctness; the backup pipeline + restore route + UI are independent of live workout data. Restore tests use Testcontainers Postgres.

### W5 task surface

- [ ] **W5.1 — `repos-backup.sh` integrity check.** Post-write: `gunzip | pg_restore -l` validates TOC. On fail: delete bad file + exit non-zero. Catches the empty-gzip silent-fail mode.
  - **Test (per QA):** `tests/dr/integrity-check.test.sh` — inject known-bad gzip into `/config/backups/`, run `repos-backup.sh` with validate-only flag, assert non-zero exit + bad file deleted.
- [ ] **W5.2 — Healthchecks.io alerting.** Backup-job heartbeat (cron-mode "every 1 day, 30 min grace"). `/health` ping from Unraid host cron every 10 min. Email channel. Cloudflare Tunnel notifications enabled at CF dashboard.
- [ ] **W5.3 — Maintenance-mode restore routes (REVISED per ND4).** `GET /api/backups` (list with sidecar JSON). `POST /api/backups` (manual snapshot now). `POST /api/backups/:id/restore` (CF Access + admin-key + typed-confirmation body). `DELETE /api/backups/:id`. `GET /api/backups/:id/download`.
  - **Restore flow (NEW per ND4):**
    1. `POST /api/backups/:id/restore` sets PERSISTED maintenance flag (`maintenance_mode` table row OR `/config/maintenance.flag` file — **MUST be persisted**, NOT in-process). All `/api/*` routes return 503 with `Retry-After: 60` for the duration. `/api/maintenance/*` routes are the escape hatch and do NOT 503.
    2. `scripts/pre-restore-snapshot.sh` runs FIRST — captures a `pg_dump` of the current live DB before any destructive action. This is the rollback path.
    3. Send `SIGTERM`-via-s6: `s6-rc -d change api`. API SIGTERM handler stops accepting new connections (Fastify `close()`), waits for in-flight requests up to 30s, closes pg pool, exits 0.
    4. `pg_restore --clean --if-exists --no-owner --no-privileges` against the live `repos` database.
    5. Run migrations against the restored DB to bring it to current schema.
    6. `s6-rc -u change api`. API restarts, reads the persisted maintenance flag at boot, stays in maintenance mode until admin clears it via `/api/maintenance/clear`. (Manual clear ensures admin verified DB state before resuming traffic.)
    7. Admin clears flag → API serves traffic normally. Frontend force-reloads on next /api/* response that's no longer 503.
  - **Three new ND4 tests (fold into G5):**
    - `api/tests/integration/restore.test.ts` (happy path) — Testcontainers Postgres, write dataset, dump, mutate, restore, assert dataset matches dump.
    - `api/tests/integration/restore-crash-recovery.test.ts` (ND4 failure 1) — start restore, kill API process during pg_restore step, restart API, assert API boots into maintenance mode (not normal), assert `/api/*` returns 503 except `/api/maintenance/*`, assert admin can manually clear flag once DB state verified.
    - `api/tests/integration/sigterm-drain.test.ts` (ND4 failure 2) — issue 10 concurrent `POST /api/set-logs` requests, send SIGTERM mid-flight, assert all 10 either complete or fail with retriable error, assert no partial writes (no rows with NULL required fields). Tests the idempotency key wiring.
    - `api/tests/integration/restore-migration-failure.test.ts` (ND4 failure 3) — restore an older dump, mock migration 49 to throw, assert API stays in maintenance mode, assert `/api/maintenance/status` returns the failed-migration error, assert `/api/maintenance/restore-pre-snapshot` succeeds and brings DB back to pre-restore state, assert maintenance flag clears after successful pre-snapshot restore.
  - **W5.3.0 (per QA Round 3) — pre-restore snapshot script.** `scripts/pre-restore-snapshot.sh` exists as its own task (it's invoked by W5.3 AND by W0.5 cutover). Half-day. Captures `pg_dump` to `/config/backups/pre-restore-<ts>.sql.gz` + sidecar JSON tagged `trigger:'pre_restore'`. 24h retention separate from nightly rotation.
- [ ] **W5.4 — `/settings/backups` page.** Table of snapshots (timestamp, size, trigger, verified-restorable badge). "Backup Now" button. "Restore" (heavy two-step confirm: type RESTORE). "Delete" (light confirm). Desktop only; mobile shows read-only snapshot list.
  - **Maintenance banner copy (per QA Round 3):** During maintenance-mode 503 window, frontend reads `503 {error:'maintenance', retry_after_s}` and shows blocking banner: *"RepOS is briefly down for a database restore. Your last logged set is saved on this device and will sync automatically when service returns. Estimated: 60 seconds."* On reconnect, force-reload via `window.location.reload()`.
- [ ] **W5.5 — DR test CI script.** `tests/dr/restore-into-ephemeral.sh` — `scp` latest dump from prod (`/mnt/user/appdata/repos/config/backups/`) to a CI runner, `pg_restore -l` smoke, restore into ephemeral `postgres:16-alpine` container, run integration smoke. CI-runnable artifact, NOT a manual procedure. Quarterly cadence enforced by `tests/dr/last-run.txt` (committed timestamp; CI fails if older than 100 days).
- [ ] **W5.6 — Pre-snapshot recovery UI (NEW per ND4 failure 3).** `/settings/backups` page surfaces "RESTORE FAILED — roll back to pre-snapshot" recovery flow when `/api/maintenance/status` returns failed-migration error. UI calls `/api/maintenance/restore-pre-snapshot`. 1 engineer-day.
- [ ] **W5.7 — Docker daemon log rotation.** `/etc/docker/daemon.json` with `max-size=50m max-file=5`. Reload daemon.

### W5 acceptance (wave-completion gate)

- User can take a manual backup from Settings → Backups. Sidecar JSON exists.
- Test restore (happy path) end-to-end via Testcontainers + the W5.3 integration tests. Maintenance banner appears with correct copy. 30–60s downtime visible. Frontend force-reloads cleanly. (Production restore validation runs in the pre-cutover prod window — once.)
- All four restore tests pass (happy path + crash + sigterm + migration-failure).
- `tests/dr/restore-into-ephemeral.sh` runs green in CI.
- Healthchecks.io alerts on backup-job failure or `/health` outage (smoke-test by manually breaking the cron, confirming alert fires).
- Pre-snapshot recovery UI works end-to-end against the migration-failure test scenario.

### W5 contributes to: G5 (entirely), G10, G11.

---

## W6 — Account ops + destructive UX hardening + Sign out everywhere

**Goal:** Ship account deletion (full implementation, GDPR posture for live data, NOT a stub). Ship the "Sign out everywhere" bulk-revoke (ND1, the floor below Active Sessions UI). Replace remaining `alert()` calls. Match destructive-confirm patterns to severity. Run the term-tooltip audit on Beta-new surfaces.

**Why parallel:** Independent of W1 set_logs writes; depends only on existing user + token tables. Can run with W2/W3/W4/W5.

### W6 task surface

- [ ] **W6.1 — `DELETE /api/me`.** Typed-confirmation body `{confirm: 'DELETE my account'}`. Cascades via existing `ON DELETE CASCADE` FK on `users(id)`. Returns 204 + 302 to CF Access logout.
  - **Cascade test (per QA Round 2):** `api/tests/integration/account-deletion.test.ts` — create user with mesocycle + 100 set_logs + 30 weight samples + 2 bearer tokens + **workouts rows** (per QA Round 3 amendment, the cascade test must include `health_workouts` because W1.4 added the table). DELETE `/api/me`. Assert 204. `SELECT count(*) FROM <each_table> WHERE user_id = deleted_id` returns 0. `SELECT orphan rows WHERE foreign_key NOT IN users` returns 0.
- [ ] **W6.2 — `/settings/account` Beta expansion.** Display name editable. Timezone editable (IANA selector). Units preference. Danger zone with Delete Account (typed-email-to-confirm modal per Design spec).
- [ ] **W6.3 — Live-data destructive-action confirms.** "Abandon mesocycle" → type-program-name-to-confirm. Equipment-profile-reset-with-active-program → confirm modal.
- [ ] **W6.4 — Replace remaining `alert()` calls (4 sites).** Convert to toasts.
- [ ] **W6.5 — Mid-session swap success toast.** 5s visible toast with undo. (Open thread from prior session.)
- [ ] **W6.6 — Term tooltip audit.** Run AST coverage check (`scripts/check-term-coverage.cjs`) against Beta-new surfaces (W1.3, W2.2, W2.6, W3.3, W3.4, W4.3, W5.4, W6.2, W6.5, W7.2). Add `<Term>` wrappers for any missed term-of-art per memory `feedback_terms_of_art_tooltips.md`. CI rule already exists; this task closes the audit list.
- [ ] **W6.7 — Sign out everywhere (NEW per ND1).** `POST /api/auth/signout-everywhere` — NO admin-key, CF-Access-required. Deletes all `device_tokens` rows for `req.userId`, clears CF Access cookie via `Set-Cookie: CF_Authorization=; Max-Age=0`, returns 204. Frontend button in `/settings/account` "Sign out everywhere" with light confirm modal. After click: redirect to CF Access logout. Banner: "Signed out everywhere. Re-mint your iOS Shortcut bearer in Integrations."
  - **Test (G3.e):** mint two bearer tokens for user, call sign-out-everywhere, both tokens return 401 on subsequent use.

### W6 acceptance (wave-completion gate)

- User can self-serve delete account from Settings; row count for the deleted user across every user-scoped table is 0; no orphan rows.
- Every destructive action has a confirm pattern matched to its severity (light / medium / heavy).
- No `alert()` reaches the user anywhere in Beta surfaces.
- Every term-of-art on a Beta surface has a `<Term>` tooltip (AST coverage check green).
- "Sign out everywhere" revokes all bearer tokens; both pre-existing tokens return 401 after click.

### W6 contributes to: G2, G3 (G3.d "Sign out everywhere" assertion), G7, G11.

---

## W7 — In-app feedback loop

**Goal:** Ship the in-app feedback submission + webhook delivery + admin triage view. This closes the user → engineering signal loop for Beta. Cheap and small; trails the other waves.

### W7 task surface

- [ ] **W7.1 — Backend.** `feedback` table. `POST /api/feedback` captures `body, user_id, route, app_sha, user_agent, created_at`. Cheap insert.
- [ ] **W7.2 — Frontend.** Bug-icon trigger in AppShell footer OR Settings → Feedback. Single textarea + optional screenshot + Send button. POSTs to `/api/feedback`.
- [ ] **W7.3 — Webhook forward.** On feedback row insert, also POST to a configured webhook (Slack incoming-webhook URL OR email-via-Mailgun). Configurable via `.env`.
- [ ] **W7.4 — Admin triage view.** `GET /api/admin/feedback` — admin-key-gated. Engineer pulls + reviews. Triaged-at column tracking.
  - **External smoke (per QA Round 2):** Playwright test submits feedback as a non-admin user (second CF Access JWT for a test user), asserts feedback row in DB within 5s + webhook delivery confirmed.

### W7 acceptance (wave-completion gate)

- Beta user submits feedback from inside the app. Row lands in `feedback` table within 5s. Webhook delivers within 5s.
- Admin can pull `GET /api/admin/feedback` and mark `triaged_at`.
- Smoke test as a non-admin test user passes against `repos.jpmtech.com` during the pre-cutover prod window.

### W7 contributes to: G12 (entirely), G14.

---

## W8 — Beta entry gates (continuous across W0–W7)

**Goal:** Build out the test + tooling + runbook infrastructure that's required to PASS G1–G15. W8 doesn't ship features; it ships the bar.

**Sequencing model:** runs continuously across W0–W7. **W8.2 (contamination matrix) MUST be authored per-route-as-routes-land**, NOT all-at-end (per QA Round 3 — otherwise the matrix races the wave plan). Each wave's per-wave plan includes the W8.2 row(s) for any new routes that wave adds.

### W8 task surface

- [ ] **W8.1 — CI hardening.** Add `services: postgres:16-alpine` to `.github/workflows/test.yml`. Three required jobs: api-unit, api-integration, frontend-unit. Add typecheck + build as required checks. Configure GitHub branch protection on `main` to require all five.
  - **Test isolation strategy (per QA Round 2 Q1 + Phase-2 review):** per-file `BEGIN/ROLLBACK` wrapping each integration test (`beforeEach(beginTx); afterEach(rollback)`). Tests needing committed state opt into a serial fixture. Budget: **integration suite under 90s on CI.** If exceeded, shard by file as next lever.
  - **Acceptance for G1:** open a deliberately-broken PR; confirm the gate blocks merge.
- [ ] **W8.2 — Multi-user contamination matrix.** Fixture `mkUserPair()` at `api/tests/helpers/`. Per-route integration test asserts 404 (or 403, never 200-with-other-user-data) when user B tries to read/write user A's row. **Matrix expanded from ~25 routes to ~37** (per QA Round 3 — new routes from W1.1/W1.2/W1.4/W2.5/W4.1/W4.2/W5.3/W6.1/W6.7/W7.1 inherit a row). Each test ~5 lines via the fixture.
- [ ] **W8.3 — Playwright E2E.** ~15 tests covering:
  - Auth flow (logged-out → CF Access; logged-in → `/`; sign-out clears state; expired JWT mid-set-log buffers + recovers).
  - Golden user journey: sign-in → onboarding → start program → log set → recap.
  - iOS Shortcut bearer-token weight POST + chart updates (uses production-minted bearer).
  - W1.5 end-to-end overreaching toast case (3 RIR-0 sessions on a compound → toast fires).
  - Restore-flow happy path (admin uploads dump, kicks restore, maintenance banner appears, force-reload succeeds).
  - Sign-out-everywhere flow.
  - **Run against `repos.jpmtech.com` itself during the pre-cutover prod window** (no staging — see Pre-flight observations). Use the alpha tester's CF-Access-provisioned account + a second test CF Access JWT for cross-user cases.
- [ ] **W8.4 — k6 perf baseline.** Scripts in `tests/perf/`. Two scenarios per hot endpoint: **steady 25 VUs** + **burst 1→50 VUs**. Cold-cache discipline. Output `tests/perf/beta-baseline-<date>.json` + README. Per-endpoint p95 budgets per `08-qa.md`. **Run against `repos.jpmtech.com` during the pre-cutover prod window** — no staging exists. Coordinate with the alpha tester so they're not logging while k6 is hammering. Pre-cutover means the alpha data is already wiped and no real Beta user has signed in yet, so production-rep load with zero collateral.
  - **Contingency (per ND3):** any hot endpoint p95 > 2× budget at 25 VUs OR any 5xx during 1→50 burst → Beta cutover SLIPS. Time-box: 5 engineering days to fix-or-renegotiate. Likely cliff: `/api/mesocycles/:id/recap-stats` (per `mesocycles.ts` block comment). Pre-budgeted fix: materialize `recap_stats_cache` table with trigger refresh on session-end; ~2 engineer-days.
- [ ] **W8.5 — Branch protection on `main`.** Required PR review. Required status checks (the 5 from W8.1). Linear history.
- [ ] **W8.6 — Runbooks + rollback.** `docs/runbooks/bug-triage.md` with severity tiers + time-to-mitigate. `docker/scripts/rollback.sh <sha>` (formalizes memory `reference_unraid_redeploy.md` recipe). DB-restore recipe documented. Sev-1 dry-fire performed: declaration → mitigation in <10 min, captured with timestamps in PASSDOWN.
  - **Migration two-step gate (per QA D10):** `scripts/check-migration-dryrun.sh` is the CI script. Every PR introducing a Step-2 (destructive) migration must include link to a successful dry-run output in the PR description. CI rejects Step-2 PRs without the link.
  - **(NEW per Phase-2 infra review) Operational discipline runbooks at `docs/runbooks/`:**
    - `secret-rotation.md` — ADMIN_API_KEY rotation procedure (quarterly cadence in PASSDOWN); POSTGRES_PASSWORD rotation flow (`ALTER USER` inside container, then recreate); rotation procedure for the production CF Access app.
    - `cf-access-aud-drift.md` — symptoms (universal 401 with valid JWTs), diagnosis (`/health` from outside vs inside-tunnel), recovery (verify `CF_ACCESS_AUD` against CF dashboard, hot-update `.env`, recreate container per `reference_unraid_redeploy.md`). Belt-and-suspenders to the W0.3 startup guards.
    - **Container resource caps in rollback.sh + the standard `docker run` recipe:** `--memory=2g --cpus=2`. Pathological-query guardrail. Update `reference_unraid_redeploy.md` recipe to include these flags.
- [ ] **W8.7 — External post-deploy smoke.** GitHub Actions job pings `repos.jpmtech.com` post-deploy. Verifies 302 → CF Access (logged-out). Verifies `/api/health/sync/status` returns 401 from public. Verifies deployed bundle hash matches build artifact. Fails the deploy on mismatch.
- [ ] **W8.8 — User-reachability audit.** Walk every Beta surface from `/`. Document the click-path in `docs/qa/beta-reachability.md`. Confirm ≤3 clicks for each. Confirm prior-mesocycle recap is reachable from MyProgramPage (per D6 condition). **If gap:** ship a "past mesocycles" list on MyProgramPage (S, ~30 LOC).
- [ ] **W8.9 — Pre-Beta security re-review.** Auth audit. IDOR audit on all new routes. `PLACEHOLDER_USER_ID` grep + ESLint rule blocking re-introduction. Runtime guard on placeholder UUID insert (W0.3 #3). All Critical + Important findings from `08-qa.md` §"Pre-Beta security review checklist" close with PR links (per `feedback_ship_clean.md`).

### W8 acceptance (wave-completion gate)

All 15 G-gates green. See "Beta entry gate review" below.

---

## Beta entry gate review (G1–G15 verbatim)

These are the locked-down acceptance criteria from `round2-qa-challenges.md`, with G5 amended per `round3-qa-confirmation.md`. Each line is a binary pass/fail. No partial credit.

### G1 — CI hardening
**PASS:** `.github/workflows/test.yml` has three required jobs (api-unit, api-integration, frontend-unit) AND `main` branch protection lists all three plus typecheck + build as required checks AND the most recent 5 PRs to land on main show all checks green AND a deliberately-broken PR was opened to confirm the gate blocks merge.

### G2 — Multi-user contamination
**PASS:** Every route in §"Multi-user data isolation test plan" of `08-qa.md` PLUS every route added in W1–W7 (set-logs CRUD, deload-now, customize, restore, feedback, account delete, landmarks PATCH, etc.) has a passing integration test in `api/tests/integration/contamination/` AND `mkUserPair()` fixture exists in `api/tests/helpers/` AND every test asserts 404 (or 403, never 200-with-other-user-data). Test count is ≥35.

### G3 — Auth flow E2E
**PASS:** Playwright suite in `tests/e2e/` covers: (a) unauthenticated → CF Access redirect; (b) signed-in lands on `/`; (c) sign-out clears state and re-redirects; (d) "Sign out everywhere" revokes all bearer tokens (per ND1); (e) expired CF Access JWT mid-set-log buffers in localStorage, recovers after re-auth, zero sets lost; (f) iOS Shortcut bearer mint → use → revoke → use returns 401. **All run green against production CF Access topology (pre-cutover prod window) — amended from QA Round 2 verbatim "against staging environment" per user override 2026-05-11.**

### G4 — Live Logger offline contract
**PASS:** All 8 scenarios in "Hard-line additions" §1 (O1–O8) have passing tests AND Playwright video evidence shows zero silent set loss across O1, O2, O4, O5, O8.

### G5 — Backup integrity + restore (AMENDED per QA Round 3)
**PASS:** Manual backup from `/settings/backups` produces a sidecar JSON entry AND `gunzip | pg_restore -l` integrity check passes AND restore-into-ephemeral test in `tests/dr/restore-into-ephemeral.sh` passes against the latest production dump AND **maintenance-mode restore integration test (per ND4) passes including (a) the standard restore happy path, (b) the API-crash-mid-restore recovery case, (c) the SIGTERM-drain test, (d) the migration-failure-rollback-to-pre-snapshot case** AND DR dry-fire was performed within the last 7 days before cutover.

### G6 — Migration discipline
**PASS:** Every migration on `main` since alpha-cutover follows two-step destructive (Step 2 in next migration) AND every Step-2 PR links to a successful dry-run artifact AND the most recent migration was rehearsed forward → restore-from-backup → reapply-against-scratch with zero data loss for non-targeted rows.

### G7 — User-reachability
**PASS:** Documented walkthrough in `docs/qa/beta-reachability.md` shows every Beta surface reachable from `/` in ≤3 clicks for a logged-in user AND prior-mesocycle recap (per D6 condition) is reachable AND no surface requires URL knowledge.

### G8 — Placeholder UUID purge
**PASS:** Zero `PLACEHOLDER_USER_ID` references in non-test code (grep + ESLint rule) AND runtime guard rejects inserts with `user_id = '00000000-0000-0000-0000-000000000001'` in non-test environments AND the cutover script `scripts/cutover/001-placeholder-to-jmeyer.sql` was run successfully against alpha data with documented before/after row counts.

### G9 — Performance baseline + contingency
**PASS:** k6 baseline in `tests/perf/beta-baseline-<date>.json` shows p95 within budget for every hot endpoint at 25 VUs steady AND zero 5xx at 1→50 VU burst AND if any endpoint missed budget, the contingency window (per "Hard-line additions" §6) was used to fix or renegotiate, captured in PASSDOWN.md.

### G10 — Runbook dry-fire
**PASS:** `docs/runbooks/bug-triage.md` exists with severity tiers + time-to-mitigate AND `docker/scripts/rollback.sh <sha>` exists and was tested AND a Sev-1 dry-fire was performed: declaration → mitigation in <10 min, captured with timestamps.

### G11 — Pre-Beta security re-review
**PASS:** All Critical AND Important findings from `08-qa.md`'s §"Pre-Beta security review checklist" closed with PR links AND no findings deferred to a "v1.5 backlog" AND any explicit accept-residual-risk has engineering-lead sign-off in writing with date.

### G12 — Feedback loop external smoke
**PASS:** Test feedback submission as a non-admin user landed in `feedback` table within 5s AND webhook delivery confirmed AND triage cadence documented in `docs/runbooks/beta-triage.md`.

### G13 — External post-deploy smoke
**PASS:** GitHub Actions job pings `repos.jpmtech.com` post-deploy AND verifies 302 → CF Access (logged-out) AND `/api/health/sync/status` returns 401 from public AND deployed bundle hash matches build artifact AND fails the deploy on mismatch.

### G14 — Cohort + comms
**PASS:** First cohort capped at 10 users AND each user has signed PAR-Q-lite AND each user has documented contact path AND each user knows they're a Beta user (first-run disclaimer surfaced).

### G15 — Beta exit criteria documented
**PASS:** `docs/runbooks/beta-exit-criteria.md` lists all conditions per D13 ruling above AND review cadence documented (weekly during Beta) AND last review showed no blocking gaps in the final 14 days.

**Exit criteria captured in `docs/runbooks/beta-exit-criteria.md` per G15:**
1. 30 days no Sev-1 incidents.
2. **Zero Sev-2 in the final 14 days.**
3. **Zero PAR-Q-bypass incidents** (user got past PAR-Q without acknowledging — Critical bug class).
4. **Backup-restore dry-fire passes within the final 30 days** (per G5 cadence).
5. **No outstanding Important security findings** (per `feedback_ship_clean.md` — applies at GA exit too).
6. **At least 5 users completed a full mesocycle AND submitted feedback** (the feedback loop closing is a usage signal).

All 15 gates green = Beta cutover authorized. Any red = Beta slips.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| W8.4 finds a hot-endpoint cliff (recap-stats CTE most likely) | Medium | Beta slip 2–5 days | Pre-budgeted fix: materialize `recap_stats_cache` table + trigger; 5-day contingency window before escalating |
| Cutover SQL fails against alpha clone | Low | Beta blocks on data path | Path A fallback (wipe weight too); user re-syncs via iOS Shortcut backfill; 30s recovery |
| Maintenance-mode restore test surfaces a real ND4-style failure mode in W5.3 | Low | Beta slip 1–2 days | QA reserves "small-scope ND4 re-open" per Round 3 §"Path to Round 4." Engineering implements; QA reviews; not a re-plan |
| CF Access JWKS rotation cache invalidation broken | Low | Beta-user 401 storm | W0.7 ships mocked-JWKS-rotation integration test with 60s cache-bust budget; fix in W0 if test fails |
| Beta user trips manual-cardio-at-gym gap | Medium | Reputational cost; patch deadline | D7 patch-on-complaint SLA: 7-day patch ship. Cardio logger reuses 70% of strength logger; 3 engineer-days |
| No pre-prod validation surface (user removed staging) | Medium-High | Production cliff at cutover | Pre-cutover prod window IS the validation surface — W8.3 Playwright + W8.4 k6 run against prod with alpha tester only. First ~48h post-cutover, cohort stays at N=1 (alpha tester) before scaling to 5 mid-week-1, 10 by end-of-week-1. PASSDOWN entry captures "no-staging risks" |
| Apple Health Workouts dedupe key collides with weight dedupe key on same-day workout | Low | Loss of a workout row | Separate table (`health_workouts`); separate dedupe `(user_id, started_at, source)`; can't collide |
| W3 evaluator fires false positives for casual cardio users | Medium | Toast spam | Threshold tuning; QA Round 3 acknowledged tuning is post-cohort-feedback work, not pre-Beta |
| Restore-from-pre-snapshot UI itself fails (W5.6) | Low | Admin can't recover from failed restore | Manual recovery path documented in runbook; admin can SSH to host + run `pg_restore` against the pre-snapshot dump file |

---

## User decisions (RESOLVED 2026-05-11)

All decisions answered by the user on 2026-05-11. Captured here for traceability.

1. **Data cutover model: SPLIT.** Preserve `health_weight_samples` + `health_sync_status`; wipe everything else (programs, mesocycles, set_logs, etc.).
2. **Week-1 cohort cap: HOLD AT 10.**
3. **Beta duration anchor: 6 months — but expectation is faster.** Anchor for planning purposes; G15 exit gates decide actual exit. User signals "won't take 6mo" — treat as upper bound, target faster.
4. **Staging: REMOVED.** User: "No way..This will be a live beta, we continue to use the same IP, URL everything, we move the alpha into the trash and launch the beta product asap." See "No staging — pre-cutover prod is the validation surface" in Pre-flight observations. ND2 superseded; G3/G9/G12 acceptance language amended in this plan.
5. **(Phase-2 review surface) Mobile-onboarding shape: RENDER FULL ON BOTH.** Per spec. W2.2 per-wave plan implements full onboarding on both devices, not "mobile lite presets only."
6. **W0 execution model: INLINE.** Per `superpowers:executing-plans` — batch execution with checkpoints. (`/settings/danger` IA was bundled into this answer as "inline is fine" → keep Danger Zone inline within `/settings/account`.)

Deferred (W8.4 contingent):
7. If W8.4 finds the recap-stats cliff, accept-residual-risk for Beta (with materialized-view fix on GA-1 roadmap) OR spend the 2 days in the contingency window? **Decide when W8.4 actually runs.** Default plan: spend the 2 days.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-repos-beta.md`.**

This is the master plan. **Each wave (W0 → W8) gets its own per-wave TDD plan written immediately before that wave's dispatch.** The per-wave plans follow the writing-plans skill default (per-step TDD granularity); this master plan does not.

**Two execution options for the W0 dispatch:**

1. **Subagent-Driven (recommended)** — Per-wave plan + per-task subagent dispatch via `superpowers:subagent-driven-development`. Fresh subagent per task, review between tasks, fast iteration. Each wave runs in its own worktree per `superpowers:using-git-worktrees`.

2. **Inline Execution** — Per-wave plan executed inline in the parent session via `superpowers:executing-plans`. Batch execution with checkpoints for review. Less safe for the longest waves (W1, W5) but lower overhead for the shorter ones (W0, W7).

**Recommended dispatch order:** W0 inline (small, gating) → W1 + W2 parallel subagents (long, parallelizable) → W3 inline (gated on W1) → W4 + W5 + W6 parallel subagents → W7 inline → W8 continuous (assertions and runbooks land per-wave-as-they're-built).

**Next step (post user-decisions):**
1. Commit `docs/superpowers/specs/beta/` + this plan to `main` as `docs: lock Beta master plan and Round 1–3 specialist deliberation`.
2. Dispatch Phase-2 specialist re-review (see "Plan-level execution sequence" step 3).
3. Fold any review corrections in-line; commit again as `docs: incorporate Phase-2 specialist re-review`.
4. Write the W0 per-wave plan.
5. Dispatch W0.

---

---

## Appendix A — Phase-2 specialist re-review (non-blocking gaps to absorb in per-wave plans)

Phase 2 dispatched 8 parallel specialists (Sports Med, Clinical Research, Backend, Frontend, Design, UI/UX, Infra, QA) to re-review this master plan against their own Round-1 findings. **All 8 returned green-light verdicts.** Two blocking gaps were fixed inline (W0.3 +`DATABASE_URL`-unset guard; W0.7 JWT-cache-invalidation test promoted from Risk register to explicit task). One missing file reference was corrected (W2.6 → `05-design.md` instead of phantom `Design_Spec_Destructive_Confirms.md`). Four high-value runbook items were folded into W8.6 (secret rotation, AUD drift recovery, container resource caps, test-isolation budget in W8.1). The remaining non-blocking gaps belong to per-wave plans, captured here so they don't get lost:

**W0 per-wave plan must absorb:**
- W0.2 — enumerate `navigation.smoke.test.tsx` + `AppShell.test.tsx` as the named test fixtures that need updating (Frontend gap #4 / R7).
- W0 acceptance bullet: "no `<SignInPage>` component ships" — explicit confirmation that CF Access pass-through is the only auth surface (Frontend gap #6 / B11).
- W0 acceptance bullet `- [ ]` task ownership: "update CLAUDE.md `## Scope` v2-out-of-scope list to remove GHCR + nightly backups + log rotation + s6-log" (Infra gap #7).

**W1 per-wave plan must absorb:**
- W1.1 — explicit unique index on `(user_id, client_request_id)` for idempotency contract (Backend NIT).
- W1.4 — define the `health_workouts` migration columns (mirrors W1.1 set_logs treatment): `(id BIGSERIAL, user_id UUID, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, modality TEXT, distance_m INT NULL, duration_sec INT, source TEXT)` + `(user_id, started_at, source)` UNIQUE dedupe + `ON DELETE CASCADE` FK to `users` (Backend gap #3 + #6).
- W1.4 — decide on RHR ingest piggyback or explicit cut (Clinical Research gap #2 / N1). **Recommendation: cut** — the dedicated half-day spike isn't worth Beta-blocking.
- W1.3 — component file paths `frontend/src/components/programs/TodayLoggerMobile.tsx`, `<LogBufferRecovery>`, `<SessionExpiredBanner>` named in per-wave plan (Frontend NIT).

**W2 per-wave plan must absorb:**
- W2.2 — render-full-on-both onboarding (resolves user-decision #6 above per recommendation); progress-track with mono caption `STEP 02 / 05 · GOAL` per `05-design.md`.
- W2.3 — PAR-Q soft-gate mechanism: spec whether a "yes" answer disables auto-progression (the load ramp short-circuits in `autoRamp.ts`) or is advisory-copy-only. Sports Med strongly recommends: **disable auto-progression**, surface read-only-progression mode (Sports Med gap #1).
- W2.5 — one-line rationale for `floor(target_sets * 0.6)` over Round-1's `sets ÷ 2` (Sports Med gap #2).

**W3 per-wave plan must absorb:**
- W3.1 — overreaching evaluator scopes to compound exercises only (`movement_pattern IN squat/hinge/horizontal_press/vertical_press/horizontal_pull/vertical_pull`) (Sports Med NIT).
- W3.1 — telemetry: `recovery_flag_events` rows capture toast-shown + toast-dismissed events so the heuristic can be tuned post-cohort (Clinical Research gap #3).
- W3.2 — surface joint-stress reason ("high knee load on squat with noted left-knee injury") not the user's raw injury note (Sports Med NIT).
- W3.3 — pick a placement for "Got a tweak?" on `<TodayWorkoutMobile>`: per-block "..." menu OR persistent FAB (UI/UX gap #3). **Recommendation:** per-block "..." menu.

**W4 per-wave plan must absorb:**
- W4.1 — color-tint-per-zone landmarks table (MV no-fill, MEV accent-tint α0.15, MAV warn-tint, MRV danger-tint) per `05-design.md`. "Apply to: this block / every occurrence" default-depends-on-context (mid-session = this block; program edit = every occurrence) (Design NIT, UI/UX NIT).
- W4.5 — if W4 is dispatched AFTER W2 ships, interim MesocycleRecap deload-button copy stays neutral until W4.4 backend lands (Frontend gap #1 / NH7).

**W5 per-wave plan must absorb:**
- W5.3 — pick persistence mechanism: **sentinel file at `/config/maintenance.flag`** (Infra recommendation; survives a corrupt-DB state in a way a `maintenance_mode` table row does not).
- W5.4 — verified-restorable badge tiers (`good`/`warn`/`danger`) per `05-design.md` snapshot-list spec; disabled-restore-on-`danger` behavior (Design gap #2).
- W5.4 — tighten maintenance banner copy: "RepOS is down for a database restore. ~60 seconds. Your last set is queued locally." (verb-first, no "briefly," no "automatically when service returns" hedge) (Design gap #6).
- W5.2 — `secret-rotation.md` and `cf-access-aud-drift.md` runbook entries (Infra gaps).
- W5.2 — Healthchecks.io UUIDs land in `.env` as `HEALTHCHECKS_BACKUP_UUID` + `HEALTHCHECKS_HEALTH_UUID`; provisioning is a sub-task of W5.2 (Infra NIT).
- W5.5 — DR test acceptance ties to `tests/dr/last-run.txt`; G5's "within 7 days before cutover" is mechanically enforced (Infra NIT).
- W5.7 — `repos-backup.sh` should prune `scheduler.log` at the 14-day mark to match the dump-retention window (Infra gap #6).

**W6 per-wave plan must absorb:**
- W6.6 — term-tooltip audit list extended to include **W2.3 PAR-Q ("PAR-Q", "moderate-intensity"), W4.1 `<DesktopSwapSheet>` ("push_horizontal", "peak_tension_length"), W5.6 pre-snapshot recovery ("snapshot"), W6.7 sign-out-everywhere banner ("bearer token")** (Frontend NIT).
- W6.3 — destructive-confirm severity tiers explicitly named per surface: heavy (type-program-name) for Abandon mesocycle; medium (single-modal confirm) for equipment-profile-reset-with-active-program; light (toast-undo) for delete-snapshot (Design gap #1).
- W6.7 — pre-action confirm modal copy "End this session on every device? This signs out every device, including your iOS Shortcut. Re-mint required." (medium-tier, accent not danger) (Design gap #4).
- W6.5 — mid-session-swap toast copy: `Swapped. Undo?` (Design NIT).

**W7 per-wave plan must absorb:**
- W7.4 — admin feedback view empty-state copy (Design gap #7).

**W8 per-wave plan must absorb:**
- W8.2 — explicit row for `GET /api/set-logs?planned_set_id=` (IDOR risk on list endpoints is highest) (Backend gap #4).
- W8.7 — post-deploy smoke runs against prod only (no staging — user override). Mitigation for "CF Tunnel routing surprises" risk is rollback-ready (W8.6 `rollback.sh`) + 10-min Healthchecks.io `/health` ping (W5.2). (Infra NIT, modified.)
- W8.8 — reachability map includes the "past mesocycles" list fallback case explicitly (UI/UX NIT).
- W8.9 — nginx per-IP rate-limit audit as a discrete checklist item (QA gap #3).
- W8.9 — typecheck-level rule banning `Intl.DateTimeFormat(...).format()` in favor of `formatToParts` per `project_alpine_smallicu.md` (QA gap #7).
- W8.9 — time-zone integration test crossing real midnight (QA gap #4).

**Sidebar Settings sub-nav (cross-wave coordination):**
- W4.3 (program-prefs), W5.4 (backups), W6.2 (account), W7.2 (feedback) all add Settings pages. The per-wave plans must coordinate sidebar ordering to avoid each wave inventing its own (UI/UX gap #1). **Recommendation order:** Account → Equipment → Integrations → Program prefs → Backups → Feedback. The W6 implementer owns the Settings sidebar layout authoritative.

---

*End of master plan. Bar is locked at 9 waves + 15 binary acceptance gates, with Phase-2 specialist re-review absorbed. Engineering proceeds to implementation; QA's role becomes test authoring (G1–G15 acceptance) + cohort-cutover gating.*
