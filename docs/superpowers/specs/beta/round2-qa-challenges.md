# Round 2 — QA Challenges to Engineering Composite

**Reviewer:** QA specialist (adversarial)
**Date:** 2026-05-07
**Target:** `round2-engineering-composite.md`
**Frame:** Beta = "live data, real users, no take-backs." Test bar is the gate; "ship clean" applies. Important findings do not become v1.5 backlog. Acceptance criteria must be testable; "we'll figure it out later" is not testable.

---

## Wave-level concerns

### W0 — Auth flip + cleanup
**What's right:** sequencing W0 first is correct — every contamination test in W8.2 needs CF Access live to be meaningful.

**Vague / risky:**
- **W0.5 (placeholder backfill).** "Backfill placeholder-owned rows to real user record after first real CF Access login." This is a one-shot SQL transaction that has not been written. *Required before merge:* the SQL ships in a numbered migration (or a `scripts/cutover/` script with idempotent re-runs), gated by a sentinel column so a re-run is a no-op. **The placeholder UUID's weight history attribution is precisely the test in D11 below.** Do not let this become "the engineer runs an ad hoc UPDATE on prod."
- **W0.3 startup guards.** Add a fourth: refuse boot if `NODE_ENV=production` AND a row exists with `user_id = '00000000-0000-0000-0000-000000000001'` after first-login cutover. This is the runtime guard from B11 / `feedback_ship_clean.md`. Don't rely on grep alone.
- **W0.4 account menu.** The `/cdn-cgi/access/logout` call only signs out the CF Access session at the edge. It does not invalidate any in-flight bearer tokens or in-app state. Acceptance must include "after logout, attempt to reuse a previously cached SPA route → reload → 302 to CF Access" as a Playwright assertion.

**Sequencing risk:** W0 must complete (and the placeholder backfill must run cleanly against alpha data) BEFORE W1 ships set_logs writes. Otherwise W1 will write set_logs rows attributed to whichever identity is active during the migration window.

### W1 — Live data foundation
**The big one. Most of QA's attention here.**

- **W1.1 dedupe index.** `(planned_set_id, date_trunc('minute', performed_at))` — what is the user-facing behavior when the user logs the same set twice within the same minute? Server returns 200 deduped:true? 409? Required: explicit acceptance criterion + integration test. Same-minute double-tap during a workout is not a hypothetical; it is the most common offline-replay case.
- **W1.2 24h immutable audit window.** Tests required: PATCH at T+23h59m → 200; PATCH at T+24h01m → 403/409 with explicit error; DELETE at T+25h → behavior? Spec is silent on whether DELETE has the same window. Pin it down.
- **W1.3 offline model — see "Hard-line additions" §1 below.** The IndexedDB queue is the single biggest under-specified surface in the entire composite. I am NOT accepting "best-effort sync" as an acceptance criterion.
- **W1.4 Workouts ingestion.** New scope `health:workouts:write` and a new bearer token. Required: token-scope contamination test (a `health:weight:write`-only token attempting POST to `/api/health/workouts` returns 403, NOT 200). The existing scope-check pattern is one place a copy-paste handler might forget to call `hasScope`.

**Missing from W1:** a Live Logger acceptance test that proves `set_logs` rows actually feed the recovery flag evaluators in W3. As written, W1 and W3 acceptance criteria don't transitively prove the data flows. Add: "Logging 3 RIR-0 sessions on a compound in W1 surfaces overreaching toast in W3" as an end-to-end Playwright case.

### W2 — Onboarding + clinical safety
**Mostly right.** Concerns:

- **W2.3 PAR-Q version bump re-prompt.** Required: a test that bumps `par_q_version` in DB and confirms next page load re-prompts the user, AND that the prior `par_q_acknowledged_at` is preserved (audit trail, not overwritten).
- **W2.5 manual deload.** The `mesocycle_run_events` reversal within 24h needs an explicit acceptance criterion and test. "Service-side reversal" without a test means the reversal SQL ships unverified. Required: integration test that calls `POST /deload-now`, asserts plan rewrite, calls `POST /deload-now/undo` (or whatever the reversal route is — it isn't named), asserts plan restored. Name the route.
- **W2.4 core taxonomy.** "Append 1-2 core blocks to each curated program's late-session slot" — does this mutate template versions, or only forks created post-cutover? Existing alpha-tester forks must not silently change underfoot. Pin the cutover semantics.

### W3 — Clinical signals + injury swap
**Acceptable as scoped.** The acceptance criterion ("Logging RIR 0 across 3 compound sessions surfaces overreaching toast") is testable. Hold to it.

Concern: "Surface as advisory in substitution sheet — never a hard block." Required test: an injured shoulder_left user CAN still select an overhead press if they want to; the advisory is non-blocking. Test the "user clicks through advisory" path, not just the "advisory shown" path.

### W4 — Desktop authoring + landmarks editor
**See D3 / hard-line additions for the landmarks-editor "feature flag" smuggling concern.**

- **W4.1 swap "Apply to: this block / every occurrence".** Required test for both branches; "every occurrence" is a multi-row UPDATE that must respect ownership at every row (the deepest IDOR risk in W4).
- **W4.4 deload intent.** ~40% sets reduction + RIR 3 — what's the rounding rule? Sets is integer; 40% of 3 sets is 1.2. Floor? Ceil? Pin it. Test the boundary.

### W5 — Backups + restore UI
**See "Hard-line additions" §3 — pg_restore atomic-rename has known footguns. Demand integration test, not a "documented procedure."**

- **W5.1 integrity check.** Good. Add: test that injects a known-bad gzip and confirms script exits non-zero AND deletes the bad file.
- **W5.5 DR test.** "Once per Beta release as deploy gate; quarterly thereafter." Required: the dry-fire ships as a CI-runnable script, not a manual procedure. A quarterly procedure that depends on human discipline drifts. `tests/dr/restore-into-ephemeral.sh` should be the artifact.
- **W5.4 force-reload after restore.** What happens to in-flight client requests during the atomic rename? The frontend force-reload covers the tab the admin is using, not other users' tabs. Required: rename is gated by maintenance-mode flag that returns 503 from `/api/*` for the duration of the rename + a few seconds buffer. Spec it.

### W6 — Account ops + destructive UX hardening
**Acceptable.** One missing test:
- **W6.1 DELETE /api/me cascade.** Required test: create user with mesocycle + set_logs + weight samples + tokens, DELETE /api/me, assert 204, assert all related rows gone in a single SELECT-COUNT round, assert orphaned rows = 0. The cascade is "existing FK on `users(id)`" — but the contamination matrix already showed how easy a missing FK is. Test the cascade explicitly.

### W7 — Feedback loop
**Acceptable as scoped.** Add: external smoke test that submits feedback as a real (non-admin) test user, asserts webhook delivery within 5s. This is the `feedback_verify_external_config.md` discipline — "configured" ≠ "working."

### W8 — Beta entry gates
**Engineering yielded on most of W8 — good.** But yielding on the line items isn't enough. Two specific concerns:

- **W8.4 k6 baseline.** Engineering yielded but did not commit a concurrency target. **Lock it: 25 VUs steady, 1→50 burst, per-endpoint p95 budgets per `08-qa.md`.** No optionality. See "Hard-line additions" §6 for the contingency plan.
- **W8.2 contamination matrix.** Engineering yielded — but did Engineering verify the matrix is exhaustive against the W1.1 / W1.2 / W1.4 / W2.5 / W4.1 / W4.4 / W6.1 NEW routes? The matrix in `08-qa.md` was written before this composite added routes. **Hard-line: every new route added in W1–W7 inherits a row in W8.2's contamination matrix.** Cost is per-route-1-test, ~5 lines each, but the matrix cannot ship stale.

**Sequencing risk in W8:** W8.4 runs k6 against… what? If staging doesn't exist, performance numbers from a developer laptop are not the production cliff. See "Hard-line additions" §4.

---

## Dispute-level rulings

### D1. Account deletion ships in Beta — **AGREE**
GDPR posture for live data is the right call. Engineering's reasoning is sound; cost is small. No challenge.

### D2. Apple Health Workouts ingestion ships in Beta — **AGREE WITH CONDITIONS**
Conditions:
- The `health:workouts:write` scope check has its own contamination test (separate from the existing `health:weight:write`).
- The iOS Shortcut authoring guide is committed to the repo, not a Notion page that drifts. Living in `docs/runbooks/ios-shortcuts.md` as the source of truth.
- 5-writes-per-day-per-user 409 limit (mirroring weight) is in scope; tested.

### D3. Landmarks editor behind feature flag, default ON — **AGREE WITH CONDITIONS**
Engineering is correct that flagging preserves option value. **But "default ON" means it ships to every Beta user.** The flag does NOT reduce QA scope.

Conditions:
- Validation tests (MV ≤ MEV < MAV < MRV, MV≥0, MRV≤50) ship with the feature, not with "we'll add validation later."
- A test that proves edited landmarks apply to next mesocycle and DO NOT mutate active runs (Clinical Research's actual concern — see `02-clinical-research.md` D1).
- A test that proves toggling the flag OFF mid-Beta (flipping the env var) hides the UI without breaking pages that read landmarks.

### D4. Active Sessions deferred to GA — **OVERRIDE WITH RATIONALE**
Engineering's reasoning ("CF Access JWT is stateless; building a parallel session table is GA scope") is mostly correct. But the user-facing risk is real: **a user who signs in on a phone at the gym and a desktop at home cannot revoke just the gym device.**

**Compromise — minimum acceptable Beta scope:**
- "Sign out everywhere" button in `/settings/account` that calls `/cdn-cgi/access/logout` AND invalidates ALL bearer tokens for the user (forces re-mint of iOS Shortcut bearer). This does not require a session table; it requires a token-bulk-revoke endpoint.
- Spec it as W6.7. Cost: ~30 lines. Tested.
- Per-device revocation (the full Active Sessions UI) defers to GA. Acceptable because CF Access JWT TTL is short (24h) and the bulk-revoke covers the "phone got stolen" scenario.

This is the floor. A "Sign out" button that only signs out the current device, with no path to revoke the other device, is below the bar for "live data, no take-backs."

### D5. No standalone Library page in Beta — **AGREE**
Reachable via swap flows in W3/W4. No challenge.

### D6. No History page in Beta — **AGREE WITH CONDITION**
Per-mesocycle recap on MyProgramPage is reachable. Condition: B7 user-reachability audit confirms a user can reach prior-mesocycle recap (not just the active run's recap). If prior mesos are inaccessible from `/`, that's a B7 fail and we add a "past mesocycles" list to MyProgramPage. Don't promise History and ship without the fallback.

### D7. Cardio live logger deferred — **AGREE WITH CONDITIONS**
This is the harder of the disputes. Clinical Research called cardio first-class (`feedback_cardio_first_class.md`); Apple Health Workouts ingestion (W1.4) covers the iPhone-runner case. **But the manual-cardio-at-the-gym case is genuinely uncovered** (treadmill at a commercial gym, user doesn't wear an Apple Watch).

Conditions for accepting deferral:
- The "no UI for manual cardio" gap is documented in PASSDOWN.md and surfaced in the Beta first-run disclaimer ("Cardio is logged automatically via Apple Health Workouts; manual cardio entry arrives in patch release X").
- Acceptable to QA because the alpha tester (likely first Beta user) is iPhone-attached and the gap doesn't block them.
- **If a Beta user complains in week 2, the patch ships immediately, not "in next sprint."** Document this commitment.

### D8. 5-step onboarding (skip schedule) — **AGREE**
Templates have fixed weekday assignments. Schedule customization is a real GA feature; no test value in shipping it half.

### D9. 3 goals (no cardio-only) — **AGREE**
No cardio template = no goal. Correct call.

### D10. Forward-only with two-step destructive — **AGREE WITH HARDENED GATE**
Engineering's framing is right: two-step destructive (add → backfill → switch reads → switch writes → drop in *next* migration) is the policy. **But W8.6's gate is too soft as written.**

Hardened gate:
- Pick the latest non-trivial migration AT BETA CUTOVER. Run forward against a clone of alpha data → restore-from-backup → reapply against scratch DB. Capture as a script that can be re-run for every subsequent migration.
- Every PR introducing a Step-2 (destructive) migration MUST link to a successful dry-run output committed to the PR. CI rejects Step-2 migrations without a dry-run artifact.
- Data-rescue plan in PR is mandatory, not "documented in PR."

This is harder than what Engineering proposed. I am holding the line.

### D11. Split cutover: wipe programs, preserve weight — **OVERRIDE WITH CONDITIONS**
This is the dispute Engineering is most likely to slip on. "Sounds clever but doubles the migration surface."

**Specific concerns Engineering must answer before I accept:**

1. **Who owns the backfill SQL?** Backend, named engineer, in PR. Not "Backend team."
2. **Who tests it?** Per W8 contamination matrix, the backfill SQL must have a test that runs against a CLONE of the actual alpha database (jmeyer's current state), not synthetic data. The synthetic-data test catches schema bugs; the alpha-clone test catches data-shape bugs.
3. **The placeholder UUID weight history.** The alpha DB has weight rows attributed to `00000000-0000-0000-0000-000000000001`. After CF Access first-login, the new real user (`jmeyer@`) gets a real UUID. **Required test:** weight rows attributed to placeholder are reattributed to jmeyer's new UUID in a single transaction; before/after row counts match exactly; no row is duplicated; no row is orphaned.
4. **What happens to placeholder-attributed rows if a SECOND Beta user signs in before the cutover script runs?** The script must be idempotent AND must NOT reattribute any row that's already been reattributed. Required: a sentinel column `migrated_from_placeholder_at TIMESTAMPTZ` on `health_weight_samples` so re-runs are no-ops on already-migrated rows.

If Engineering can't commit to all four, fall back to Path A (hard reset, including weight). The user's weight history is two months; recreating from Apple Health backfill is a 30-second `Shortcut`. The migration risk dominates the data-loss "loss."

**Conditional acceptance:** if 1–4 are met, split cutover is acceptable. Else, Path A everything.

### D12. Cohort 5–10 → 25 — **AGREE**
This is my number. Hold the line at 10 for week 1.

### D13. 6-month Beta + exit metrics — **AGREE WITH STRICTER FLOOR**
"30 days no Sev-1 + 5 users complete a mesocycle" is a reasonable floor for the AVAILABILITY half of the gate. But it doesn't cover **clinical safety** or **data correctness**.

**Add to the exit gate:**
- Zero Sev-2 in the final 14 days (catches "users blocked on critical flow" that doesn't trip Sev-1).
- Zero PAR-Q-bypass incidents (a user got past PAR-Q without acknowledging it = Critical bug, not Sev-1 by the runbook definition).
- Backup-restore dry-fire test passes within the final 30 days (per W8.6 quarterly cadence — but at GA cutover the test must be fresh).
- No outstanding Important security findings (per `feedback_ship_clean.md` — applies at GA exit too).
- At least 5 users completed a full mesocycle AND submitted feedback (the feedback loop closing is a usage signal, not just a click signal).

This stricter floor doesn't lengthen the 6-month target meaningfully — it just prevents "we hit 30 days but our last DR test was 5 months ago" from being acceptable.

---

## Hard-line additions (Engineering didn't include these)

### 1. Live Logger offline failure-mode test plan (W1.3)
"Optimistic local + best-effort sync via IndexedDB queue" is not a spec; it is a wave of the hand. Required test cases, all in Playwright + IndexedDB inspection:

| # | Scenario | Required behavior | Test |
|---|---|---|---|
| O1 | Server returns 409 (validation conflict) on a queued set | Banner: "1 set rejected — tap to review." Set stays in queue, marked rejected, user can edit + resubmit OR delete. Does NOT silently drop. | Playwright: queue 3 sets offline, mock 409 on one, assert UI surfaces it |
| O2 | Page reloads mid-queue | Queue persists in IndexedDB; on reload, banner reads "N sets queued" and resumes flush on next online tick. No double-submit. | Playwright: queue 5 sets offline, reload, assert queue intact |
| O3 | User switches devices mid-workout (phone → tablet) | New device sees the same `mesocycle_run` state from server. Sets logged on phone (offline) appear on tablet AFTER phone reconnects. Conflict resolution: server timestamp wins. | Integration: log set on device A, log conflicting set on device B (online), assert latest-write-wins |
| O4 | Network drops mid-flush | Queue marks in-flight set as "pending"; on reconnect, retry with exponential backoff. Does NOT double-submit on retry. | Idempotency key on POST /api/set-logs (client UUID); test that two POSTs with same UUID return the same row id |
| O5 | User logs same set twice (double-tap) | Server's `(planned_set_id, date_trunc('minute', performed_at))` dedupe returns 200 with prior row. | Integration test |
| O6 | IndexedDB quota exceeded | Banner: "Storage full — clear older offline sessions in Settings." User can clear. App does not crash. | Manual + Playwright with mocked quota error |
| O7 | Queue abandoned (user closes app, doesn't reopen for 7d) | On reopen, queue is still there. User can flush OR clear. App surfaces the staleness. | Playwright with date manipulation |
| O8 | Set logged offline with a `planned_set_id` that the server has since deleted (e.g., user forked a new mesocycle on another device) | 404 from server on flush; banner: "1 set could not sync — original workout no longer exists." Move to "rejected" bucket. | Integration |

**Data-loss budget for offline:** ZERO sets silently dropped. Every queued set either lands or surfaces a user-visible failure with a path to retry/edit/delete. This is the bar.

### 2. JWT cache invalidation on Cloudflare key rotation (Backend risk #5)
Engineering's composite did not address this. Required:
- Test that simulates JWKS rotation (CF Access publishes new key, deprecates old) and asserts the cache invalidates within the documented TTL.
- Acceptance: a JWT signed by the rotated-out key returns 401 (not 500), and a fresh JWT signed by the new key returns 200, both within 60s of rotation.
- If Backend can't write this test against real CF Access (no staging), they can mock JWKS and assert the cache-bust logic. Mocked is acceptable for this one.

### 3. pg_restore atomic-rename integration test (W5.3)
"pg_restore into side-DB, atomic rename" has these known footguns:
- Active connections to `repos` block the rename. Need to terminate them first (`pg_terminate_backend`).
- The rename is two ALTER DATABASE statements; they're not atomic together. A crash between them leaves the system with two unnamed databases.
- After rename, the pool needs to reconnect; existing connections will throw on next query.

**Required:** an integration test in `api/tests/integration/restore.test.ts` that:
1. Starts a real Postgres in a Testcontainers/Docker setup.
2. Writes a known dataset.
3. Triggers the restore flow.
4. Asserts post-restore: data matches the dump, app reconnects within Xs, no orphaned databases, `repos_old_<ts>` exists for cleanup.
5. Crash-mid-rename test: kills the API process between the two ALTERs and asserts the DB can be recovered manually with a documented procedure.

This is non-negotiable. "Audit by inspection" is not enough for a procedure that, when wrong, eats user data.

### 4. Staging environment story
Engineering's open question #2: "Where do load tests run? Where do Playwright tests run?" My answer is in §"Answers to Engineering's open questions" below — but the hard-line addition:

**Beta-blocking:** spec a sibling staging container at `repos-staging.jpmtech.com` BEFORE W8.4 / W8.3 ship. Local docker-compose mirrors the s6-rc tree but does NOT mirror:
- Cloudflare Tunnel ingress
- Cloudflare Access policy
- Real DNS resolution
- Production Node + Alpine + small-icu Intl behavior (per `project_alpine_smallicu.md`)
- Production Postgres pool sizing under real network latency

W8.4's load numbers from local docker-compose are not the production cliff. Cost: one engineer-day to spec the staging container. Cheaper than discovering the cliff in production.

### 5. Migration of placeholder weight to first-login user (W0.5)
Engineering buried the actual SQL. Required to ship in W0.5:
- Numbered script `scripts/cutover/001-placeholder-to-jmeyer.sql` (idempotent, sentinel-gated).
- Pre-flight `pg_dump` triggered by the script before it does anything.
- Dry-run output committed to the W0 PR.
- Post-run row-count assertion.

This is also the test for D11 condition #3.

### 6. Performance contingency (W8.4)
Engineering committed to a baseline but did NOT budget for the failure case. Required addition:

**If W8.4's measurement reveals any p95 > 2× the documented budget at 25 VUs:**
- Beta cutover SLIPS until the cliff is moved or the budget is renegotiated with documented rationale.
- This is the PASSDOWN entry: "performance findings outside budget block Beta admission."
- Time-boxed: 5 engineering days to fix-or-renegotiate. After that, escalate.

The recap-stats CTE is the most likely cliff (per `mesocycles.ts` block comment). If it's 5× budget, the fix is "materialize the recap stats into a table and refresh on session-end" — a 2-day task that can land in the contingency window.

Without this contingency, "we measure but don't act on what we measure" is theater.

### 7. New routes inherit contamination tests (W8.2)
Every route added in W1–W7 (set-logs CRUD, deload-now, customize, restore endpoints, feedback POST, etc.) gets a row in W8.2's matrix. The matrix at the bottom of `08-qa.md` was written against the existing route list; the composite adds ~10 new routes. Test count goes from ~25 to ~35. Cost is ~5 lines per row. Non-negotiable.

### 8. CF Access expiry mid-set-log recovery test
Engineering's open question #7 describes the design ("frontend stashes log buffer in localStorage, redirects to CF Access login, hydrates after re-auth"). Required test:
- Playwright: log 2 sets, manipulate JWT to expired, attempt 3rd set, assert redirect to CF Access AND localStorage has buffered set.
- After re-auth simulation, return to logger, assert buffered set posts.
- Acceptance: zero sets lost across token expiry.

---

## Concessions where Engineering's position holds

These are items where Round-1 QA pushed for more, but Engineering's reasoning is sound on review.

1. **Visual regression tests pushed back to "important, defer to early GA."** Cost is real, value is moderate, alternatives exist (E2E click-through catches most CSS regressions if assertions are written against visible text not pixel-perfect). I withdraw the Important label and accept "Beta-nice-to-have, GA-required." `08-qa.md` flagged it as Important; downgrading to Nice-to-have. Frontend gets a pass on this one IF Playwright E2E coverage is robust (W8.3 ~15 tests).

2. **Frontend MSW integration tests** — Engineering's open question #4. The current contract-test pattern combined with Playwright E2E is sufficient because Playwright runs against the real API in W8.3. MSW would test "frontend matches mock matches API" (3-leg consistency); we get the same coverage from "frontend → real API" via Playwright. **Withdrawn.**

3. **Per-migration inverse SQL.** Engineering's two-step destructive policy is genuinely better than my Round-1 "every migration ships with inverse" position. The two-step pattern eliminates the need for inverse on most migrations. **Accept with the hardened W8.6 gate (D10).**

4. **Onboarding 5-step (no schedule).** Round-1 didn't take a strong position; Engineering's framing (D8) is correct. **Concede.**

5. **History page deferred.** Per-mesocycle recap reachable from MyProgramPage is enough IF B7 user-reachability covers prior-meso recap. **Concede with the B7 condition above.**

---

## Answers to Engineering's open questions to QA

### Q1: Acceptable test isolation runtime?
**Answer: per-file DB transactions with rollback.** Reasoning:
- Shared `repos_test` DB with `--no-file-parallelism` is current state and serializes the suite. Adding 50 integration tests linearly = unacceptable CI time growth.
- Ephemeral PG per CI run is too heavy for the 50-integration-test scale and adds cold-start latency to every PR.
- Per-file DB transactions wrapping each test in `BEGIN ... ROLLBACK` lets tests run in parallel safely. Vitest supports this pattern via `beforeEach(beginTx); afterEach(rollback)`. Some tests genuinely need committed state (those exceptions can opt-in to a serial fixture); 95% don't.
- Budget: integration suite under 90s on CI. If we exceed, sharding by file is the next lever.

### Q2: Staging environment?
**Answer: spec staging at `repos-staging.jpmtech.com`. Beta-blocking.** See "Hard-line additions" §4. Local docker-compose is acceptable for unit + frontend dev; it is NOT acceptable for W8.4 (load) or W8.3 (E2E auth flow against real CF Access). The CF Access policy + CF Tunnel ingress cannot be mirrored locally.

If Engineering pushes back on staging cost: the alternative is "ship Beta blind to production-only failure modes." Not acceptable for live data.

### Q3: Visual regression tests?
**Answer: withdrawn — see Concessions §1.** Beta-nice-to-have, GA-required. Don't budget for it in the wave plan.

### Q4: Frontend MSW integration tests?
**Answer: withdrawn — see Concessions §2.** Playwright E2E covers the same loop.

### Q5: Per-migration inverse SQL?
**Answer: accept the two-step destructive policy WITH the hardened W8.6 gate.** See D10 above. The PR-must-link-to-dry-run-artifact requirement is the part that's non-negotiable.

### Q6: Beta exit criteria?
**Answer: Engineering's floor + the 5 stricter additions in D13 above.** "30 days no Sev-1 + 5 users complete a mesocycle" is a reasonable starting point; the additions (zero Sev-2 in final 14d, zero PAR-Q-bypass, fresh DR test, no Important security debt, feedback-loop closure) prevent obvious gaming.

### Q7: CF Access expiry recovery UX?
**Answer: testable as designed, with the test in "Hard-line additions" §8.** Engineering's design (localStorage buffer → CF Access redirect → hydrate after re-auth) is correct. The test must assert zero set loss across the expiry. If localStorage is unavailable (Safari private mode), the user sees a blocking modal: "Your session expired. Please sign in to save 3 unlogged sets." Spec the Safari-private case.

---

## New disputes I'm raising for Round 3

### ND1. The "Sign out everywhere" minimum viable session control (challenges D4)
Engineering: defer Active Sessions UI to GA — agreed. But: ship a single "Sign out everywhere" button that bulk-revokes all bearer tokens for the user. ~30 lines, mitigates the phone-stolen scenario, is below the bar of a full session table. **Engineering must respond: accept or override with rationale.**

### ND2. Staging environment is Beta-blocking
Engineering's open question #2 framed it as negotiable. I'm not negotiating. Spec it as W0.6 (cheap to stand up alongside the auth flip; same Cloudflare tunnel topology). **Engineering must respond: accept the wave addition or override.**

### ND3. Performance contingency budget (W8.4)
Engineering committed to measure but not to act. The 5-engineering-day fix-or-renegotiate window in "Hard-line additions" §6 needs an explicit response. **Engineering must respond: accept the contingency or propose alternative.**

### ND4. pg_restore atomic-rename integration test (W5.3)
The test in "Hard-line additions" §3 is hard-required. Engineering must commit to writing it OR drop the side-DB-rename strategy in favor of a simpler (less risky) restore approach. **Engineering must respond: write the test or pick a different restore strategy.**

### ND5. D11 condition compliance
Per the four conditions in D11 above (named owner, alpha-clone test, placeholder-attribution test, idempotency sentinel). If Engineering can't commit to all four, the cutover falls back to Path A. **Engineering must respond: confirm all four or fall back to Path A.**

### ND6. Cardio-at-the-gym manual entry SLA
D7 acceptance was conditional on a documented commitment that a Beta user complaint triggers patch-release shipping. **Engineering must respond: confirm the commitment or upgrade cardio live logger to W1 scope.**

---

## Beta entry gate — locked-down acceptance language

This is the verbatim text QA will use to evaluate "is Beta ready." Each line is a binary pass/fail. No partial credit.

### G1 — CI hardening
**PASS:** `.github/workflows/test.yml` has three required jobs (api-unit, api-integration, frontend-unit) AND `main` branch protection lists all three plus typecheck + build as required checks AND the most recent 5 PRs to land on main show all checks green AND a deliberately-broken PR was opened to confirm the gate blocks merge.

### G2 — Multi-user contamination
**PASS:** Every route in §"Multi-user data isolation test plan" of `08-qa.md` PLUS every route added in W1–W7 (set-logs CRUD, deload-now, customize, restore, feedback, account delete, landmarks PATCH, etc.) has a passing integration test in `api/tests/integration/contamination/` AND `mkUserPair()` fixture exists in `api/tests/helpers/` AND every test asserts 404 (or 403, never 200-with-other-user-data). Test count is ≥35.

### G3 — Auth flow E2E
**PASS:** Playwright suite in `tests/e2e/` covers: (a) unauthenticated → CF Access redirect; (b) signed-in lands on `/`; (c) sign-out clears state and re-redirects; (d) "Sign out everywhere" revokes all bearer tokens (per ND1); (e) expired CF Access JWT mid-set-log buffers in localStorage, recovers after re-auth, zero sets lost; (f) iOS Shortcut bearer mint → use → revoke → use returns 401. All run green against staging environment.

### G4 — Live Logger offline contract
**PASS:** All 8 scenarios in "Hard-line additions" §1 (O1–O8) have passing tests AND Playwright video evidence shows zero silent set loss across O1, O2, O4, O5, O8.

### G5 — Backup integrity + restore
**PASS:** Manual backup from `/settings/backups` produces a sidecar JSON entry AND `gunzip | pg_restore -l` integrity check passes AND restore-into-ephemeral test in `tests/dr/restore-into-ephemeral.sh` passes against the latest production dump AND atomic-rename integration test (per "Hard-line additions" §3) passes including the crash-mid-rename recovery case AND DR dry-fire was performed within the last 7 days before cutover.

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

---

**All 15 gates green = Beta cutover authorized. Any red = Beta slips. No partial cutovers, no "ship 13 of 15." This is the bar.**

*End of QA Round 2 challenges.*
