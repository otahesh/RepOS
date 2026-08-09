# Sequence-Based Workouts, History & Backfill — Design

**Date:** 2026-07-08
**Status:** Approved (user, 2026-07-08)
**Problem:** The program anchors workouts to calendar dates (`day_workouts.scheduled_date`), and `/api/mesocycles/today` matches `scheduled_date = today` only. Miss Monday and Tuesday returns `state: 'rest'` — Monday's workout is unreachable and there is no way to log it. There is also no way to train an extra day, no workout-level history view, and no after-the-fact logging.

**Decisions made during brainstorming:**
- Sequence-based model (a weekday does not own a workout)
- Weeks advance by completion, not calendar (mesocycle stretches if life happens)
- This wave includes a workout history view and backfill logging; it excludes editing arbitrary old logs

## Surfaces (device split)

- **Mobile (execution):** next-up today screen, logger completion, skip, backfill banner mode, past-workouts list.
- **Desktop (data management):** same capabilities, richer presentation — history with week grouping and per-workout detail.
- No desktop-exclusive capability; presentation gated with `useIsMobile`.

## 1. Scheduling model

A mesocycle run is an ordered list of workouts walked by `(week_idx, day_idx)`.

- **Today selection:** the earliest `day_workouts` row for the active run with `status IN ('planned','in_progress')`. Never a date match.
- **`scheduled_date` demotes to a pacing hint** ("originally planned Mon Jul 6"). It keeps being materialized at run creation and is never rewritten.
- **`rest` is no longer an API state.** The today endpoint always returns the next incomplete workout (or `mesocycle_complete` when none remain). Presentation decides framing:
  - No workout completed today → "Up next: <name>" with START.
  - A workout was already completed today → "Done for today. Next up: <name> (suggested <date>)" with START ANYWAY. This is the extra-day path.
- **Run start:** the sequence is available from run creation — opening the app before `start_date` offers week 1's first workout (training early is allowed; pacing shows `ahead`).
- **Run end:** a run no longer expires at `start_date + weeks*7`. It ends when every workout is `completed`/`skipped` (surface `mesocycle_complete`), or when abandoned (existing flow). Week boundaries advance implicitly — the sequence walks into week N+1's rows when week N's are all terminal.
- **Pacing chip:** derived from the next workout's original `scheduled_date` vs the user-local today: `ahead` (scheduled_date > today), `on_pace` (equal), `behind` (older; include day count). Soft — never gates any action.

## 2. Completion, skip, reopen

Completion becomes a real event (today nothing writes `day_workouts.status`).

- `POST /api/day-workouts/:id/complete` `{ completed_on?: 'YYYY-MM-DD' }` → `status='completed'`, `completed_at` (from `completed_on` when supplied, else now). Idempotent — repeat calls return 200 with the existing stamp. Partial workouts complete fine; unlogged sets simply have no logs.
- `POST /api/day-workouts/:id/skip` → `status='skipped'`. Keeps a sick week from damming the sequence.
- `POST /api/day-workouts/:id/reopen` → back to `planned` (from either terminal state), clears `completed_at`. No traps.
- First set log for a day workout flips `planned → in_progress` (also powers stalled-workout detection later).
- All three routes: `requireBearerOrCfAccess`, ownership check via the run's `user_id`, 404 on foreign/unknown id.
- Logger's DONE button calls complete; Skip is available from the today screen and plan view.

## 3. Backfill logging

The user's founding case: trained Tuesday (Monday's workout), couldn't log, wants to record it Wednesday.

- `POST` set-log accepts optional `performed_at`. Validation: not in the future, not before the run's `start_date` (user-local dates). Absent → `now()` as today.
- `complete` accepts `completed_on` with the same validation.
- **Flow:** plan or history → tap an incomplete workout → "Log past workout" → date picker (defaults to yesterday) → logger opens in backfill mode with a persistent banner "Logging for Tue, Jul 7" → every set log and the final completion carry that date.
- Exercise history, trends, and volume rollups stay truthful because they already read `performed_at`.

## 4. History view

- `GET /api/workouts/history?limit=&cursor=` — workout-grain, newest first, cursor-paginated. Each item: day workout (id, name, kind, week_idx/day_idx, status, completed_at, scheduled_date) plus its logged sets (exercise, weight, reps, RIR) grouped by exercise. Includes `completed` and `skipped`; excludes `planned`.
- Auth: `requireBearerOrCfAccess`; scoped to the requesting user across all their runs (not just the active one).
- Mobile: "Past workouts" list reachable from the program screen. Desktop: same data, week-grouped denser layout.
- Backfill entry point lives here and on the plan view (any non-completed workout).

## 5. API contract changes

- `GET /api/mesocycles/today` — new selection semantics; response gains `pacing: { status: 'ahead'|'on_pace'|'behind', days_behind?: number, suggested_date: string }` and `completed_today: boolean`; the `rest` state is replaced by `mesocycle_complete`. Frontend updates in the same wave (single deploy unit — monolithic container).
- New: `POST /api/day-workouts/:id/{complete,skip,reopen}`, `GET /api/workouts/history`.
- Set-log POST: optional `performed_at` (ISO date or datetime; date-only resolves to noon user-local to dodge TZ midnight edges).

## 6. Data / migrations

- **Zero destructive migration.** `status`, `completed_at`, and the `(mesocycle_run_id, scheduled_date)` index already exist.
- Additive: index on `(mesocycle_run_id, status)` for the sequence query, if EXPLAIN shows it matters at seed scale.
- Prod data note: lifting-domain tables are still pre-launch (wipe-recreatable), so no backfill of historical statuses is required; existing rows default to `planned`.

## 7. UI notes

- Pacing chip colors follow status tokens: ahead/on-pace green `#6BE28B`, behind amber `#F5B544`; never red (pacing is soft).
- "Pacing" and "backfill" (and any new term-of-art) get tooltips.
- Loading skeletons on history; no raw JSON anywhere.
- Voice: verbs first — "START ANYWAY", "LOG PAST WORKOUT".

## 8. Testing & acceptance

- **API unit:** sequence selection (miss a day → workout still offered; complete → next offered same day; skip advances; reopen restores), run-end-by-completion, pacing math across TZs, idempotent complete, backfill date validation (future date 400, pre-run 400), ownership 404s, history pagination + grouping.
- **Invariant suite:** every `completed` day workout has `completed_at`; no `set_log.performed_at` earlier than its run's start.
- **E2E (Playwright):** history page reachable from home in ≤3 clicks (both viewports); backfill flow stamps the chosen date; extra-day START ANYWAY reaches the logger.
- **User-reachability is part of Done:** a logged-in user must navigate to history and backfill from the home page.

## Out of scope

- Ad-hoc sessions not on the plan (revisit if demanded; upgrade path is a sessions table decoupled from plan rows)
- Editing arbitrary historical logs
- Notifications/reminders, preferred-training-day settings
- Drag-to-reschedule calendar UI
