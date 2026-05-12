# Round 3 — QA Final Confirmation

**Reviewer:** QA specialist (closing alignment, adversarial frame retired)
**Date:** 2026-05-07
**Target:** `round3-engineering-response.md`
**Frame:** This is the final confirmation. Engineering accepted G1-G15 verbatim and resolved all 6 deadlocks. The remaining QA work is verifying that ND4's strategic concession (maintenance-mode restore) doesn't open a new failure surface, and spot-checking the wave plan for hidden dependencies.

---

## ND4 maintenance-mode restore — review

Engineering swapped the side-DB-rename strategy for a maintenance-mode flag + drained-API + `pg_restore --clean` against the live database. This is a real concession on Engineering's part: they gave up the "zero-downtime restore" story to eliminate a known footgun (two non-atomic ALTERs + pool reconnect race + active-connection blocking).

**On the merits, the swap is genuinely cleaner.** I should have proposed it myself in Round 2. Acknowledged in §"Acknowledgments" below. But it does introduce three new failure modes that need explicit test coverage, and one that needs an operational decision.

### New failure mode 1 — Maintenance flag survival across API crash mid-restore

**Risk:** if the maintenance flag is in-process (a module-level boolean) and the API crashes between `s6-rc -d change api` and `s6-rc -u change api`, the flag dies with the process. On restart, the API comes up "normal" and accepts traffic against a half-restored DB. Data corruption.

**Mitigation:** the flag MUST be a `maintenance_mode` table row (or a sentinel file at `/config/maintenance.flag`), not in-process state. Engineering's spec says "in-process or a `maintenance_mode` table row" — that "or" needs to become "MUST be persisted." The persisted version survives crash, the in-process version doesn't.

**Required test (new):** `api/tests/integration/restore-crash-recovery.test.ts` — start restore, kill API process during pg_restore step, restart API, assert API boots into maintenance mode (not normal mode), assert /api/* routes still 503, assert admin can manually clear the flag once they verify DB state.

**Acceptance:** the maintenance flag is a row in `maintenance_mode` table or a file at a known path; bootstrap reads it before opening port 80; clearing requires admin action (not auto-clear on boot).

### New failure mode 2 — `s6-rc -d change api` request drain semantics

**Risk:** s6-rc sends SIGTERM. If the API doesn't have a SIGTERM handler that drains in-flight requests + closes the pool gracefully, in-flight requests get cut mid-write. Worse: if Fastify's `close()` is called but a long-running query is still executing, the connection is forcibly closed and the query may have already committed but the response never reaches the client. The client retries on a different replica (no replicas here, single container, so it retries against the same DB) and gets a duplicate write.

**Mitigation:** API needs a SIGTERM handler that:
1. Stops accepting new connections (Fastify `close()`).
2. Waits for in-flight requests to finish, with a 30s timeout.
3. Closes the pg pool gracefully.
4. Exits 0.

If any in-flight write is a `set-logs` POST, the idempotency key (per W1.3 acceptance: `client_request_id UUID`) covers the duplicate-write case on retry. So this is actually less scary than it looks — IF the idempotency key is wired into every write endpoint, not just set-logs.

**Required test (new):** `api/tests/integration/sigterm-drain.test.ts` — issue 10 concurrent POST /api/set-logs requests, send SIGTERM mid-flight, assert all 10 either complete or fail with retriable error code, assert no partial writes (no rows with NULL required fields).

**Acceptance:** SIGTERM handler exists in `api/src/server.ts`, `s6-rc -d change api` waits up to 30s before SIGKILL (configurable in s6 service definition), pg pool `end()` is called before process exit.

### New failure mode 3 — Migration step between pg_restore and API restart fails partway

**Risk:** Engineering's spec step 4 is "Run migrations against the restored DB to bring it to current schema." If the production code is on schema v50 and the dump was taken at v47, the restore brings the DB to v47, then migrations 48/49/50 must run to catch up. **What if migration 49 fails?**

The DB is now at v48 (partially migrated), which doesn't match production code (v50). Restarting the API will hit schema-mismatch errors on first query. The maintenance flag is still set, which is good (users get 503), but the admin UI itself runs through the same API — the admin can't see the failure.

**Mitigation options:**
1. **Strict path:** restore is gated to "dump schema version must equal current schema version." Refuse restore if migrations are pending. Operationally simple but means admins can't restore older dumps after a schema change. Acceptable in v1 because production deploys + restores are rare.
2. **Recovery path:** if migrations fail, leave maintenance flag set, surface error to admin via a dedicated `/api/maintenance/status` endpoint (the only endpoint that doesn't 503 in maintenance mode), provide a "rollback to pre-restore snapshot" button that restores from `scripts/pre-restore-snapshot.sh` output.

**Required path:** option 2 (recovery path). The pre-restore snapshot already exists per Engineering's spec ("Backup keep-window: still 24h via the standalone `pg_dump` taken pre-restore"); the missing piece is that the admin UI must be able to trigger restore-from-pre-restore-snapshot WHILE the rest of the API is in maintenance mode. So `/api/maintenance/*` routes are the maintenance-mode escape hatch.

**Required test (new):** `api/tests/integration/restore-migration-failure.test.ts` — restore an older dump, mock migration 49 to throw, assert API stays in maintenance mode, assert `/api/maintenance/status` returns the failed-migration error, assert `/api/maintenance/restore-pre-snapshot` succeeds and brings DB back to pre-restore state, assert maintenance flag clears after successful pre-snapshot restore.

**Acceptance:** maintenance-mode routes (`/api/maintenance/*`) bypass the 503 middleware; admin UI has a "restore failed — roll back to pre-snapshot" recovery flow; the pre-restore snapshot is created BEFORE the destructive `pg_restore --clean`, not after.

### Operational decision needed — Maintenance window comms

The 30-60s 503 window is acceptable to QA, but it needs a comms story. If a Beta user is mid-set-log when an admin triggers a restore, they get the 503 banner and lose their in-flight request. The IndexedDB queue (W1.3) holds the set offline; on reconnect (post-maintenance), the set flushes. **This is fine IF the maintenance banner copy says "Restore in progress — your last set is saved offline and will sync when we're back."**

**Required:** explicit copy in W5.4 frontend acceptance: maintenance banner reads "RepOS is briefly down for a database restore. Your last logged set is saved on this device and will sync automatically when service returns. Estimated: 60 seconds." This makes the offline-queue story user-visible during the only time it matters.

### ND4 verdict

**Acceptable with three new tests** (restore-crash-recovery, sigterm-drain, restore-migration-failure) and one acceptance edit (persisted maintenance flag, not in-process). All three tests are roughly half-day each. Total addition: ~1.5 engineer-days. Cheaper than the original atomic-rename test plan (~2 days) and covers the failure modes the simpler approach actually has.

**The strategic concession is good.** Engineering picked a less risky implementation in exchange for accepting a small downtime window. The downtime is invisible to users in normal operation (restores are rare admin actions), and the offline queue covers the in-flight set-log case. **Not a Round 4 trigger.** The three new tests fold into G5's acceptance language naturally.

---

## Wave plan review

9 waves, 3-4 weeks. Spot-checked for hidden dependencies and Beta-blocking gaps.

### Sequencing soundness

**Critical path (W0 → W1 → W3) is correct.** W3's overreaching toast can't fire without `set_logs` data being written, which is W1.3. W1.3 can't be tested against a real auth flow without W0.1. The chain holds.

**Parallelism model is realistic** for a single engineer + agents:
- W0 → serialize.
- W1 (long pole) + W2 (independent) can run parallel from day-3 of W1.
- W4/W5/W6 are mutually independent and can run parallel from W0 complete.
- W7 closes; W8 runs continuously.

**One sequencing concern: W3 depends on W1, NOT just W1.1-W1.3 — it also depends on W1.4 (Workouts ingest).** Why: the recovery-flag evaluator pulls from BOTH set_logs AND workouts (cardio strain affects recovery scoring per `feedback_cardio_first_class.md`). If W3 ships before W1.4, the recovery flags are computed against incomplete data and the toast accuracy degrades.

**Required clarification in wave plan:** W3 cannot start until W1.1 + W1.2 + W1.3 + W1.4 are all merged. The current plan says "W3 depends on W1" which is technically right but understates that W1.4 isn't optional for W3 to be correct. Fold this into the wave plan footnote.

### Hidden dependencies — spot check

- **W4.1 swap "every occurrence":** depends on W1's set_logs schema being final (specifically the `planned_set_id` column). If W4.1 ships before W1.1's dedupe index, the multi-row UPDATE pattern is unverified against the live dedupe behavior. **Risk:** W4 starting day-5 means W1 must have W1.1 merged by day-5. Tight but doable.
- **W6.1 cascade test:** depends on W1.4 (workouts ingestion adds new tables that need cascade tested). The cascade test as Engineering specced it covers `mesocycle + set_logs + weight samples + tokens` — needs to add `workouts` rows. Trivial addition, but flag it: W6.1 acceptance text needs an "and workouts" entry.
- **W5.3 restore (now maintenance-mode):** depends on the pre-restore snapshot script existing. That script is implicit in the new ND4 spec but not called out as its own task. **Required:** add W5.3.0 — implement `scripts/pre-restore-snapshot.sh` and ensure it's invoked as the first step of the restore route handler. Half-day.
- **W8 contamination matrix:** depends on every W1-W7 route being merged. Engineering accepted matrix expansion (~37 tests), but the matrix can only be authored AFTER all the routes ship. **Operational risk:** if W8 starts authoring on day-N and W6 ships on day-N+2, the matrix is racing the wave plan. **Mitigation:** W8.2 author writes a row IMMEDIATELY when each route lands; doesn't wait for all-routes-shipped. Engineering should add this to the W8 internal sequencing.

### Anything Beta-blocking missing

Reviewed against `Engineering Handoff.md` and the memory entries. Three items I'd flag:

1. **Settings → restore-from-pre-snapshot UI** (per ND4 new failure mode 3). Not currently in the wave plan. Folds into W5 (1 day). **Required addition: W5.6 — pre-snapshot recovery UI.**

2. **Maintenance flag bootstrap check.** Per ND4 new failure mode 1, the API must check the persisted maintenance flag at boot before opening port 80. Folds into W0.3 startup guards (small addition). **Required: W0.3 +1 guard for maintenance mode.**

3. **Per-route author assigning the contamination test** (per W8.2 race risk above). Process amendment, not a wave addition. Engineering's W8 internal sequencing needs this discipline.

None of these are Round 4 triggers. They fold into existing waves.

### Wave plan verdict

**Acceptable with the four amendments above** (W3 depends on W1.4 not just W1.1-1.3; W6.1 includes workouts cascade; W5.3.0 pre-restore snapshot script; W5.6 pre-snapshot recovery UI; W0.3 +1 guard; W8.2 author-on-route-land). All are clarifications or small adds, totaling ~1 engineer-day. Wave count stays at 9. Total time stays at 3-4 weeks.

---

## Confirmations

### 1. All 6 deadlocks resolved? (ND1-ND6)

| ND | Resolution | Confirmed |
|----|------------|-----------|
| ND1 | "Sign out everywhere" → W6.7 | YES |
| ND2 | Staging environment → W0.6 | YES |
| ND3 | Performance contingency → W8.4 amended | YES |
| ND4 | Maintenance-mode restore (strategic concession) | YES, with 3 new tests + persisted flag (above) |
| ND5 | D11 four conditions accepted | YES |
| ND6 | Cardio patch SLA accepted | YES |

**All 6 resolved.** ND4's resolution adds tests but not a new deadlock.

### 2. All hard-line additions accepted? (8 items)

| # | Subject | Accepted in spec |
|---|---------|------------------|
| 1 | Live Logger O1-O8 offline tests | YES — W1.3 |
| 2 | JWT cache invalidation test | YES — W0 post-flip |
| 3 | pg_restore restore test | YES, reframed via ND4 |
| 4 | Staging environment | YES — W0.6 |
| 5 | Placeholder cutover SQL | YES — W0.5 hardened |
| 6 | Performance contingency | YES — W8.4 amended |
| 7 | New routes in contamination matrix | YES — W8.2 expanded to ~37 |
| 8 | CF Access expiry mid-set-log recovery test | YES — W1.3 + Safari-private modal |

**All 8 accepted.**

### 3. Wave plan acceptable?

**YES, with the four amendments documented in §"Wave plan review"** above. None are blockers; all fold into existing waves. Critical path (W0 → W1 → W3) is correctly identified. Parallelism model is realistic.

### 4. G1-G15 accepted verbatim?

**YES.** Engineering accepted the locked-down acceptance language without edits. QA confirms no further edits to G1-G15. The 15 gates are the bar.

One note: G5 (backup integrity + restore) needs to incorporate the three new ND4 tests (restore-crash-recovery, sigterm-drain, restore-migration-failure) into its acceptance language. This is an additive clarification, not a rewrite. Updated G5:

> **G5 — Backup integrity + restore**
> **PASS:** Manual backup from `/settings/backups` produces a sidecar JSON entry AND `gunzip | pg_restore -l` integrity check passes AND restore-into-ephemeral test in `tests/dr/restore-into-ephemeral.sh` passes against the latest production dump AND maintenance-mode restore integration test (per ND4) passes including (a) the standard restore happy path, (b) the API-crash-mid-restore recovery case, (c) the SIGTERM-drain test, (d) the migration-failure-rollback-to-pre-snapshot case AND DR dry-fire was performed within the last 7 days before cutover.

This is the only G-language edit. Engineering pre-approved it via the ND4 acceptance.

### 5. Path to Round 4 if ND4 introduces something new?

**Not triggered.** The three new failure modes I identified (crash mid-restore, SIGTERM drain, migration failure mid-restore) are testable within the maintenance-mode strategy. None require a different restore approach. The fix is three additional tests + the persisted-flag acceptance edit, all of which Engineering can implement in W5 without re-architecting.

**Bar is locked.**

If any of the three new tests proves un-implementable during W5 (genuinely unlikely — they're standard Testcontainers patterns), QA reserves the right to re-open ND4 with a smaller-scoped concern. But this is a process safety net, not an active Round 4 trigger.

---

## Final blocking concerns (if any)

**None — bar is locked.**

The four wave-plan amendments (W3 depends on W1.4; W6.1 includes workouts; W5.3.0 pre-restore snapshot; W5.6 pre-snapshot recovery UI; W0.3 +1 guard for maintenance flag; W8.2 author-on-route-land) are clarifications that fold into existing waves. Engineering can implement them without re-planning. They are documented here so they don't get lost between Round 3 close and implementation kickoff.

The G5 acceptance-language edit (above) is the only G-text change, and it's additive (more tests required), not subtractive.

**Beta cutover authorization:** when all 15 gates (G1-G15) are green per the acceptance language, with G5 amended per above, Beta cutover is authorized.

---

## Acknowledgments

Items where Engineering's reasoning was better than QA's Round-1 position, or where Engineering proposed something QA should have proposed first:

1. **ND4 maintenance-mode restore.** I should have proposed this in Round 2. The atomic-rename approach was the obvious "minimize downtime" choice but it has known footguns (active-connection blocking, two non-atomic ALTERs, pool reconnect race) that I correctly flagged. I told Engineering to write a hard test for it. Engineering's response — "if the test surface is this scary, pick a less scary implementation" — is the engineering-craft answer. A 30-60s downtime for a rare admin operation is an acceptable cost; the simpler approach is more reliable in production. Engineering won this exchange.

2. **Two-step destructive migration policy.** Conceded this in Round 2 already, but worth restating: the two-step pattern is genuinely better than my Round-1 "every migration ships with inverse SQL" position. It eliminates the inverse-SQL maintenance burden for 80% of migrations. The hardened W8.6 gate (PR-must-link-to-dry-run-artifact) is the right complement.

3. **Visual regression tests deferred.** Conceded this in Round 2. Playwright E2E coverage is the right answer at this scale; pixel-perfect visual regression is GA-era infrastructure.

4. **MSW frontend integration tests withdrawn.** Conceded this in Round 2. Real-API Playwright coverage is the same loop with fewer moving parts.

5. **Cohort starts at 10, not 25.** Engineering accepted my number. Worth noting: this is the most expensive number to get wrong (too high = chaos in week 1; too low = slow signal). Engineering didn't fight on it; that's the right call.

6. **D7 cardio patch-on-complaint SLA.** Engineering's 7-day SLA + the 3-day patch effort estimate (cardio logger reuses ~70% of strength logger surface) is well-bounded. The deferral is acceptable because the patch path is short.

---

## Process retrospective

Three rounds, ~24 hours of synthesized adversarial review. From an initial Engineering composite that had 13 disputed line items + 8 wave-level vagueness flags to a locked spec with 15 binary acceptance gates and 6 resolved deadlocks.

What worked: the adversarial frame forced specificity. Phrases like "best-effort sync" and "documented procedure" got translated into testable acceptance criteria. The 15-gate format makes "is Beta ready" a binary decision per gate, not a vibe.

What I'd do differently: I should have proposed the ND4 maintenance-mode strategy myself rather than waiting for Engineering to concede. Telling Engineering to write a scary test, when the scariness is a signal that the implementation choice is wrong, is the wrong move. Next time: when a test surface looks high-risk, propose the simpler implementation BEFORE demanding the test.

**Bar is locked. Engineering proceeds to implementation. QA's role becomes test authoring (G1-G15 acceptance) + cohort-cutover gating.**

*End of QA Round 3 confirmation.*
