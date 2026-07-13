# 2026-07-13 — Codebase Quality Pass (tidy sweep)

**Context:** Feature-stable window while Milestone 2 (alpha tester's mesocycle) runs on prod. Five parallel read-only audits (dead code, redundancy, performance, test-suite health, deps/config/docs hygiene) completed 2026-07-13. This plan converts their findings into small, independently-green, **behavior-preserving** PRs.

**Hard constraints:**
- Live user on prod mid-mesocycle — nothing may change user-visible behavior or the API contract. Perf fixes must produce identical responses, faster.
- Every PR passes all 8 required checks independently; frequent small PRs, not one mega-PR.
- No destructive migrations; no schema changes at all in this pass.
- `RepOS.html` + root `*.jsx` prototype untouched. `Engineering Handoff.md` untouched.

**Out of scope (explicitly deferred, with reasons):**
- Major version bumps (React 19, recharts 3, react-router 7, TS 7) — separate scoped efforts, not "tidying."
- CI action SHA-pinning + composite-action extraction — worthwhile but M-effort CI surgery; workflow-file pushes need SSH (gh token lacks workflow scope). Park unless requested.
- Query-builder abstraction over hand-written SQL — auditor explicitly recommends against.
- Backups page visual polish — parked per standing decision.
- `volumeRollup` caching, extra indexes — auditor: not worth it at N=10.

---

## PR slicing (execution order)

### PR-Q1 — Dead code deletion (api + frontend)
High-confidence orphans, verified by reference-tracing:
- Delete `api/src/services/jointStress.ts` + `api/tests/jointStress.test.ts` (weekly evaluator, wired nowhere; live code uses `muscleJointStress.ts` — do NOT touch that).
- Delete `api/src/services/predicateCompiler.ts` + its test; fix the stale pointer comments in `api/src/schemas/predicate.ts:5` AND `api/src/schemas/plannedSets.ts:52` (references the deleted `plannedSetSubstitute.ts`).
- Delete `api/src/schemas/materializeStartInput.ts`, `plannedSetPatch.ts`, `plannedSetSubstitute.ts` + their three tests (superseded duplicates; live schemas in `userPrograms.ts` / `plannedSets.ts`).
- Delete `api/src/services/warmupSets.ts` + test (feature-orphan, never wired).
- Delete `frontend/src/lib/featureFlags.ts` (real gate reads `VITE_BETA_LANDMARKS_EDITOR` directly) and `frontend/src/lib/api/jointStress.ts` (zero consumers).
- Delete unused types `WeightBackfillInput`/`WeightBackfillResponse` from `frontend/src/lib/api/health.ts` (keep the file).
- **Gate:** full grep re-verification of each symbol immediately before deletion (audits age); tsc + full test suites both sides.

### PR-Q2 — Hygiene quick wins (docs/env/gitignore/deps)
- `api/.env.example`: `DATABASE_URL` → `postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test` (retired-host value misleads new devs).
- Add commented `FEEDBACK_WEBHOOK_URL` to `api/.env.example`; add `VITE_BETA_LANDMARKS_EDITOR` (default `on`) to `frontend/.env.example`.
- `CLAUDE.md`: "Status: alpha, deployed" → Beta in-flight; "Vite 5" → "Vite 8". Mirror to local `AGENTS.md`.
- `.gitignore`: add `.playwright-mcp/` and `*-live.png`.
- `frontend`: targeted `npm install react-router-dom@6.30.4` (moderate open-redirect advisory GHSA-2j2x-hqr9-3h42). NOT `npm audit fix` (unbounded lockfile drift) — it's a **minor** jump from 6.30.3, so inspect the lockfile diff for exactly one subtree and run the Playwright e2e job (router minors have shipped behavior changes before).
- `frontend/playwright.config.ts`: `__offline__/*.spec.ts` → `__offline__/**/*.spec.ts` (future nested specs would silently drop).
- **Owner decision folded in (see Decisions):** `REPOS_API_DIR` phantom var.

### PR-Q3 — Test-suite cleanup + de-fragilization
- Delete `describe.skip` block with 7 empty tests in `api/tests/integration/csrf-origin.test.ts:183` (verified zero assertions; coverage live elsewhere). Leave a one-line pointer to the deferred cases' spec (`2026-05-25-w6-account-ops.md:884-957`) so they aren't silently forgotten.
- Delete stale ".skip-gated" comments in `scope-enforcement.test.ts` + `set-logs-to-recovery-flags.test.ts` (tests are live; comments mislead).
- Delete `frontend/src/lib/__sanity__/sanity.test.ts` (asserts 1+1); trim `deps.test.ts` to the babel-import case only.
- **Merge, don't delete:** fold the root `api/tests/integration/manual-deload-undo-contamination.test.ts` case into `contamination/manualDeload-contamination.test.ts`. Reviewer confirmed they are NOT duplicates — the root file applies a real deload first and asserts the foreign undo can't unwind it (no `manual_deload_undone` row); the contamination file only tests the no-deload-present 404 path. Both scenarios must survive.
- De-fragilize `api/tests/programs.test.ts:44`: assert `slugs ⊇ CURATED_SLUGS` instead of exact `=== 4` + exact list. **KEEP the beforeAll archived_at restore** — it is slug-scoped (not global) and is the belt-and-suspenders pair to the seed suite's best-effort afterAll; dropping it reintroduces the known interrupted-run flake (`reference_test_db_cruft`). Accept the documented tradeoff: `⊇` no longer catches a seed that fails to archive a removed 5th template.
- Add optional `scopes` param to `mkUserPair`/`mkLoneUser`; stop re-minting in `weight-contamination.test.ts`.
- ~~Remove sleeps in par-q/beta-disclaimer idempotency tests~~ — **dropped per review**: the 20/50ms gaps are load-bearing (timestamp precision means a rewrite could produce an equal serialized value without the gap; removing them makes the no-rewrite assertion vacuously passable). Keep as-is.

### PR-Q4 — Redundancy consolidation (S items)
- `materializeMesocycle.ts:15-16`: delete inline deload constants, import from `_deloadConstants.ts` (in-code TODO says exactly this; blocker — W2 unmerged — is long gone). Naming decision made here: **import `MANUAL_DELOAD_MAV_FACTOR`/`MANUAL_DELOAD_RIR` under local aliases** (`const DELOAD_MAV_FRACTION = MANUAL_DELOAD_MAV_FACTOR` etc.) — do NOT rename the exports or touch `manualDeload.ts`; the `_deloadConstants.ts` header documents the shared-knob intent and anticipated separate `FULL_DELOAD_*` constants if they ever diverge.
- `manualDeload.ts`: extract shared `PLANNED_SET_SNAPSHOT_COLUMNS` + recordset-type helper so snapshot SELECT (92-95) and restore INSERT (284-297) cannot drift.
- Import `rowMode()` from `lib/effort.ts` in `DayCard.tsx`, `TodayWorkoutMobile.tsx`, `ProgramTemplateDetail.tsx` — replace inline ternaries (canonical-seam bypass; the exact drift the effort.ts header warns about).
- `plannedSets.ts`: extract `loadOwnedPlannedSet()` + `assertNotPastDay()` shared by PATCH + substitute handlers (intra-file only; do NOT generalize across routes).

### PR-Q5 — Date-format consolidation (M)
- New `frontend/src/lib/formatDate.ts`: `formatShortDate`, `formatSessionDate` (moved from HistorySheet), `formatZonedDate` — formatToParts-based per `project_alpine_smallicu`.
- Migrate the 5 `toLocaleDateString` sites + 2 `TodayLoggerMobile` locals + `ActiveSessionsTable`/`AccountEventsTimeline` helpers where output-identical. **Rule: rendered output must be pixel-identical; any site where consolidation changes visible text gets left alone and noted.**

### PR-Q6 — Performance (backend, the k6 hot spots)
- `getTodayWorkout.ts`: `Promise.all` the 4 independent leaf reads (lastCompleted, setRows, cardioRows, profileRow).
- `getTodayWorkout.ts` + `substitutions.ts`: memoize `findSubstitutions` per `ex_slug` per request; hoist `fetchUserInjuries` to one call.
- `recoveryFlags.ts`: `Promise.all` the evaluators (keep per-evaluator fail-closed try/catch; preserve registry-insertion order in the response `flags` array via ordered map); pass `current_week`/`goal` via ctx to kill redundant active-run re-reads; batch `isDismissed`/`recordFlagShown`. Note: hoisting `goal` converts a lazy query to eager — must carry over the no-active-run default ("≠ cut", flag may fire) unchanged.
- Substitution memoization must be **per-request** (a `Map` created inside the handler scope — profile/userId vary across requests; no module-level cache).
- **Gate:** responses byte-identical (add/extend unit tests asserting shape before refactor); integration suites green. Reviewer confirmed `db` is a pg Pool (not a shared client), so parallel queries are safe — no transaction/interleaving hazard.

### PR-Q7 — Performance (frontend) + test speed
- Isolate the rest timer's 1 Hz tick from the logger tree. **Design (per review — this is NOT the mechanical useHoldTimer move):** the parent (`TodayLoggerMobile`) has two real consumers of timer state — `restTimer.start()` on set completion and the `paddingBottom: 72` layout reservation on hub+focus views. Plan: parent keeps only a coarse `restActive` boolean (changes on start/expire — 2 renders per rest, drives the padding), while `RestTimerPill` owns `useRestTimer` and the per-second `remaining` state; parent triggers starts via a ref/callback handed to the pill. A naive hook-move loses the 72px reservation and the pill overlaps content — user-visible on the live tester's phone. Manual verify on mobile viewport + offline specs green.
- Fake-timer the IDB poll-cadence tests (`useIdbQueueCounts`/`useIdbQueueStatus`) to reclaim ~3s of the frontend suite.

### PR-Q8 — Refactor safety net (coverage backfill; can run parallel to Q4–Q7)
Direct unit tests for: `stats.ts`, `deriveInjuryConstraints.ts`, `recoveryFlagEvents.ts`, `equipmentProfile.ts`, `parQRateLimit.ts` (all S) + `backupRunner.ts` run-state/error branches (M). Written against CURRENT behavior before Q6 touches adjacent code where applicable.

---

### PR-Q9 — Fixture-family convergence (added per owner decision)
Converge `api/tests/helpers/seed-fixtures.ts` and `program-fixtures.ts` on a single user/token primitive: make `program-fixtures.mkUser` the base (or vice-versa after inspecting call sites), route ALL bearer minting through `mintBearer`, and have `mkLoneUser`/`mkUserPair` delegate. ~76 importing files — mechanical but wide; runs LAST (after Q1–Q8 merge) so it rebases onto the settled test tree. Full api unit + integration suites are the gate.

## Decisions — RESOLVED by owner 2026-07-13

| # | Question | Default if no strong opinion |
|---|----------|------------------------------|
| D-a | `GET /api/muscles/joint-stress` route: frontend client is dead (deleted in Q1) → route has zero product consumers. Delete route + tests, or keep as planned surface? | **DECIDED: delete** — route + its integration/contamination tests go in Q1 alongside the client. `services/muscleJointStress.ts` STAYS (consumed by `deriveInjuryConstraints.ts`); only the route/registration dies. |
| D-b | `PATCH`/`DELETE /api/cardio-logs/:id`: no UI yet. Keep (edit UI plausibly coming) or delete? | Keep — cardio is first-class; edit UI is a natural follow-up |
| D-c | `/dev/picker` demo cluster (`ExercisePickerDemo` + `SubstitutionRow`, DEV-gated): keep as dev harness or delete? | Keep — zero prod cost, useful playground |
| D-d | `REPOS_API_DIR` env var: the hygiene audit called it phantom, but review found it IS read — by `scripts/run-restore.sh:37` (`API_DIR="${REPOS_API_DIR:-/app/api}"`), just not by TypeScript. Keep the `.env.example` entry and fix its comment (it wrongly claims `restoreRunner.ts` reads it), or delete? | Keep + fix the comment — it's a real knob with a container-correct default |
| D-e | Fixture-family convergence (`seed-fixtures` vs `program-fixtures`, 76 importing files) — M effort, touches half the api test suite. Do now or defer? | **DECIDED: include** — added as PR-Q9, runs last. |

(D-b keep cardio PATCH/DELETE, D-c keep dev picker, D-d keep `REPOS_API_DIR` + fix comment — defaults accepted.)

## Sequencing rationale
Q1–Q3 are pure deletions/doc fixes (near-zero risk, immediate noise reduction). Q8 safety net lands before/alongside Q6 so the perf refactors have direct unit guards. Q4/Q5 are mechanical consolidations guarded by existing suites. Each PR: branch off main → 8 checks → merge; no stacking needed (independent surfaces).

## Review record

Adversarial review 2026-07-13: **SHIP-WITH-FIXES** — 2 Critical (sleeps are load-bearing; programs.test restore is slug-scoped and must stay), 4 Important (manual-deload test is complementary not duplicate; `REPOS_API_DIR` is read by `run-restore.sh`; rest-timer isolation needs the padding design; `npm audit fix` → targeted install), 3 Nice-to-have (deload-constant naming, second stale comment, csrf breadcrumb). All 9 applied inline above. Reviewer independently confirmed: every PR-Q1 deletion has zero consumers; Q6 Promise.all is pool-safe with no ordering/transaction hazard; PR slicing has no hidden coupling.

## Verification per PR
- `npx tsc --noEmit` + full unit suites on every touched side; `npm run test:integration` (api) when api behavior-adjacent code moves; offline/e2e Playwright when logger surfaces move (Q7).
- Q6 additionally: before/after response-shape assertions; optional local k6 spot-check of `today`.
- Prod redeploy only after the wave completes (single redeploy, not per-PR), followed by outside-in smoke + a live `today` check.

## Execution record — COMPLETE 2026-07-13

All nine PRs merged same-day (#68–#76), each green on all 8 required checks.
Single prod redeploy: `APP_SHA=7ad90fc`, rollback tag
`rollback-20260713T150609Z`; outside-in 302/401 green; post-deploy smoke
workflow success; live meso data verified intact via in-container psql
(1 active run / 10 set_logs / 121 planned_sets). Suite deltas: api unit
575→597, integration 325 (skips 7→0), frontend 626→629, offline matrix
10/10. Full narrative in `docs/PASSDOWN.md` §2026-07-13.

Notable deviations from the plan, decided during execution: bodyweightCrash
goal lookup kept lazy (Q6 — hoisting costs the common case); MyLibrary
created_at + all time formats left on user locale (Q5 pixel-identical rule);
manual-deload undo test merged into the contamination file rather than
deleted (Q3, reviewer catch); direct-evaluate tests now pass real weekIdx
(Q6 exposed they'd been passing a dead placeholder).
