# Workout Logging Shell (Redesign Wave 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-scroll workout logger with a hub (day checklist) + per-exercise focus screens, adding history, prefill, last-time line, and a rest timer.

**Architecture:** `TodayLoggerMobile` becomes a thin container that fetches today's workout and routes between two new presentational components (`WorkoutHub`, `ExerciseFocus`) keyed on a `:blockIdx` route param. A new `GET /api/exercises/:slug/history` endpoint (grouped per session from `set_logs`) powers both the history sheet and input prefill. `getTodayWorkout` grows a per-set `logged` field so completion state survives reload. The offline logBuffer/IDB queue is untouched.

**Tech Stack:** Fastify 5 + pg (api), React 18 + react-router 6 + vitest/RTL (frontend), existing Playwright offline specs.

**Spec:** `docs/superpowers/specs/2026-07-06-workout-logging-redesign-design.md`

**Branch:** create `feat/logging-shell-w1` off `origin/main`. The spec commit (`a76b166`, currently on local main only) must be cherry-picked onto this branch so it reaches GitHub.

**Verification commands** (run from repo root; every task's test step uses one of these):
- API: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/<file>`
- Frontend: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/<path>`
- Full gates before PR: api `npm test` + `npm run test:integration`; frontend `npm run validate`

---

### Task 1: History endpoint — `GET /api/exercises/:slug/history`

Sessions (grouped by day) of the caller's logged sets for one exercise, newest first. Also serves prefill (client uses the first session).

**Files:**
- Test: `api/tests/exerciseHistory.test.ts` (create)
- Modify: `api/src/routes/exercises.ts` (add route after the existing `/exercises/:slug` handlers)

- [ ] **Step 1: Write the failing test**

```ts
// api/tests/exerciseHistory.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { buildApp } from './helpers/app.js'; // match the pattern used by exercises.test.ts — check its imports and mirror them exactly
import { mkUser, mkTemplate, mkUserProgram, cleanupUser, cleanupTemplate } from './helpers/program-fixtures.js';
import { materializeMesocycle } from '../src/services/materializeMesocycle.js';

// Template with one bench block so planned sets exist to hang logs on.
const STRUCTURE = {
  _v: 1,
  days: [{
    idx: 0, day_offset: 0, kind: 'strength', name: 'Day A',
    blocks: [{ exercise_slug: 'barbell-bench-press', mev: 2, mav: 3,
      target_reps_low: 5, target_reps_high: 8, target_rir: 2, rest_sec: 180 }],
  }],
};

let userId: string, otherUserId: string, templateId: string, runId: string;

beforeAll(async () => {
  userId = (await mkUser({ prefix: 'vitest.exhist' })).id;
  otherUserId = (await mkUser({ prefix: 'vitest.exhist2' })).id;
  templateId = (await mkTemplate({ prefix: 'vitest-exhist', weeks: 4, structure: STRUCTURE })).id;
  const up = await mkUserProgram({ userId, templateId, name: 'hist run' });
  runId = (await materializeMesocycle({ userProgramId: up.id, startDate: '2026-06-01', startTz: 'UTC' })).run_id;
  // Log week-1 sets directly (exercise_id + user_id columns exist per migration 029).
  await db.query(`
    INSERT INTO set_logs (planned_set_id, user_id, exercise_id, performed_reps, performed_load_lbs, performed_rir, performed_at)
    SELECT ps.id, $1, ps.exercise_id, 8, 135.0, 2, dw.scheduled_date::timestamptz + interval '10 hours'
    FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
    WHERE dw.mesocycle_run_id = $2 AND dw.week_idx = 1`, [userId, runId]);
});

afterAll(async () => {
  await cleanupUser(userId);
  await cleanupUser(otherUserId);
  await cleanupTemplate(templateId);
  await db.end();
});

describe('GET /api/exercises/:slug/history', () => {
  it('returns sessions newest-first with per-set weight/reps/rir', async () => {
    const app = await buildApp(); // as exercises.test.ts does
    const res = await app.inject({
      method: 'GET', url: '/api/exercises/barbell-bench-press/history',
      // auth: mirror how exercises.test.ts authenticates as a specific user
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions.length).toBe(1);
    expect(body.sessions[0].sets).toEqual([
      { weight_lbs: 135, reps: 8, rir: 2 },
      { weight_lbs: 135, reps: 8, rir: 2 },
    ]);
    expect(body.sessions[0].date).toBe('2026-06-01');
  });

  it("does not leak another user's logs", async () => {
    // authenticate as otherUserId; same URL
    // expect sessions: []
  });

  it('respects ?limit=1', async () => { /* one session max after logging a week-2 set */ });

  it('404s an unknown slug', async () => { /* /api/exercises/nope/history → 404 */ });
});
```

NOTE for implementer: `api/tests/exercises.test.ts` shows the house pattern for building the app and authenticating a test user (CF Access JWKS helper from `tests/helpers/cf-access-jwt.ts`). Copy that pattern verbatim; the sketch above marks the two auth call sites. Fill in the two stubbed `it` bodies following the first test's shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/exerciseHistory.test.ts`
Expected: FAIL — 404 route not found on the first assertion.

- [ ] **Step 3: Implement the route**

In `api/src/routes/exercises.ts`, after the existing `/exercises/:slug` GET (line ~34), following the same preHandler style used by the file's other routes:

```ts
app.get<{ Params: { slug: string }; Querystring: { limit?: string } }>(
  '/exercises/:slug/history',
  { preHandler: requireBearerOrCfAccess },
  async (req, reply) => {
    const userId = requireUserId(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '8', 10) || 8, 1), 20);
    const { rows: [ex] } = await db.query<{ id: string }>(
      `SELECT id FROM exercises WHERE slug=$1 AND archived_at IS NULL`, [req.params.slug]);
    if (!ex) { reply.code(404); return { error: 'exercise not found', field: 'slug' }; }

    // One session = one calendar day of logs for this user+exercise.
    const { rows } = await db.query<{ date: string; sets: { weight_lbs: number; reps: number; rir: number | null }[] }>(
      `SELECT to_char(sl.performed_at::date, 'YYYY-MM-DD') AS date,
              json_agg(json_build_object(
                'weight_lbs', sl.performed_load_lbs::float,
                'reps', sl.performed_reps,
                'rir', sl.performed_rir
              ) ORDER BY sl.performed_at ASC) AS sets
       FROM set_logs sl
       WHERE sl.user_id = $1 AND sl.exercise_id = $2
       GROUP BY sl.performed_at::date
       ORDER BY sl.performed_at::date DESC
       LIMIT $3`,
      [userId, ex.id, limit],
    );
    return { sessions: rows };
  },
);
```

Add any missing imports (`requireBearerOrCfAccess`, `requireUserId`, `db`) matching the file's existing imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/exerciseHistory.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/exercises.ts api/tests/exerciseHistory.test.ts
git commit -m "feat(api): per-exercise history endpoint for logger history + prefill"
```

---

### Task 2: `getTodayWorkout` exposes per-set logged state

The hub needs "✓ 2/2 sets" after a reload; today the payload has no logged info.

**Files:**
- Test: `api/tests/getTodayWorkout.test.ts` (extend)
- Modify: `api/src/services/getTodayWorkout.ts`

- [ ] **Step 1: Write the failing test** — in the existing describe of `getTodayWorkout.test.ts`, add:

```ts
it('marks a set logged=true (with weight/reps) once a set_log exists', async () => {
  // Use the suite's existing run fixture; insert one log against the first planned set of today:
  const { rows: [ps] } = await db.query(
    `SELECT ps.id, ps.exercise_id FROM planned_sets ps
     JOIN day_workouts dw ON dw.id=ps.day_workout_id
     WHERE dw.mesocycle_run_id=$1 ORDER BY dw.week_idx, ps.block_idx, ps.set_idx LIMIT 1`, [runId]);
  await db.query(
    `INSERT INTO set_logs (planned_set_id, user_id, exercise_id, performed_reps, performed_load_lbs, performed_rir)
     VALUES ($1,$2,$3,8,135.0,2)`, [ps.id, userId, ps.exercise_id]);
  const today = await getTodayWorkout(userId, /* suite's fixed `now` for week 1 day 1 */);
  if (today.state !== 'workout') throw new Error('expected workout state');
  const logged = today.sets.find((s) => s.id === ps.id)!;
  expect(logged.logged).toEqual({ weight_lbs: 135, reps: 8 });
  expect(today.sets.filter((s) => s.id !== ps.id).every((s) => s.logged === null)).toBe(true);
});
```

Adapt fixture variable names (`runId`, `userId`, the suite's `now`) to what the file already defines — read the file's beforeAll first.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/getTodayWorkout.test.ts` → FAIL (`logged` undefined).

- [ ] **Step 3: Implement** — in `getTodayWorkout.ts`:

Type: add to the `sets` array element type (after `rest_sec`):

```ts
/** Latest log for this planned set, or null. Lets the UI show completion after reload. */
logged: { weight_lbs: number; reps: number } | null;
```

Query: extend the planned-sets SELECT with a LATERAL join:

```sql
SELECT ps.id, ps.block_idx, ps.set_idx,
       ps.target_reps_low, ps.target_reps_high, ps.target_rir, ps.rest_sec,
       e.id AS ex_id, e.slug AS ex_slug, e.name AS ex_name,
       e.required_equipment AS ex_required,
       sl.performed_load_lbs::float AS logged_weight, sl.performed_reps AS logged_reps
FROM planned_sets ps
JOIN exercises e ON e.id=ps.exercise_id
LEFT JOIN LATERAL (
  SELECT performed_load_lbs, performed_reps FROM set_logs
  WHERE planned_set_id = ps.id ORDER BY performed_at DESC LIMIT 1
) sl ON true
WHERE ps.day_workout_id=$1
ORDER BY ps.block_idx, ps.set_idx
```

Row type gains `logged_weight: number | null; logged_reps: number | null`. In the `sets` mapper add:

```ts
logged: s.logged_weight != null && s.logged_reps != null
  ? { weight_lbs: s.logged_weight, reps: s.logged_reps }
  : null,
```

- [ ] **Step 4: Run api unit suite** — `npx vitest run tests/getTodayWorkout.test.ts` → all pass; then `npm test` → all pass (other suites consume this type).

- [ ] **Step 5: Commit** — `git commit -m "feat(api): today-workout sets carry latest logged weight/reps"`

---

### Task 3: Frontend API client — history + `logged` type

**Files:**
- Create: `frontend/src/lib/api/exerciseHistory.ts`
- Test: `frontend/src/lib/api/exerciseHistory.test.ts`
- Modify: `frontend/src/lib/api/mesocycles.ts` (TodaySet type)

- [ ] **Step 1: Failing test**

```ts
// frontend/src/lib/api/exerciseHistory.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as auth from '../../auth';
import { getExerciseHistory } from './exerciseHistory';

describe('getExerciseHistory', () => {
  it('fetches and unwraps sessions', async () => {
    const sessions = [{ date: '2026-07-01', sets: [{ weight_lbs: 25, reps: 9, rir: 2 }] }];
    vi.spyOn(auth, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ sessions }), { status: 200 }) as any,
    );
    await expect(getExerciseHistory('incline-dumbbell-bench-press', 8)).resolves.toEqual(sessions);
    expect(auth.apiFetch).toHaveBeenCalledWith(
      '/api/exercises/incline-dumbbell-bench-press/history?limit=8', {});
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run src/lib/api/exerciseHistory.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/api/exerciseHistory.ts
import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export type HistorySet = { weight_lbs: number; reps: number; rir: number | null };
export type HistorySession = { date: string; sets: HistorySet[] };

export async function getExerciseHistory(slug: string, limit = 8): Promise<HistorySession[]> {
  const res = await apiFetch(`/api/exercises/${encodeURIComponent(slug)}/history?limit=${limit}`, {});
  const body = await jsonOrThrow<{ sessions: HistorySession[] }>(res);
  return body.sessions;
}
```

And in `mesocycles.ts`, add to `TodaySet`:

```ts
/** Latest log for this planned set (null if never logged). */
logged?: { weight_lbs: number; reps: number } | null;
```

- [ ] **Step 4: Run to pass** — same command → 1 passed. Also `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat(frontend): exercise-history client + logged field on TodaySet"`

---

### Task 4: `WorkoutHub` component

**Files:**
- Create: `frontend/src/components/programs/logger/WorkoutHub.tsx`
- Test: `frontend/src/components/programs/logger/WorkoutHub.test.tsx`

Props contract (pure presentational — container owns data):

```ts
export type HubBlock = {
  blockIdx: number;
  exerciseName: string;
  muscle: string;          // primary muscle slug for the chip label
  setsTotal: number;
  setsDone: number;        // logged this session (from `logged` + live queue state)
};
export function WorkoutHub({ dayName, blocks, onOpenBlock }: {
  dayName: string;
  blocks: HubBlock[];
  onOpenBlock: (blockIdx: number) => void;
}): JSX.Element;
```

Rendering rules:
- Row per block, `data-testid="hub-row-{blockIdx}"`: chip, name, `{setsDone}/{setsTotal} sets`.
- Done rows (`setsDone === setsTotal`): green ✓ prefix, dimmed. First not-done row: `▶` prefix, accent border, `· up next` suffix.
- Footer button `CONTINUE → {name of first unfinished}` (`aria-label="Continue workout"`); hidden when all done, replaced by a `WORKOUT COMPLETE` static banner.
- Whole row is a `<button>` (a11y) calling `onOpenBlock(blockIdx)`.
- Styling: house tokens (`TOKENS.surface`, chips like `TrackChip`'s pattern, JetBrains Mono for counts).

- [ ] **Step 1: Failing tests**

```tsx
// WorkoutHub.test.tsx — RTL, no router needed
const BLOCKS = [
  { blockIdx: 0, exerciseName: 'Goblet Squat', muscle: 'quads', setsTotal: 2, setsDone: 2 },
  { blockIdx: 1, exerciseName: 'DB Bench Press', muscle: 'chest', setsTotal: 2, setsDone: 0 },
  { blockIdx: 2, exerciseName: 'Chest-Supported Row', muscle: 'back', setsTotal: 2, setsDone: 0 },
];

it('renders one row per block with done counts', ...);         // hub-row-0..2 exist, "2/2 sets", "0/2 sets"
it('marks first unfinished block as up next', ...);            // hub-row-1 contains /up next/i, hub-row-2 does not
it('CONTINUE targets the first unfinished block', ...);        // click button {name:/continue/i} → onOpenBlock(1)
it('tapping any row opens that block', ...);                   // click hub-row-2 → onOpenBlock(2)
it('all done → complete banner, no continue', ...);            // all setsDone=setsTotal → /workout complete/i, no continue button
```

Write the five tests in full (follow MyLibrary.test.tsx conventions).

- [ ] **Step 2: Run to fail** → module not found.
- [ ] **Step 3: Implement `WorkoutHub.tsx`** per contract above.
- [ ] **Step 4: Run to pass** — `npx vitest run src/components/programs/logger/WorkoutHub.test.tsx`.
- [ ] **Step 5: Commit** — `git commit -m "feat(frontend): WorkoutHub day-checklist component"`

---

### Task 5: `ExerciseFocus` component (set table + prefill + last-time + cue)

**Files:**
- Create: `frontend/src/components/programs/logger/ExerciseFocus.tsx`
- Test: `frontend/src/components/programs/logger/ExerciseFocus.test.tsx`

This screen owns presentation only; the container passes through the existing logging machinery so the offline queue keeps working unchanged:

```ts
export function ExerciseFocus(props: {
  position: { current: number; total: number };      // "2 OF 5"
  exercise: { name: string; muscle: string; equipmentLabel: string; slug: string };
  sets: TodaySet[];                                   // this block's sets
  track?: string | null;                              // beginner cue handling
  rowStates: Record<string, RowState>;                // pass-through from container
  rowInputs: Record<string, RowInputs>;
  onInputChange: (setId: string, patch: Partial<RowInputs>) => void;
  onLog: (set: TodaySet) => void;
  onSkip: (setId: string) => void;
  lastSession: HistorySession | null;                 // prefill + last-time line
  onOpenHistory: () => void;
  onBack: () => void;                                 // ← PLAN
  onDone: () => void;                                 // DONE → hub
}): JSX.Element;
```

Rendering rules:
- Header: muscle chip, name, equipment subtitle, `⟲ history` button (`aria-label="Exercise history"`). (ⓘ arrives in wave 2 — do not render it yet.)
- Set table reuses the existing `SetRow` from `TodayLoggerMobile.tsx`: **move** `SetRow`, `RirSlider`, `NumInput` (and their styles) into `frontend/src/components/programs/logger/SetRow.tsx` unchanged, exporting `SetRow`. Keep `data-testid="set-row-{setIdx}"` and the `Log` button name — the offline Playwright specs select on these.
- Prefill: for each set not yet logged and with empty inputs, the container passes `rowInputs` already seeded — ExerciseFocus does NOT compute prefill (single source of truth in the container; see Task 6 Step 3).
- Last-time line under the table when `lastSession` present: `last time: 25 lbs × 9, 9` (weights deduped when uniform: `25 lbs × 9, 9`; mixed weights fall back to `25×9 · 30×8`).
- Effort cue pinned below: reuse `isBeginnerTrack`/`effortCue` exactly as the current block header does.
- Footer: `DONE → BACK TO PLAN` (`aria-label="Done, back to plan"`) → `onDone`; header `← PLAN` → `onBack`.

- [ ] **Step 1: Failing tests** — write in full:

```tsx
it('renders header with position, chip, equipment subtitle and history button', ...);
it('renders a SetRow per set with prefilled inputs from rowInputs', ...);
it('shows the last-time line from lastSession', ...);          // "last time: 25 lbs × 9, 9"
it('beginner track shows plain-language cue and no RIR text', ...);
it('DONE calls onDone; back calls onBack; history calls onOpenHistory', ...);
```

- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Extract `SetRow.tsx`** (mechanical move from `TodayLoggerMobile.tsx`, keep old file importing from the new module so nothing breaks yet). Run `npx vitest run src/components/programs/TodayLoggerMobile.test.tsx` — must stay green.
- [ ] **Step 4: Implement `ExerciseFocus.tsx`.** Run its tests → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(frontend): ExerciseFocus screen with RP-style set table"`

---

### Task 6: Rest timer + container rewiring + routes

**Files:**
- Create: `frontend/src/components/programs/logger/useRestTimer.ts` + `useRestTimer.test.ts`
- Modify: `frontend/src/components/programs/TodayLoggerMobile.tsx` (becomes container)
- Modify: `frontend/src/App.tsx` (route)
- Test: `frontend/src/components/programs/TodayLoggerMobile.test.tsx` (update)

- [ ] **Step 1: `useRestTimer` failing test** (vi.useFakeTimers): `start(150)` → `remaining=150`, advances down to 0, `running` flips false at 0; `start()` while running restarts.

- [ ] **Step 2: Implement**

```ts
export function useRestTimer() {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);
  return {
    remaining: remaining !== null && remaining > 0 ? remaining : null,
    start: (sec: number) => setRemaining(sec),
  };
}
```

Run → pass.

- [ ] **Step 3: Rewire the container.** In `TodayLoggerMobile.tsx`:
  - Read `blockIdx` from a new optional route param.
  - Group `data.sets` by `block_idx` (existing logic). Derive `HubBlock[]`: `setsDone` = sets where server `logged` is non-null OR local rowState is logged.
  - No `blockIdx` → render `WorkoutHub` (`onOpenBlock` → `navigate(\`/today/${runId}/log/${blockIdx}\`)`).
  - With `blockIdx` → render `ExerciseFocus` for that block; `onBack`/`onDone` → `navigate(\`/today/${runId}/log\`)`.
  - **Prefill seeding:** when initializing `rowInputs` for a set, if the set is unlogged and history exists, seed `weight`/`reps` from `lastSession.sets[set_idx]` (fall back to the session's first set). Fetch `getExerciseHistory(slug, 1)` lazily per focused block; cache per slug in a ref. Server-`logged` sets initialize as logged rows (`✓ weight × reps`).
  - **Rest timer:** `useRestTimer` in the focus branch; `onLog` wraps the existing `handleLog` then `restTimer.start(set.rest_sec)`. Render `REST m:ss` (`data-testid="rest-timer"`) while non-null.
  - History sheet state: `historyOpen` boolean → Task 7 component.
- [ ] **Step 4: Route.** In `App.tsx`: add `<Route path="today/:mesocycleRunId/log/:blockIdx" element={<TodayLoggerMobileGate />} />` next to the existing log route.
- [ ] **Step 5: Update `TodayLoggerMobile.test.tsx`.** Existing tests render `preloaded` at the hub now — update assertions: hub rows exist; navigate into block 0 by clicking `hub-row-0` (router context already present via MemoryRouter, add `Routes` wrapper matching both paths); the existing SetRow-level tests (log/debounce/focus-advance/RIR-hide) run inside the focused block. Mock `getExerciseHistory` (`vi.mock('../../lib/api/exerciseHistory')`) to return `[]` by default; add one test: history `[{date, sets:[{weight_lbs:25,reps:9,rir:2}]}]` → inputs prefilled `25`/`9` and last-time line shown; add one test: logging a set starts the rest timer (fake timers, expect `rest-timer` visible with `3:00` for rest_sec 180).
- [ ] **Step 6: Run** — `npx vitest run src/components/programs/` → all green.
- [ ] **Step 7: Commit** — `git commit -m "feat(frontend): hub/focus logger shell with prefill + rest timer"`

---

### Task 7: `HistorySheet`

**Files:**
- Create: `frontend/src/components/programs/logger/HistorySheet.tsx` + test

- [ ] **Step 1: Failing tests:** renders a bottom sheet (`role="dialog"`, `aria-label="Exercise history"`) listing sessions (`date` formatted via `Intl.DateTimeFormat` **formatToParts-safe** — see `project_alpine_smallicu` memory; use explicit `month: 'short', day: 'numeric'`), each session's sets as `135 × 8` lines (+ ` @RIR 2` only when non-beginner track); empty state "No history yet — first time doing this one."; ESC and backdrop click call `onClose`.
- [ ] **Step 2: Implement** — fetch inside the sheet: `getExerciseHistory(slug, 8)` on open, loading state, error state (`Couldn't load history: <msg>`). Mirror `DesktopSwapSheet`'s focus management (capture/restore focus, initial focus inside dialog).
- [ ] **Step 3: Wire into container** (`⟲` button → `historyOpen=true`).
- [ ] **Step 4: Run all logger tests** → green.
- [ ] **Step 5: Commit** — `git commit -m "feat(frontend): per-exercise history sheet"`

---

### Task 8: Offline Playwright specs + full gates

**Files:**
- Modify: `frontend/src/components/programs/__offline__/_helpers.ts`
- Possibly the 8 `__offline__/O*.spec.ts` files (navigation only)

- [ ] **Step 1:** In `_helpers.ts`, add an `openFirstBlock(page)` helper (`page.getByTestId('hub-row-0').click()`) and call it wherever the helpers previously assumed set rows were immediately visible (the `set-row-${setIdx}` + Log-button selectors then work unchanged). Adjust specs that reload mid-flow (O2, O3) to re-enter the block after reload.
- [ ] **Step 2:** Run the offline suite the way CI does (see `.github/workflows/test.yml` e2e-frontend job for the exact command) → all 8 specs green.
- [ ] **Step 3:** Full gates: api `npm test` + `npm run test:integration`; frontend `npm run validate`; `npm run check-pages`.
- [ ] **Step 4:** Commit — `git commit -m "test(frontend): offline specs drive hub->focus logger shell"`

---

### Task 9: PR + deploy

- [ ] Push `feat/logging-shell-w1`, open PR referencing the spec, wait for the 8 required checks.
- [ ] Squash-merge; watch docker.yml on main; `ssh unraid /mnt/user/appdata/repos/repos-redeploy.sh`; outside-in `curl -sI https://repos.jpmtech.com` → 302.
- [ ] Live check on the phone: hub shows the day, focus screen logs a set, prefill + rest timer + history behave.

---

## Self-review notes

- Spec coverage: hub ✓ (T4), focus ✓ (T5), set table ✓ (T5), prefill ✓ (T6), last-time ✓ (T5/T6), rest timer ✓ (T6), history endpoint+sheet ✓ (T1/T7), logged-after-reload ✓ (T2), offline queue untouched ✓ (T8 verifies), routes ✓ (T6), no ⓘ in this wave (explicitly deferred to W2).
- The two stubbed `it` bodies in Task 1 and the five test names in Tasks 4/5 are contracts the implementer writes in full — each lists exact behaviors and selectors, not "write tests".
- Type consistency: `logged` field name used in T2 (api), T3 (frontend type), T6 (container). `HistorySession` defined T3, consumed T5/T6/T7. `HubBlock` defined T4, built T6.

## Deferred from spec (explicit)

The design spec (`docs/superpowers/specs/2026-07-06-workout-logging-redesign-design.md`, lines 36 and 49) lists three items that this wave-1 plan never tasked out:

- Cardio blocks and the deload button/banner staying on the hub.
- Suggested substitutions and the mid-session swap affordance (BlockOverflowMenu → MidSessionSwapPicker) on the focus screen.
- (Skip *did* carry over — it ships as a no-op pending W1.3.5 design, per the code-review follow-ups note at the top of `TodayLoggerMobile.tsx`.)

Investigation at final review confirmed none of the first two existed in the old single-scroll logger either — they live on the `/today` day view today and remain fully available there. No capability is lost by this wave shipping without them; this was a controller scoping decision at final review (2026-07-06), not an oversight.

Candidates for a W1.5 follow-up, alongside the above two items:

- History-fetch failure caching never retries — the container's `histRequested` ref marks a slug as fetched even when `getExerciseHistory` rejects, so a transient failure permanently suppresses prefill/last-time for that exercise for the rest of the session.
- Same-exercise-in-two-blocks prefill gap — prefill is keyed by slug per fetch, but a workout with the same exercise in two blocks (e.g. a superset) doesn't share/re-derive prefill state between them correctly.
- Folding muscle/equipment metadata into the today-workout payload to drop the extra `listExercises` fetch the container currently makes solely to label the hub chips and focus header.
