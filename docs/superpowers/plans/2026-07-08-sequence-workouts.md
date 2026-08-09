# Sequence-Based Workouts, History & Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace date-anchored today-matching with sequence semantics (earliest incomplete workout), add explicit complete/skip/reopen, backfill logging, and a workout-grain history view.

**Architecture:** Service-layer rework of `getTodayWorkout` (Approach A from the spec — `day_workouts.status`/`completed_at` already exist and nothing writes them today). Three new day-workout status routes, one history endpoint, `in_progress` flip on first set log. Frontend reframes the today surfaces, wires DONE to completion, adds a backfill mode (`?for=YYYY-MM-DD`) and a history page.

**Tech Stack:** Fastify 5 + zod + node-pg (api), Vite + React 18 (frontend), vitest (both), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-08-sequence-workouts-design.md`

**Repo invariants that bind every task:**
- `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/<file> --no-file-parallelism` — never bare `vitest` from repo root (phantom failures).
- Local test DB `repos_test`; if unrelated `programs.test` failures appear, reset the DB (known cruft issue), don't edit code.
- Conventional commits, one logical change each.
- Additive migrations only (CI migration-gate rejects destructive SQL, including in comments).
- `api` lint+prettier run in CI's typecheck job: run `npm run lint && npx prettier --check src tests` in `api/` before committing api tasks; same in `frontend/`.

**Documented deviation from spec:** set-log `performed_at` already exists (`api/src/schemas/setLogs.ts:34`, bounded to last 365 days / +5 min). We do NOT add a not-before-run-start check on set logs (extra hot-path JOIN for typo protection the 365-day bound mostly covers). `completed_on` on the complete route DOES get the full validation (future + pre-run-start rejected).

---

## Task 1: Sequence selection in `getTodayWorkout`

**Files:**
- Modify: `api/src/services/getTodayWorkout.ts`
- Test: `api/tests/getTodayWorkout.test.ts` (exists — extend; read it first to reuse its fixture helpers)

Behavior to implement (spec §1):
- Active run selection unchanged.
- Day selection becomes: `SELECT ... FROM day_workouts WHERE mesocycle_run_id=$1 AND status IN ('planned','in_progress') ORDER BY week_idx, day_idx LIMIT 1`.
- Delete the `todayLocal < run.start_date || todayLocal > lastDate` gate entirely (early training allowed; run ends by completion).
- `rest` is removed from the union, replaced by `{ state: 'mesocycle_complete', run_id }`, returned in TWO cases: (a) an active run with no `planned`/`in_progress` rows left (transient — Task 2's lifecycle flip normally closes the run at the same moment), and (b) no active run but the user's most recent run has `status='completed'` (so the finished-program framing survives the flip). Truly nothing → `no_active_run` as today.
- Workout state gains:
  - `pacing: { status: 'ahead' | 'on_pace' | 'behind', days_behind?: number, suggested_date: string }` — compare the selected day's `scheduled_date` to `computeUserLocalDate(run.start_tz, now)`. `days_behind` (only when behind) = whole-day difference computed via `Date.UTC` parsing of the two ISO dates. `suggested_date` = the day's `scheduled_date`.
  - `completed_today: boolean` — true when the run has any `completed` day workout whose `completed_at`, converted with `computeUserLocalDate(run.start_tz, completed_at)`, equals today. Fetch `MAX(completed_at)` in one query; compute in JS.

- [ ] **Step 1:** Read `api/tests/getTodayWorkout.test.ts` and `api/src/services/getTodayWorkout.ts` in full. Write failing tests (reusing the file's existing run/day/sets fixture helpers):
  - `offers the earliest incomplete workout when its scheduled_date is in the past` (create run starting 3 days ago, day at day_idx 0 scheduled 3 days ago, day at day_idx 1 scheduled today; expect day_idx 0 returned with `pacing.status='behind'`, `days_behind=3`)
  - `completing a workout advances the sequence the same day` (mark day 0 `completed`, expect day 1 returned, `completed_today=true` when completed_at is now)
  - `skipped workouts are passed over`
  - `returns mesocycle_complete when all day workouts are terminal`
  - `offers week 1 day 0 before start_date with pacing ahead`
  - `pacing is on_pace when scheduled_date equals user-local today`
- [ ] **Step 2:** Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/getTodayWorkout.test.ts --no-file-parallelism` — new cases FAIL (rest state returned / pacing undefined).
- [ ] **Step 3:** Implement in `getTodayWorkout.ts`: update the `TodayWorkout` union (`rest` → `mesocycle_complete`; add `pacing` + `completed_today` to workout state), swap the day query, delete the window gate, add the pacing/completed-today computation. Keep the existing sets/cardio/substitution logic untouched.
- [ ] **Step 4:** Re-run the file — all PASS. Then full api suite: `npm test` (expect existing `rest`-asserting tests to fail — fix them in this task; grep `state: 'rest'` and `'rest'` under `api/tests/`).
- [ ] **Step 5:** Update `api/src/schemas/mesocycles.ts` if it declares the today response shape (grep `rest`). Run `npm run lint && npx prettier --check src tests`.
- [ ] **Step 6:** Commit: `feat(api): sequence-based today selection — pacing, completed_today, mesocycle_complete`

## Task 2: Day-workout status routes (complete / skip / reopen)

**Files:**
- Create: `api/src/routes/dayWorkouts.ts`, `api/src/schemas/dayWorkouts.ts`
- Modify: `api/src/app.ts` (ALL route registration lives here, lines ~59-83 — register beside `setLogsRoutes`; `index.ts` has none)
- Test: `api/tests/dayWorkouts.test.ts`

Contract (spec §2):
- `POST /api/day-workouts/:id/complete` body `{ completed_on?: 'YYYY-MM-DD' }`. Sets `status='completed'`, `completed_at = completed_on ? (completed_on 12:00 in run.start_tz) : now()`. Idempotent: already-completed returns 200 with existing row, does NOT move `completed_at`.
- `POST /api/day-workouts/:id/skip` — only from `planned`/`in_progress`; from `completed` → 409 `{ error: 'already completed — reopen first', field: 'status' }`. Idempotent on already-skipped (200).
- `POST /api/day-workouts/:id/reopen` — from `completed` or `skipped` → `planned`, `completed_at=NULL`. Idempotent on already-planned (200).
- All: `requireBearerOrCfAccess`; ownership via `JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id AND mr.user_id = $userId`; unknown/foreign id → 404 (single shape, no existence oracle — copy the IDOR comment pattern from `setLogs.ts`).
- `completed_on` validation: zod `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` then route-level: reject > user-local today (`computeUserLocalDate(run.start_tz)`) → 400 `{ error: 'completed_on cannot be in the future', field: 'completed_on' }`; reject < run `start_date` → 400 `{ error: 'completed_on is before the program started', field: 'completed_on' }`.
- Timestamp SQL for the noon-local rule: `completed_at = ($2 || ' 12:00:00')::timestamp AT TIME ZONE $3` (`$3` = run.start_tz; direction verified — `timestamp AT TIME ZONE tz` yields timestamptz).
- **Run lifecycle (spec §1 "run ends when every workout is terminal"):** after complete/skip commits, count the run's remaining `planned`/`in_progress` rows; at zero, set `mesocycle_runs.status='completed', finished_at=now()` (enum value exists — no migration) and the owning `user_programs.status='completed'`. This unblocks starting the next mesocycle (partial unique index `idx_meso_one_active_per_user` only constrains `active`) and feeds recap-stats' `finished_at` PR cutoff.
- **Reopen on a completed (non-active) run:** if no other active run exists, re-activate it (`status='active'`, `finished_at=NULL`, user_program back to `'active'`); if another active run exists → 409 `{ error: 'another program is active — abandon it first', field: 'run' }`. Wrap the reopen + reactivation in a transaction; a concurrent 23505 from the partial index maps to the same 409.
- Response for all three: the updated row `{ id, status, completed_at }` plus `run_completed: boolean` (true when this mutation closed the run — the frontend uses it to celebrate/navigate).

- [ ] **Step 1:** Read `api/tests/setLogs.test.ts` for the fixture/auth test pattern (how it builds a user + run + day + CF-Access-or-bearer harness). Write failing tests: complete happy path; complete with `completed_on` yesterday (assert stored `completed_at` date matches); idempotent complete keeps original stamp; future `completed_on` 400; pre-run-start `completed_on` 400; skip; skip-after-complete 409; reopen from completed clears `completed_at`; reopen from skipped; foreign-user id 404; unknown id 404; **lifecycle: completing the last workout flips the run + user_program to completed with finished_at set (`run_completed: true`); reopening a workout of that completed run re-activates it; reopen 409s when a different active run exists**.
- [ ] **Step 2:** Run the test file — FAIL (404 route not found).
- [ ] **Step 3:** Implement schema + routes + registration.
- [ ] **Step 4:** Test file green, then full `npm test`, lint/prettier.
- [ ] **Step 5:** Commit: `feat(api): day-workout complete/skip/reopen routes`

## Task 3: `in_progress` flip on first set log

**Files:**
- Modify: `api/src/routes/setLogs.ts` (POST handler, after successful insert)
- Test: `api/tests/setLogs.test.ts` (extend)

After a set log insert succeeds (not on the conflict/dedupe path), run:
```sql
UPDATE day_workouts dw SET status='in_progress'
FROM planned_sets ps
WHERE ps.id = $plannedSetId AND dw.id = ps.day_workout_id AND dw.status = 'planned'
```
(Read `planned_sets` migration for the actual FK column name to `day_workouts` before writing — grep `day_workout` in `api/src/db/migrations/0*.sql`.)

- [ ] **Step 1:** Failing tests: `first set log flips its day workout planned → in_progress`; `set log against a completed day workout leaves status untouched` (backfill case).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Green + full suite + lint. **Step 5:** Commit: `feat(api): first set log marks day workout in_progress`

## Task 4: Workout history endpoint

**Files:**
- Create: `api/src/routes/workoutHistory.ts` + register in `api/src/app.ts`. Do NOT touch `api/src/routes/workouts.ts` — that is Apple Health workout ingestion registered under the `/api/health` prefix; adding the GET there would yield `/api/health/workouts/history`.
- Test: `api/tests/workoutHistory.test.ts`

Contract (spec §4): `GET /api/workouts/history?limit=20&cursor=...`.
- Rows: the requesting user's `day_workouts` with `status IN ('completed','skipped')` across ALL their runs.
- **NULL-safe keyset** (skipped rows have NULL `completed_at`; a raw row-comparison cursor breaks on them): order and paginate on `sort_ts = COALESCE(completed_at, '-infinity'::timestamptz)` — `ORDER BY sort_ts DESC, dw.id DESC`, page with `WHERE (COALESCE(completed_at,'-infinity'::timestamptz), dw.id) < ($cursorTs, $cursorId)`. Cursor encodes `<sort_ts ISO or '-infinity'>|<id>`.
- `limit` clamped 1..50, default 20.
- Item shape:
```json
{ "id": "...", "name": "Lower A", "kind": "strength", "week_idx": 1, "day_idx": 0,
  "status": "completed", "completed_at": "...", "scheduled_date": "2026-07-06",
  "exercises": [ { "slug": "leg-curl-machine", "name": "Leg Curl (Machine)",
    "sets": [ { "weight_lbs": 90, "reps": 10, "rir": 2, "performed_at": "..." } ] } ] }
```
- Sets come from `set_logs` joined via `planned_sets` on the day workout, grouped by exercise in `block_idx, set_idx` order. Skipped workouts return `exercises: []` (or whatever was logged before the skip).
- Response: `{ items: [...], next_cursor: string | null }`.

- [ ] **Step 1:** Failing tests: returns completed workouts newest-first with grouped sets; includes skipped with empty exercises; excludes planned; another user's rows invisible; pagination returns `next_cursor` and the second page continues without overlap; limit clamped.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Green + full suite + lint. **Step 5:** Commit: `feat(api): workout-grain history endpoint`

## Task 5: Invariant tests

**Files:**
- Create: `api/tests/dayWorkoutInvariants.test.ts` (the existing "invariant" assertions live in `api/tests/seed/exerciseMediaManifest.test.ts` — a seed-content suite with no run/day fixtures; wrong home for route-driven status invariants)

- [ ] **Step 1:** Add: `every completed day_workout has completed_at` (assert the complete route can't produce a violation — insert via route from Task 2's fixtures, then `SELECT count(*) FROM day_workouts WHERE status='completed' AND completed_at IS NULL` = 0); `reopen clears completed_at` (no `planned` row carries a stamp).
- [ ] **Step 2:** Run invariant file + full suite. **Step 3:** Commit: `test(api): day-workout status invariants`

## Task 6: Frontend API layer

**Files:**
- Modify: `frontend/src/lib/api/mesocycles.ts` (types: remove `rest` state, add `mesocycle_complete`, add `pacing` + `completed_today` to workout state)
- Create: `frontend/src/lib/api/dayWorkouts.ts` (`completeDayWorkout(id, opts?: { completed_on?: string })`, `skipDayWorkout(id)`, `reopenDayWorkout(id)` — mirror the `apiFetch`/`jsonOrThrow` pattern in `mesocycles.ts`)
- Create: `frontend/src/lib/api/workoutHistory.ts` (`getWorkoutHistory(cursor?)` typed to Task 4's shape)
- Test: colocated `*.test.ts` mirroring `frontend/src/lib/api/mesocycles.test.ts`'s fetch-mock pattern (read it first)

- [ ] **Step 1:** Failing tests for the three new client functions (URL, method, body, error propagation). **Step 2:** Run `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/api --no-file-parallelism` — FAIL. **Step 3:** Implement. **Step 4:** Green; `npx tsc --noEmit` will now surface every consumer of the removed `rest` state — list them for Task 7, do not fix here beyond what compilation of the lib itself needs. **Step 5:** Commit: `feat(frontend): day-workout + history API clients, sequence today types`

## Task 7: Today surfaces reframe

**Files:**
- Modify: `frontend/src/components/programs/TodayCard.tsx`, `frontend/src/components/programs/TodayWorkoutMobile.tsx` (+ their `.test.tsx`)
- Every other `tsc` error from Task 6's type change gets fixed here.

Behavior (spec §1/§7):
- `mesocycle_complete` replaces the old rest rendering: "Program complete — review it in history." with a link to `/history`.
- Workout state renders a pacing chip: `AHEAD` / `ON PACE` (good-green `#6BE28B`), `N DAYS BEHIND` (warn-amber `#F5B544`, never red). Chip carries a tooltip: "Pacing compares your progress to the original plan dates. It never blocks training." (tooltip pattern: grep an existing `RIRⓘ`-style term tooltip and reuse it).
- `completed_today: true` → headline "Done for today." + secondary "Next up: <name> (suggested <date>)" + button **START ANYWAY** (same navigate as START).
- **SKIP** action beside START (confirm dialog: "Skip <name>? It won't count toward your program. You can reopen it later from history.") → `skipDayWorkout(day.id)` → refetch today.
- When `pacing.status === 'behind'`: secondary action **LOG PAST WORKOUT** → date picker (native `<input type="date">`, max = today, min = run start if available) → navigate to `/today/<run_id>/log?for=<date>`.

- **Defensive pacing render:** the chip renders only when `pacing` is present (`data.pacing?.status`). Two hermetic mocks return the old shape and are NOT type-checked JSON: `frontend/src/components/programs/__offline__/_helpers.ts:270-283` and `frontend/playwright/w3-injury-swap-flow.spec.ts:128` — update both to include `pacing` + `completed_today` in this task (the w3 spec is a required CI job; an unguarded `pacing.status` takes it down with a TypeError).

- [ ] **Step 1:** Extend the two component test files (read them first; follow existing render/mocking style): pacing chip renders each status; chip absent when `pacing` missing; completed_today shows START ANYWAY; skip calls the client and refetches; mesocycle_complete links to history; behind state shows LOG PAST WORKOUT.
- [ ] **Step 2:** Run component tests — FAIL. **Step 3:** Implement. **Step 4:** Green + `npx tsc --noEmit` clean + `npm run validate` (catches term-coverage + page-reachability gates). **Step 5:** Commit: `feat(frontend): sequence today — pacing chip, skip, start-anyway, log-past entry`

## Task 8: Logger completion + backfill mode

**Files:**
- Modify: `frontend/src/components/programs/TodayLoggerMobile.tsx` (+ test), `frontend/src/components/programs/logger/` children as needed

Behavior (spec §2/§3):
- Read `?for=YYYY-MM-DD` from the URL (`useSearchParams`). When present: persistent banner at the top of the logger: "Logging for <weekday, Mon DD>" (JetBrains Mono date, amber accent); every set-log POST adds `performed_at` = that date at 12:00 user-local (construct with the user's tz from `useCurrentUser`, fall back to browser tz).
- **Completion lives at the WORKOUT level, not the exercise level.** `ExerciseFocus`'s "DONE → BACK TO PLAN" (`logger/ExerciseFocus.tsx:211-231`) stays exactly what it is — `onDone={backToHub}`, per-exercise navigation back to the checklist. Do NOT attach completion there (it would terminally complete the day after the first exercise). Instead, in `logger/WorkoutHub.tsx` replace the passive "Workout complete" banner (`WorkoutHub.tsx:125-144`) with an active **FINISH WORKOUT** CTA that is always available (spec §2 allows partial completion — confirm dialog when unlogged sets remain: "N sets unlogged. Finish anyway?"), calls `completeDayWorkout(day.id, { completed_on: forDate ?? undefined })`, and on success navigates back to the today screen (celebrate when the response has `run_completed: true`).
- On completion failure, show the existing error-banner pattern with the server's message (never generic); do not navigate.
- Fix `TodayLoggerMobile.tsx:68`: the ternary's else-branch currently renders `'Rest day.'` — with `rest` gone this silently shows for `mesocycle_complete` (compiles clean; tsc won't catch it). Change to "Program complete." + back link.

- [ ] **Step 1:** Extend logger tests (use the `preloaded` test hatch): FINISH WORKOUT in the hub calls complete (no date normally); confirm dialog when sets are unlogged; with `?for=` the banner renders, set-log payloads carry `performed_at`, FINISH passes `completed_on`; complete failure surfaces error and does not navigate; `mesocycle_complete` load state shows "Program complete."
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Green + tsc + lint. **Step 5:** Commit: `feat(frontend): logger completes day workout; backfill mode stamps chosen date`

## Task 9: History page

**Files:**
- Create: `frontend/src/components/history/WorkoutHistoryPage.tsx` (+ test)
- Modify: `frontend/src/App.tsx` (route `path="history"`), `frontend/src/components/layout/Sidebar.tsx:31-40` (nav entries live here as `{ name, icon, to }` — add "History"; `layout/AppShell.tsx` is the shell, not the nav), `frontend/src/pages/MyProgramPage.tsx` (link "Past workouts →")

Behavior (spec §4/§7):
- Fetch via `getWorkoutHistory`; skeleton loaders while loading; "No workouts yet — your finished sessions land here." empty state.
- Item card: name, kind badge, completed date (Mono), `SKIPPED` badge (amber) for skipped, expandable set detail (exercise name + `weight×reps @RIR` lines, Mono). REOPEN action on each terminal workout → `reopenDayWorkout` → refetch (this is the backfill entry for a wrongly-skipped day: reopen, then it's next in sequence).
- "Load more" button when `next_cursor` (no infinite scroll).
- Mobile: single column list. Desktop (`useIsMobile() === false`): group items under week headings (`WEEK <week_idx>` — week_idx is 1-indexed in this codebase; day_idx is 0-indexed), two-column grid. Same data, same actions.

- [ ] **Step 1:** Failing tests: renders items with sets; skipped badge; reopen calls client + refetches; load-more appends; empty state. Reachability: add the route + nav THEN run `node scripts/check-page-reachability.mjs` (it gates `npm run validate`).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Green + `npm run validate`. **Step 5:** Commit: `feat(frontend): workout history page with reopen + load more`

## Task 10: E2E specs + final verify

**Files:**
- Create: `frontend/playwright/w-seq-history-reachability.spec.ts`, `frontend/playwright/w-seq-backfill-flow.spec.ts`

Both hermetic (all `/api` mocked) following `w8-prior-recap-reachability.spec.ts` conventions exactly — including `onboarding_completed_at` in the `/api/me` mock and the mobile viewport for logger specs (known gotchas).
- Reachability spec: from `/`, reach the history page in ≤3 clicks on desktop AND mobile viewports; assert a completed workout card and its sets render.
- Backfill spec (mobile viewport): today mock returns `pacing.status='behind'`; click LOG PAST WORKOUT, pick a date, land on logger with `?for=`, assert banner text; intercept the set-log POST and assert `performed_at` carries the chosen date; DONE → assert complete POST carries `completed_on`.

- [ ] **Step 1:** Write both specs. **Step 2:** `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx playwright test playwright/w-seq-*.spec.ts` — PASS (write component-first; these are acceptance, not TDD). **Step 3:** Full local gauntlet: api `npm test`, frontend `npm run validate`, `npx playwright test`. **Step 4:** Commit: `test(e2e): history reachability + backfill flow`

---

## Self-review notes (kept for executors)

- Spec §6 additive index: deferred — seed-scale EXPLAIN won't justify it; revisit post-launch (documented deviation, matches spec's "if EXPLAIN shows it matters").
- Spec §5 set-log `performed_at`: already implemented pre-wave; Task 8 only *uses* it.
- The `rest` state removal is a breaking API change deployed atomically with the frontend (monolithic container) — no compat shim needed, but Task 1 must not merge to main alone without Task 7 in the same PR.
- All tasks land on `feat/sequence-workouts`; single PR at the end (branch already carries the spec commit).
