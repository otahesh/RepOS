# Round 3 — Engineering Response to QA Challenges

> Synthesizer: planning lead, speaking for Engineering composite (Backend + Frontend + Infra)
> Inputs: `round2-engineering-composite.md`, `round2-qa-challenges.md`
> Goal: close the 6 deadlocks, accept hard-line additions, lock the bar.

QA produced a strong adversarial pass. Most of their pushes are technically correct; Engineering yields on the substance. One strategic concession (ND4) where Engineering changes approach to eliminate a high-risk procedure rather than test-cover it.

---

## Deadlock resolutions

### ND1 — "Sign out everywhere" button (challenges D4) → **ACCEPT**

QA is right. A user with a stolen phone needs a kill switch that doesn't require us to find every device. The "no session table = no Active Sessions UI" decision still holds, but the bulk-revoke is below the bar of a session table.

**Spec addition: W6.7 — Sign out everywhere**
- **Backend (S):** `POST /api/auth/signout-everywhere` — admin-key-NOT-required, CF-Access-required. Deletes all `device_tokens` rows for `req.userId`, returns 204. Calls also need to clear CF Access cookie via `Set-Cookie: CF_Authorization=; Max-Age=0`.
- **Frontend (S):** Button in `/settings/account` "Sign out everywhere" with light confirm modal. After click → redirects to CF Access logout. Banner: "Signed out everywhere. Re-mint your iOS Shortcut bearer in Integrations."
- **Test (G3 line e):** Mint two bearer tokens for user, sign out everywhere, both tokens 401.

Cost: ~30 lines backend + one modal frontend. Worth the user-facing safety.

### ND2 — Staging environment is Beta-blocking → **ACCEPT**

QA is right. Local docker-compose can't validate CF Access policy + CF Tunnel + production Node + small-icu Intl behavior. Production-only failure modes are the ones that bite at Beta cutover.

**Spec addition: W0.6 — Stand up staging container**
- **Infra (M):** New container `RepOS-staging` at `192.168.88.66` on `br0` (sibling IP).
- New CF Tunnel route: `repos-staging.jpmtech.com` → `http://192.168.88.66:80`.
- New CF Access app: `RepOS Staging` with allow-list = engineering team only (1 email).
- Separate `.env` at `/mnt/user/appdata/repos-staging/.env` with separate `ADMIN_API_KEY`, separate `POSTGRES_PASSWORD`.
- Separate Postgres data dir at `/mnt/user/appdata/repos-staging/config/postgres`.
- Same image stream as prod (`ghcr.io/otahesh/repos:latest`); deploys via the same recipe; sized 2g/2cpu like prod.
- **Used for:** k6 load tests (W8.4), Playwright E2E (W8.3), pre-prod migration smoke (W5.5 + G6), DR restore validation (G5).
- **Reset cadence:** wiped + reseeded weekly via cron during Beta. Synthetic users only — never holds real-user data.

Cost: one engineer-day to stand up. Eliminates an entire class of "works locally, breaks in prod" bugs. Accept.

### ND3 — Performance contingency budget → **ACCEPT**

QA is right. Measuring without committing to act is theatre. Lock it.

**Spec amendment: W8.4 — k6 baseline + contingency**
- If any hot endpoint's p95 exceeds 2× the documented budget at 25 VUs steady, OR any endpoint returns ≥1 5xx during the 1→50 VU burst:
  - **Beta cutover slips.** PASSDOWN entry: "performance findings outside budget block Beta admission."
  - **Time-boxed contingency:** 5 engineering days to fix-or-renegotiate. After 5 days, escalate to user (project lead) for explicit accept-residual-risk decision.
  - Renegotiation requires written rationale (e.g. "the recap-stats CTE p95 is 4× budget but it's only called at end-of-mesocycle, real-world frequency is 1× per 4 weeks per user, accept-residual-risk for Beta with materialized-view fix scheduled GA-1").
- Most likely cliff: `/api/mesocycles/:id/recap-stats` (the per-exercise PR CTE; block comment in `mesocycles.ts` flags it). Pre-budgeted fix: materialize on session-end-event into a `recap_stats_cache` table, refresh via trigger. ~2 engineer-days.

### ND4 — pg_restore atomic-rename integration test → **STRATEGIC CONCESSION: pick simpler restore strategy**

QA is right that the side-DB-rename approach has known footguns (active connection blocking, two non-atomic ALTERs, pool reconnect edge cases). The cost of testing all the failure modes is higher than the cost of choosing a less risky approach.

**Spec amendment: W5.3 — Restore strategy revised**

Original (deprecated): pg_restore into side-DB → atomic rename → keep `repos_old_<ts>` for 24h.

**New approach: Maintenance-mode restore.**
1. `POST /api/backups/:id/restore` (CF Access + admin-key + typed-confirm) sets a maintenance flag (in-process or a `maintenance_mode` table row) → all `/api/*` routes return 503 with `Retry-After: 60` for the duration.
2. Send `SIGTERM`-via-s6 to the API service: `s6-rc -d change api`. API drains pending requests + closes pool.
3. `pg_restore --clean --if-exists --no-owner --no-privileges` against the live `repos` database.
4. Run migrations against the restored DB to bring it to current schema.
5. `s6-rc -u change api`. API restarts, opens fresh pool, picks up maintenance flag clear.
6. Frontend force-reloads (window.location.reload).

**Trade-off:** ~30-60s of 503 visible to users during restore (acceptable for a rare admin-only operation; users see the maintenance banner). Eliminates: active-connection blocking, two-stage rename atomicity, pool reconnect chaos, side-DB cleanup. Less code, less test surface.

**Required test (still ships):** `api/tests/integration/restore.test.ts` — start Testcontainers Postgres, write known dataset, take dump, mutate dataset, restore from dump, assert dataset matches dump. Cost: ~half-day (vs. ~2 days for the rename approach + crash-recovery cases).

**Backup keep-window:** still 24h via the standalone `pg_dump` taken pre-restore (`scripts/pre-restore-snapshot.sh` runs before maintenance-mode + the actual restore). User retains undo via "restore from this 'pre-restore-X' snapshot" if the restored data turns out wrong.

### ND5 — D11 split-cutover four conditions → **ACCEPT ALL FOUR**

QA's four conditions are reasonable. Engineering commits.

1. **Named owner: Backend engineer** (the one who works W0). Code lives in `scripts/cutover/001-placeholder-to-jmeyer.sql`.
2. **Alpha-clone test:** test runs against a `pg_dump` of jmeyer's actual alpha database (taken 2026-05-07 or later), not synthetic data. Captured as `tests/cutover/alpha-clone.test.sh`.
3. **Placeholder reattribution test with row-count assertion:**
   ```sql
   -- before
   SELECT count(*) FROM health_weight_samples WHERE user_id = '00000000-0000-0000-0000-000000000001';
   SELECT count(*) FROM health_weight_samples WHERE user_id = (SELECT id FROM users WHERE email='jason@jpmtech.com');
   -- after cutover
   -- placeholder count = 0; jmeyer count = original placeholder count + original jmeyer count (likely 0)
   -- AND no row appears twice (assert via SELECT id FROM hws GROUP BY id HAVING count(*) > 1 returns 0).
   ```
4. **Idempotency sentinel:** add column `health_weight_samples.migrated_from_placeholder_at TIMESTAMPTZ`. Cutover SQL only updates rows WHERE `user_id = placeholder AND migrated_from_placeholder_at IS NULL`. Re-run is a no-op.

Pre-flight: cutover SQL triggers a `pg_dump` snapshot before any UPDATE; snapshot is the rollback path.

### ND6 — Cardio-at-the-gym manual entry SLA → **ACCEPT**

QA's condition: Beta-user complaint about manual cardio entry triggers patch release immediately, not "next sprint."

**Engineering commits.** Documented in PASSDOWN section "Beta SLA commitments":

> **Cardio manual entry — patch-on-complaint SLA.** D7 deferred the cardio live logger to post-Beta. The known gap: a user who does cardio at a commercial gym without an Apple Watch has no UI surface to log the session. If a Beta user submits a feedback row (W7.2) reporting this gap, Engineering ships a patch release with the cardio logger UI within 7 days of the report. Tracked via the feedback triage cadence.

The patch is genuinely cheap: cardio logger reuses ~70% of the strength logger surface (W1.3), specifically the per-block UI shape, the IndexedDB queue, the API client. Net-new is the cardio-specific input (modality + duration + distance + avg HR if available). ~3 engineer-days for the full patch.

---

## Wave-level concerns — Engineering accepts

QA flagged specific items per wave. Engineering accepts all of these as scope amendments (most are clarifications, not net-new work):

### W0 (Auth flip + cleanup) — accepted amendments
- **W0.3 (startup guards) +1 guard:** refuse boot if `NODE_ENV=production` AND a row exists with `user_id = '00000000-0000-0000-0000-000000000001'` after first-login cutover. Implemented via runtime SELECT in the bootstrap; if the row exists, exit non-zero with clear log.
- **W0.4 (account menu) acceptance:** add Playwright assertion "after logout + reload, attempt to access cached SPA route → 302 to CF Access."
- **W0.5 (placeholder backfill) hardened:** ships as numbered cutover script (per ND5), not ad-hoc SQL.

### W1 (Live data foundation) — accepted amendments
- **W1.1 dedupe explicit behavior:** server returns `200 {deduped: true, set_log_id}` on collision (consistent with weight-ingest pattern). Integration test captures double-tap-within-minute.
- **W1.2 24h immutable window:** PATCH after 24h returns `409 {error: 'audit_window_expired', performed_at, max_edit_at}`. DELETE has the **same** 24h window — past 24h, the row is permanent, surface as "Set logged 25h ago — locked. Add a correction set instead?"
- **W1.3 offline contract:** all 8 scenarios (O1–O8) ship as part of W1.3. Idempotency key on `POST /api/set-logs` body: `client_request_id UUID` (from offline queue); duplicate POSTs with same `client_request_id` return the same row id. Banner copy + recovery paths spec'd in W1.3 frontend acceptance.
- **W1.4 Workouts scope test:** scope contamination test (`health:weight:write`-only token attempting `/api/health/workouts` returns 403) ships in W8.2 contamination matrix.
- **NEW W1 acceptance:** "Logging 3 RIR-0 sessions on a compound exercise via `POST /api/set-logs` surfaces the overreaching toast on the next `/api/recovery-flags` poll" — end-to-end Playwright case in W8.3.

### W2 — accepted amendments
- **W2.3 PAR-Q version bump test:** required. Asserts that bumping `par_q_version` re-prompts AND `par_q_acknowledged_at` is preserved per-version (the table grows: `par_q_acknowledgments(user_id, version, accepted_at)` rather than overwriting one row).
- **W2.4 core taxonomy cutover semantics:** templates are versioned (already in V1 schema). Adding core blocks ships as a NEW template version. Existing alpha-tester forks reference the OLD version and don't change underfoot. Per-mesocycle materialization-at-start preserves this.
- **W2.5 manual deload:** route name is `POST /api/mesocycles/:id/deload-now`. Reversal is `POST /api/mesocycles/:id/deload-now/undo`. Both ship with integration tests + acceptance criteria. 24h window on undo.

### W3 — accepted amendment
- **Advisory non-blocking test:** Playwright case where injured-shoulder_left user opens swap sheet, sees overhead-press demoted with "high shoulder load" advisory, clicks-through anyway, set logs successfully.

### W4 — accepted amendments
- **W4.1 swap "every occurrence" ownership:** integration test asserts that "every occurrence" UPDATE returns 404 if any one row's parent `mesocycle_run.user_id` mismatches `req.userId`. Ownership checked at every row, not just the first.
- **W4.4 deload intent rounding:** rule is `floor(target_sets * 0.6)` for sets reduction, with minimum 1 set. RIR pinned to 3 (not 4) to preserve some training stimulus. Test boundary: 3-set block reduces to 1, 5-set to 3, 1-set stays 1 (floor of 0.6 is 0, clamp to 1).

### W5 — accepted amendments
- **W5.1 integrity check test:** ships as `tests/dr/integrity-check.test.sh` — injects known-bad gzip into `/config/backups/`, runs `repos-backup.sh` validate-only flag, asserts non-zero exit + bad file deleted.
- **W5.5 DR test as CI script:** `tests/dr/restore-into-ephemeral.sh` is the artifact, runnable in CI. Quarterly cadence is enforced by `tests/dr/last-run.txt` (committed timestamp; CI fails if older than 100 days).
- **W5.4 maintenance-mode flag:** spec'd in ND4 above. Frontend reads `503 {error:'maintenance', retry_after_s}` and shows blocking banner; on reconnect, force-reload.

### W6 — accepted amendment
- **W6.1 cascade test:** ships as `api/tests/integration/account-deletion.test.ts`. Creates user with mesocycle + 100 set_logs + 30 weight samples + 2 bearer tokens; DELETE /api/me; asserts 204; SELECT count from each table WHERE user_id = deleted_id returns 0; SELECT orphan rows WHERE foreign_key NOT IN users returns 0.

### W7 — accepted amendment
- **W7.4 external smoke:** test feedback submission as a non-admin user via Playwright (using a second CF Access JWT for a test user) lands in the `feedback` table within 5s, webhook delivery confirmed.

### W8 — accepted amendments
- **W8.4 lock 25 VUs steady + 1→50 burst.** Per-endpoint p95 budgets per `08-qa.md` table. Run against staging (per ND2).
- **W8.2 matrix expansion:** every NEW route added in W1–W7 inherits a row in the contamination matrix. Test count goes from ~25 to ~37 (set-logs CRUD x3, deload-now x2, customize x1, restore x4, feedback x1, account delete x1, landmarks PATCH x1). Cost ~3 engineer-hours total.

---

## Hard-line additions — Engineering accepts

1. **Live Logger offline failure-mode test plan (O1–O8).** Ships as part of W1.3. Spec'd above.
2. **JWT cache invalidation test.** Ships as part of W0 (after W0.1 flip-on). Mocked JWKS rotation acceptable per QA's allowance (no real CF Access rotation needed).
3. **pg_restore restore test.** Reframed via ND4 — simpler maintenance-mode strategy with simpler test.
4. **Staging environment.** W0.6, accepted (ND2).
5. **Placeholder weight cutover SQL.** W0.5 hardened (per ND5 + above).
6. **Performance contingency.** W8.4 amended (ND3).
7. **New routes in contamination matrix.** W8.2 expanded (above).
8. **CF Access expiry mid-set-log recovery test.** Ships as part of W1.3 (offline contract) + Safari-private case adds blocking modal: "Your session expired. Sign in to save N unlogged sets."

---

## Conditions on prior accepts — Engineering confirms

- **D2 Workouts ingestion conditions:** all 3 accepted. Separate scope test (W8.2 row), Shortcut guide at `docs/runbooks/ios-shortcuts.md`, 5-writes-per-day-per-user 409 limit.
- **D3 landmarks editor conditions:** all 3 accepted. Validation tests, "next-meso-only" test, "flag-off-doesn't-break-readers" test.
- **D6 History deferral condition:** B7 reachability audit confirms prior-meso recap is reachable from `/`. If gap, ship a "past mesocycles" list on MyProgramPage (S, ~30 LOC).
- **D7 cardio commitment:** W7-day SLA on patch release accepted (above, ND6).
- **D10 hardened W8.6 gate:** PR-must-link-to-dry-run-artifact accepted. CI script `scripts/check-migration-dryrun.sh` checks PR description for required link.
- **D13 stricter exit floor:** all 5 additions accepted. Encoded in G15 acceptance language.

---

## Updated Beta wave plan (final)

**Total:** 9 waves, ~3-4 weeks of engineering time across the cohort. Sequenced for safe parallel work where possible.

| Wave | Subject | Cost | Sequencing notes |
|------|---------|------|------------------|
| **W0** | Auth flip + cleanup + staging | 2-3 days | Must complete before W1 ships. W0.6 (staging) parallelizes with W0.1-W0.5. |
| **W1** | Live data foundation (set-logs API + UI + Workouts ingest) | 5-7 days | Largest wave. Can begin once W0.1 complete. |
| **W2** | Onboarding + clinical safety (PAR-Q, deload, abs) | 3-5 days | Parallel with W1 from day-3. |
| **W3** | Clinical signals + injury swap | 2-3 days | Depends on W1 (needs set_logs writing in prod). |
| **W4** | Desktop authoring + landmarks | 2-3 days | Parallel with W2/W3 from day-5. |
| **W5** | Backups + restore UI | 3-4 days | Parallel with W2/W3/W4 from W0 complete. |
| **W6** | Account ops + destructive UX | 2-3 days | Parallel with W2/W3/W4/W5 from W0 complete. |
| **W7** | Feedback loop | 1-2 days | Last 1-2 days of cohort. |
| **W8** | Beta entry gates | 3-5 days | Runs continuously across W0-W7; closes after W7. |

**Critical path:** W0 → W1 → W3 (sets the longest dependency chain). W1.3 is the long pole.

**Parallelization model:**
- Single engineer + agents: serialize W0, then W1 + W2 in parallel, then merge for W3, then W4-W6 in parallel, then W7, then W8 closes.
- Multi-agent dispatch (per memory `feedback_get_plan_reviewed`): each wave's tasks are bounded enough to dispatch as parallel worktree agents once W0 settles auth.

---

## Deadlock status: ALL RESOLVED

| ND | Subject | Resolution |
|----|---------|------------|
| ND1 | Sign out everywhere button | Accepted, spec'd as W6.7 |
| ND2 | Staging environment | Accepted, spec'd as W0.6 |
| ND3 | Performance contingency | Accepted, amended W8.4 |
| ND4 | pg_restore atomic-rename | Strategic concession — simpler maintenance-mode restore |
| ND5 | D11 four conditions | Accepted all four |
| ND6 | Cardio patch SLA | Accepted, documented in PASSDOWN |

---

## QA's 15-gate Beta entry checklist (G1-G15) → **ACCEPTED VERBATIM**

Engineering does not modify a single line of QA's locked-down acceptance language. The 15 gates are the bar.

---

## What Engineering is asking QA to confirm

This is the final round; please confirm:

1. **All 6 deadlocks resolved?** ND1-ND6 above — yes/no per item.
2. **All hard-line additions accepted in spec?** Yes/no.
3. **Wave plan acceptable?** Sequencing, parallelism, total cost.
4. **G1-G15 verbatim accepted?** No further edits to acceptance language.
5. **Open path to Round 4 if Engineering's ND4 strategic concession (maintenance-mode restore) introduces a new failure mode you haven't considered.** Otherwise Beta plan locks.

If all 5 are yes, the bar is set. Engineering proceeds to write the implementation plan. QA's role becomes test authoring + cohort-cutover gating.

---

*End of Engineering Round 3 response. Bar is locked pending QA's final confirmation.*
