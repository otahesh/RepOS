# W3 — Clinical Signals + Injury Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the recovery-flag evaluators (overreaching + stalled-PR), the injury-aware substitution ranker, the "Got a tweak?" entry point on mobile, and the Settings injury chips UI — closing W3 of the RepOS Beta plan.

**Architecture:** Schema-first then parallel fan-out (Approach A locked in the spec). Phase 1 lands the two migrations + CRUD routes serially. Phase 2 fans out the four sub-waves (W3.1 evaluators, W3.2 ranker, W3.3 entry point, W3.4 Settings UI) in parallel worktrees. Phase 3 runs the reviewer matrix + wave-complete merge.

**Tech Stack:** Fastify 5 + zod + TypeScript + Postgres on the API side; Vite + React 18 + TypeScript + vitest + React Testing Library on the frontend; Playwright for e2e.

**Spec:** [docs/superpowers/specs/2026-05-22-W3-clinical-signals-design.md](../specs/2026-05-22-W3-clinical-signals-design.md) — Q1–Q7 locks are non-negotiable.

**Master plan:** [docs/superpowers/plans/2026-05-11-repos-beta.md §W3](2026-05-11-repos-beta.md)

---

## Reviewer findings applied (2026-05-24)

This plan was reviewed by four specialist agents (backend / frontend / clinical / security) before user approval. Every Critical + Important finding is fixed inline in the task blocks below. Each correction is tagged `[FIX-N]` in the task it lands in.

### Critical (11 — all fixed inline)

| # | Source | Finding | Fix location |
|---|--------|---------|--------------|
| FIX-1  | backend  | `set_updated_at()` does not exist project-wide; existing migrations 029/030 ship table-scoped functions (`set_logs_set_updated_at`, `health_workouts_set_updated_at`) | Task 1 — define `user_injuries_set_updated_at()` inline |
| FIX-2  | backend  | `requireScope` lives in `api/src/middleware/scope.ts` (singular), not `cfAccess.js` | Task 5 import path correction |
| FIX-3  | backend  | Scope tuple lives in `api/src/auth/scopes.ts` (`VALID_SCOPES`, `as const`) — strongly-typed `Scope` union | Task 4 — edit the correct file |
| FIX-4  | backend  | `set_logs` columns are `performed_load_lbs` + `performed_reps` (not `weight_lbs`/`reps`); set_logs has NO `mesocycle_run_id` / `day_workout_id` — must join through `planned_sets → day_workouts` | Task 10 SQL rewritten |
| FIX-5  | backend  | `computeVolumeRollup(runId: string): Promise<{ run_id, weeks: WeekVolume[] }>` — uses `performed_sets`, not `set_count`/`muscles` | Task 11 evaluator rewritten |
| FIX-6  | backend  | `RecoveryFlagEvaluator` interface uses `key` (not `flag`); ctx is `{ userId, runId, weekIdx }` (not `{ userId, now }`); result has no `flag` field | Tasks 10–12 evaluator + telemetry shape corrected |
| FIX-7  | backend  | `recovery_flag_events.week_start` must be `DATE` (not `TEXT`) — `recovery_flag_dismissals` from migration 024 uses DATE; join compatibility requires matching types | Task 2 migration corrected |
| FIX-8  | backend  | `isoWeekKey()` JS helper is unnecessary AND not ISO-8601-correct (broken across year boundaries) — Postgres `date_trunc('week', current_date)::date` is the existing project pattern | Task 12 — drop helper; use SQL week_start |
| FIX-9  | frontend | Existing `<MidSessionSwapSheet>` is a single-target **confirm** dialog (props: `plannedSetId, fromName, toId, toName, onClose`), NOT a candidates picker. Plan invented a `candidates[]` + `onSubstitute` API that doesn't exist | Task 18 — split into new `<MidSessionSwapPicker>` (lists + ranks) + existing `<MidSessionSwapSheet>` (confirm). Picker calls sheet on candidate-click. |
| FIX-10 | frontend | `Block` type fabricated — `TodayWorkoutMobile.tsx` groups via `Map<number, sets>` keyed by `block_idx`; existing component already has a `swapTarget` state for the inline "Suggested sub" flow | Task 17 — use `swapTargetBlockIdx: number \| null`; preserve existing swapTarget; new state is for the picker |
| FIX-11 | frontend | `SettingsNav.tsx` does not exist — Settings sub-nav lives in `frontend/src/components/layout/Sidebar.tsx:35-40` (`SETTINGS_SUB` const) | Task 22 — edit Sidebar.tsx instead |

### Important (19 — all fixed inline)

| # | Source | Finding | Fix location |
|---|--------|---------|--------------|
| FIX-12 | backend  | `findSubstitutions` has 3 callers: `routes/exercises.ts:70`, `services/getTodayWorkout.ts:101`, `api/tests/substitutions.test.ts:38-81` — making `userId` required breaks all three. Make it optional with a no-op default | Task 15 signature fix |
| FIX-13 | backend  | Substitutions SQL does not select `e.joint_stress_profile` — must extend the SELECT + row type | Task 15 |
| FIX-14 | backend  | `injuryRanker` same-root double-injury edge case: `knee_left + knee_right` both → `knee`. With equal severity, later joint silently wins. Add deterministic tiebreaker (alphabetical) | Task 14 |
| FIX-15 | backend  | `joint_stress_profile` value type too loose — narrow to `{ _v: number } & Partial<Record<string, 'low'\|'mod'\|'high'>>` | Task 14 |
| FIX-16 | backend  | Telemetry writes on every poll = table explosion. Need unique-per-(user, week_start, flag, event_type='shown') OR `ON CONFLICT DO NOTHING` dedupe | Task 12 — unique index + ON CONFLICT |
| FIX-17 | backend  | `seedStalledPr`/`seedUserOverreaching` fixtures referenced but not actually implemented in the plan — Step 1 won't compile | Task 10 / Task 11 — fixture code included as Step-1 deliverable |
| FIX-18 | frontend | `frontend/src/tokens.ts` is the canonical color/font source (`TOKENS.accent`, `TOKENS.bg`, etc.); existing components (`SettingsStorage.tsx:1-3`) import from it. Plan hardcoded hexes throughout | Tasks 16, 20, 21 — replace hex literals with `TOKENS.*` |
| FIX-19 | frontend | Task 21 spec required "rollback chip on PATCH error with toast" but plan's `updateSeverity`/`updateNotes`/`updateOnset` had no try/catch + no prior-value capture | Task 21 — capture prior, optimistic-update, rollback on error |
| FIX-20 | frontend | Project test pattern is `vi.mock('../../lib/api/X')`, not `vi.spyOn(globalThis, 'fetch')`. Acceptable for the api-client layer (Task 19) WITH justification; not at component layer | Task 19 — keep with one-line justification comment; Tasks 20+ already use `vi.mock` correctly |
| FIX-21 | frontend | BlockOverflowMenu missing focus management (focus into menu on open, return to trigger on close) + click-outside dismissal | Task 16 |
| FIX-22 | frontend | Expanded panel missing `role="region"` + `aria-labelledby` pointing to the chip | Task 21 |
| FIX-23 | frontend | Test selector `getByRole('button', { name: 'high' })` collides with chip buttons. Scope via `within(panel)` | Task 21 test |
| FIX-24 | clinical | Stalled-PR fires on planned deload weeks (stagnation is expected). Add deload-guard via `mesocycle_runs.is_deload` or microcycle kind | Task 10 |
| FIX-25 | clinical | Stalled-PR fires spuriously on strength blocks (heavy doubles legitimately stall numerically). Gate on `max_reps >= 5` | Task 10 |
| FIX-26 | clinical | "Severity stored but unused by ranker" = UX lie. Wire severity into penalty scaling: `low: 0.5x`, `mod: 1.0x`, `high: 1.5x` (multiplicative on existing stress-based penalty) | Task 14 |
| FIX-27 | clinical | Stalled-PR docblock + overreaching docblock should document the "first-cohort approximation" stance — 1-week-MAV trigger is closer to "high-effort week" than canonical overreaching. Tuning candidate informed by `recovery_flag_events` post-cohort. *Threshold itself preserved to keep the W1.5 e2e contract intact.* | Task 11 docblock + spec note |
| FIX-28 | security | **Existing `/api/recovery-flags` routes have NO scope check** — any bearer with any scope can read/dismiss. W3 makes this worse by adding telemetry writes (write-amplification vector via stale tokens). Add `requireScope('health:recovery:read')` to GET + dismiss as part of W3 | New Task 12.5 |
| FIX-29 | security | `(req as any).userId` should be typed `req.userId` with an explicit `if (!userId) return 500 auth_state_missing` guard (matches setLogs.ts:50-51) | Tasks 5, 6, 7, 8 |
| FIX-30 | security | `recovery_flag_events.flag` is unconstrained TEXT — add `CHECK (flag IN ('bodyweight_crash','overreaching','stalled_pr'))` to catch typos in `recordFlagEvent` | Task 2 migration |

### Nice-to-have (9 — defer to post-Beta tuning with explicit memory note)

`recovery_flag_events` tuning + `JOINT_LABELS` for snake_case UI labels + bilateral-mapping doc-comment + advisory copy consistency pass + acute-injury escalation banner + severity-button color reconsideration (CLAUDE.md good=verified rule) + reachability test file location + migration version key (_v) + test-bearer-token redaction. All flagged in [[reference_w3_tuning_candidates]] memory after merge.

---

## File map

**Created:**
- `api/src/db/migrations/032_user_injuries.sql` (with `user_injuries_set_updated_at()` — FIX-1)
- `api/src/db/migrations/033_recovery_flag_events.sql` (DATE week_start + flag CHECK + dedupe partial unique index — FIX-7/16/30)
- `api/src/schemas/userInjuries.ts`
- `api/src/routes/userInjuries.ts`
- `api/src/services/injuryRanker.ts`
- `api/src/services/recoveryFlagEvents.ts`
- `api/src/services/stalledPrEvaluator.ts`
- `api/src/services/overreachingEvaluator.ts`
- `api/tests/integration/user-injuries-schema.test.ts`
- `api/tests/integration/recovery-flag-events-schema.test.ts`
- `api/tests/routes/userInjuries.test.ts`
- `api/tests/integration/contamination/userInjuries-contamination.test.ts`
- `api/tests/integration/recovery-flag-overreaching-e2e.test.ts`
- `api/tests/integration/recovery-flag-telemetry.test.ts`
- `api/tests/services/injuryRanker.test.ts`
- `api/tests/services/stalledPrEvaluator.test.ts`
- `api/tests/services/overreachingEvaluator.test.ts`
- `frontend/src/components/settings/InjuryChipsEditor.tsx`
- `frontend/src/components/settings/InjuryChipsEditor.test.tsx`
- `frontend/src/components/programs/BlockOverflowMenu.tsx`
- `frontend/src/components/programs/BlockOverflowMenu.test.tsx`
- `frontend/src/components/programs/MidSessionSwapPicker.tsx` (FIX-9 — new picker; existing sheet untouched)
- `frontend/src/components/programs/MidSessionSwapPicker.test.tsx`
- `frontend/src/lib/api/userInjuries.ts`
- `frontend/src/lib/api/userInjuries.test.ts`
- `frontend/src/pages/SettingsInjuriesPage.tsx`
- `tests/e2e/w3-injury-swap-flow.spec.ts`

**Modified:**
- `api/src/auth/scopes.ts` — add `health:injuries:read`, `health:injuries:write`, `health:recovery:read` to `VALID_SCOPES` (FIX-3, FIX-28)
- `api/src/services/recoveryFlags.ts` — register `stalledPrEvaluator` + `overreachingEvaluator`
- `api/src/routes/recoveryFlags.ts` — register new evaluators + telemetry writes + scope gate (FIX-28)
- `api/src/services/substitutions.ts` — optional `userId` arg + extend SELECT for `joint_stress_profile` + pipe through `injuryRanker` (FIX-12, FIX-13)
- `api/src/services/getTodayWorkout.ts:101` — pass `ctx.userId` to `findSubstitutions`
- `api/src/schemas/exercises.ts` — `SubstitutionResponse.subs[]` gains optional `injury_advisory`
- `api/src/app.ts` — register `userInjuriesRoutes`
- `api/tests/integration/set-logs-to-recovery-flags.test.ts` — re-enable the `it.skip`
- `api/tests/helpers/seed-fixtures.ts` — add `seedStalledPr`, `seedUserOverreaching`, `seedOverreachingPartial`, `addThreeDistinctSessions`
- `frontend/src/components/programs/TodayWorkoutMobile.tsx` — `pickerTargetBlockIdx: number | null` + mount `<BlockOverflowMenu>` per block (FIX-10)
- `frontend/src/lib/terms.ts` — add `INJURY_ADVISORY_COPY` + `injuryAdvisoryCopy()`
- `frontend/src/App.tsx` — route for `/settings/injuries`
- `frontend/src/components/layout/Sidebar.tsx` — add Injuries entry to `SETTINGS_SUB` (FIX-11)
- `docs/superpowers/goals/beta.md` — flip W3 to `[x]`, update G-gates, refresh Next dispatch

**Untouched (deliberately, per FIX-9):**
- `frontend/src/components/programs/MidSessionSwapSheet.tsx` — preserved as the single-target confirm step; `MidSessionSwapPicker` calls it.

---

# Phase 1 — Schema-first (serial)

> All Phase 1 tasks run on branch `beta/w3-clinical-signals`, single worktree. No parallelization — these are foundational.

## Task 1: Migration 032 — user_injuries table

**Files:**
- Create: `api/src/db/migrations/032_user_injuries.sql`
- Test: `api/tests/integration/user-injuries-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
// api/tests/integration/user-injuries-schema.test.ts
/**
 * Beta W3 — user_injuries schema test for migration 032.
 *
 * Validates that the new user_injuries table exists with the Beta API contract
 * columns, PK (user_id, joint), CHECK on joint (7-key enum), CHECK on severity,
 * the (user_id) lookup index, and a CASCADE FK to users.
 */
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

describe('user_injuries schema (migration 032)', () => {
  afterAll(async () => { await db.end(); });

  it('has user_id, joint, severity, notes, onset_at, created_at, updated_at columns', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'user_injuries'
       ORDER BY ordinal_position`,
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(cols.user_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols.joint).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.severity).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.notes).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.onset_at).toMatchObject({ data_type: 'date', is_nullable: 'YES' });
    expect(cols.created_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
    expect(cols.updated_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
  });

  it('enforces PRIMARY KEY (user_id, joint)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'user_injuries' AND indexname = 'user_injuries_pkey'`,
    );
    expect(rows[0]?.indexdef).toMatch(/UNIQUE.*\(user_id, joint\)/);
  });

  it('enforces CHECK joint IN (7-key enum)', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'user_injuries'::regclass AND conname LIKE '%joint%'`,
    );
    expect(rows.some((r) => /shoulder_left/.test(r.def) && /wrist/.test(r.def))).toBe(true);
  });

  it('enforces CHECK severity IN (low|mod|high)', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'user_injuries'::regclass AND conname LIKE '%severity%'`,
    );
    expect(rows.some((r) => /low.*mod.*high/.test(r.def))).toBe(true);
  });

  it('cascades on user delete', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'user_injuries'::regclass AND contype = 'f'`,
    );
    expect(rows[0]?.def).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/user-injuries-schema.test.ts
```

Expected: FAIL — `relation "user_injuries" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- api/src/db/migrations/032_user_injuries.sql
-- Beta W3 — user_injuries table.
-- One row per (user, joint) the user has marked as an active concern.
-- Drives the W3.2 injury-aware substitution ranker and W3.4 Settings UI.
--
-- joint is TEXT with a CHECK constraint pinned against the 7-key chip enum.
-- Adding a chip in the future requires (a) extending this CHECK, (b) adding
-- the joint to JOINT_ROOT in api/src/services/injuryRanker.ts, AND
-- (c) ensuring at least one exercise carries the matching joint key in
-- joint_stress_profile. All three or none.
--
-- [FIX-1] Table-scoped updated_at function — no shared set_updated_at()
-- exists in this project (see migrations 029/030 docblock for the canonical
-- per-table pattern).

CREATE TABLE IF NOT EXISTS user_injuries (
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joint       TEXT         NOT NULL CHECK (joint IN (
                 'shoulder_left','shoulder_right','low_back',
                 'knee_left','knee_right','elbow','wrist'
               )),
  severity    TEXT         NOT NULL DEFAULT 'mod' CHECK (severity IN ('low','mod','high')),
  notes       TEXT         NOT NULL DEFAULT '',
  onset_at    DATE         NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, joint)
);

CREATE INDEX IF NOT EXISTS user_injuries_user_id_idx ON user_injuries (user_id);

CREATE OR REPLACE FUNCTION user_injuries_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_injuries_updated_at
  BEFORE UPDATE ON user_injuries
  FOR EACH ROW EXECUTE FUNCTION user_injuries_set_updated_at();
```

- [ ] **Step 4: Run test, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npx vitest run tests/integration/user-injuries-schema.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/db/migrations/032_user_injuries.sql api/tests/integration/user-injuries-schema.test.ts
git commit -m "feat(api): user_injuries table for W3.4 injury chips (migration 032)"
```

---

## Task 2: Migration 033 — recovery_flag_events table

**Files:**
- Create: `api/src/db/migrations/033_recovery_flag_events.sql`
- Test: `api/tests/integration/recovery-flag-events-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
// api/tests/integration/recovery-flag-events-schema.test.ts
/**
 * Beta W3 — recovery_flag_events schema test for migration 033.
 *
 * Append-only telemetry: one row per (shown | dismissed) emit. Powers the
 * post-cohort tuning pass on the W3 evaluator thresholds per reviewer NIT
 * (master plan line 616).
 */
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

describe('recovery_flag_events schema (migration 033)', () => {
  afterAll(async () => { await db.end(); });

  it('has id, user_id, flag, week_start, event_type, occurred_at columns', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'recovery_flag_events'
       ORDER BY ordinal_position`,
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(cols.id).toMatchObject({ data_type: 'bigint', is_nullable: 'NO' });
    expect(cols.user_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(cols.flag).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.week_start).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.event_type).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(cols.occurred_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
  });

  it('enforces CHECK event_type IN (shown, dismissed)', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'recovery_flag_events'::regclass AND conname LIKE '%event_type%'`,
    );
    expect(rows.some((r) => /shown.*dismissed/.test(r.def))).toBe(true);
  });

  it('has (user_id, week_start, flag) lookup index', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'recovery_flag_events'`,
    );
    expect(rows.some((r) => /\(user_id, week_start, flag\)/.test(r.indexdef))).toBe(true);
  });

  it('cascades on user delete', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'recovery_flag_events'::regclass AND contype = 'f'`,
    );
    expect(rows[0]?.def).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/recovery-flag-events-schema.test.ts
```

Expected: FAIL — `relation "recovery_flag_events" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- api/src/db/migrations/033_recovery_flag_events.sql
-- Beta W3 — recovery_flag_events telemetry table.
-- Append-only. One row per recovery-flag first-show per (user, flag, week)
-- AND one row per user dismiss. Powers the post-cohort tuning pass on the
-- W3 evaluator thresholds.
--
-- [FIX-7] week_start is DATE (Monday-of-ISO-week), matching recovery_flag_dismissals
-- from migration 024. Required for join compatibility with the existing dismiss
-- correlation queries. Use Postgres date_trunc('week', current_date)::date on write.
--
-- [FIX-30] flag has a CHECK mirroring schemas/recoveryFlags.ts KNOWN_FLAGS, to
-- catch typos in recordFlagEvent({flag: 'overreach'}) before they land silently.
--
-- [FIX-16] (user_id, week_start, flag, event_type) UNIQUE for event_type='shown' —
-- enforced via a partial unique index. Lets evaluator emits ON CONFLICT DO NOTHING
-- on every poll without table-explosion. 'dismissed' events are append-only and
-- not deduped because each dismiss is a discrete user action worth recording.

CREATE TABLE IF NOT EXISTS recovery_flag_events (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag        TEXT         NOT NULL CHECK (flag IN ('bodyweight_crash','overreaching','stalled_pr')),
  week_start  DATE         NOT NULL,
  event_type  TEXT         NOT NULL CHECK (event_type IN ('shown','dismissed')),
  occurred_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_flag_events_lookup_idx
  ON recovery_flag_events (user_id, week_start, flag);

CREATE UNIQUE INDEX IF NOT EXISTS recovery_flag_events_shown_dedupe_idx
  ON recovery_flag_events (user_id, flag, week_start)
  WHERE event_type = 'shown';
```

Update the schema test in Step 1 accordingly:

```ts
// In recovery-flag-events-schema.test.ts:
it('week_start is DATE', async () => {
  // (was 'text', is_nullable: 'NO'); change to:
  expect(cols.week_start).toMatchObject({ data_type: 'date', is_nullable: 'NO' });
});

it('flag has CHECK against KNOWN_FLAGS', async () => {
  const { rows } = await db.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'recovery_flag_events'::regclass AND conname LIKE '%flag%'`,
  );
  expect(rows.some((r) => /bodyweight_crash.*overreaching.*stalled_pr/.test(r.def))).toBe(true);
});

it('shown events are deduped per (user, flag, week)', async () => {
  const { rows } = await db.query(
    `SELECT indexdef FROM pg_indexes
     WHERE tablename = 'recovery_flag_events' AND indexname = 'recovery_flag_events_shown_dedupe_idx'`,
  );
  expect(rows[0]?.indexdef).toMatch(/UNIQUE.*\(user_id, flag, week_start\).*WHERE.*shown/);
});
```

- [ ] **Step 4: Run test, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npx vitest run tests/integration/recovery-flag-events-schema.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/db/migrations/033_recovery_flag_events.sql api/tests/integration/recovery-flag-events-schema.test.ts
git commit -m "feat(api): recovery_flag_events telemetry table (migration 033)"
```

---

## Task 3: Zod schemas + types for user_injuries

**Files:**
- Create: `api/src/schemas/userInjuries.ts`
- Test: `api/tests/schemas/userInjuries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// api/tests/schemas/userInjuries.test.ts
import { describe, it, expect } from 'vitest';
import {
  INJURY_JOINTS,
  INJURY_SEVERITIES,
  UserInjuryUpsertRequestSchema,
  UserInjuryItemSchema,
} from '../../src/schemas/userInjuries.js';

describe('userInjuries schemas', () => {
  it('exports the 7-key joint enum', () => {
    expect(INJURY_JOINTS).toEqual([
      'shoulder_left','shoulder_right','low_back',
      'knee_left','knee_right','elbow','wrist',
    ]);
  });

  it('exports the 3-tier severity enum', () => {
    expect(INJURY_SEVERITIES).toEqual(['low','mod','high']);
  });

  it('UserInjuryUpsertRequestSchema accepts a valid payload', () => {
    const res = UserInjuryUpsertRequestSchema.safeParse({
      joint: 'knee_left', severity: 'mod', notes: 'meniscus', onset_at: '2026-02-15',
    });
    expect(res.success).toBe(true);
  });

  it('UserInjuryUpsertRequestSchema rejects unknown joint', () => {
    const res = UserInjuryUpsertRequestSchema.safeParse({ joint: 'ankle', severity: 'mod' });
    expect(res.success).toBe(false);
  });

  it('UserInjuryUpsertRequestSchema defaults severity=mod, notes=empty when omitted', () => {
    const res = UserInjuryUpsertRequestSchema.parse({ joint: 'knee_left' });
    expect(res.severity).toBe('mod');
    expect(res.notes).toBe('');
  });

  it('UserInjuryItemSchema requires created_at + updated_at as ISO strings', () => {
    const res = UserInjuryItemSchema.safeParse({
      joint: 'wrist', severity: 'low', notes: '', onset_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    expect(res.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/schemas/userInjuries.test.ts
```

Expected: FAIL — `Cannot find module '../../src/schemas/userInjuries.js'`.

- [ ] **Step 3: Write the schemas**

```ts
// api/src/schemas/userInjuries.ts
import { z } from 'zod';

export const INJURY_JOINTS = [
  'shoulder_left',
  'shoulder_right',
  'low_back',
  'knee_left',
  'knee_right',
  'elbow',
  'wrist',
] as const;
export type InjuryJoint = (typeof INJURY_JOINTS)[number];

export const INJURY_SEVERITIES = ['low', 'mod', 'high'] as const;
export type InjurySeverity = (typeof INJURY_SEVERITIES)[number];

export const UserInjuryUpsertRequestSchema = z.object({
  joint:    z.enum(INJURY_JOINTS),
  severity: z.enum(INJURY_SEVERITIES).default('mod'),
  notes:    z.string().max(500).default(''),
  onset_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
export type UserInjuryUpsertRequest = z.infer<typeof UserInjuryUpsertRequestSchema>;

export const UserInjuryPatchRequestSchema = UserInjuryUpsertRequestSchema
  .omit({ joint: true })
  .partial();
export type UserInjuryPatchRequest = z.infer<typeof UserInjuryPatchRequestSchema>;

export const UserInjuryItemSchema = z.object({
  joint:      z.enum(INJURY_JOINTS),
  severity:   z.enum(INJURY_SEVERITIES),
  notes:      z.string(),
  onset_at:   z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type UserInjuryItem = z.infer<typeof UserInjuryItemSchema>;

export const UserInjuryListResponseSchema = z.object({
  injuries: z.array(UserInjuryItemSchema),
});
export type UserInjuryListResponse = z.infer<typeof UserInjuryListResponseSchema>;
```

- [ ] **Step 4: Run test, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/schemas/userInjuries.test.ts && npx tsc --noEmit
```

Expected: 6/6 PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add api/src/schemas/userInjuries.ts api/tests/schemas/userInjuries.test.ts
git commit -m "feat(api): zod schemas + types for user_injuries"
```

---

## Task 4: Add `health:injuries:read` + `health:injuries:write` + `health:recovery:read` scopes

**Files:**
- Modify: `api/src/auth/scopes.ts` (the `VALID_SCOPES` `as const` tuple — [FIX-3])

[FIX-28] We also add `health:recovery:read` because Task 12.5 scope-gates the existing `/api/recovery-flags` routes (they're currently unscoped — security finding).

- [ ] **Step 1: Inspect the existing tuple**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && cat src/auth/scopes.ts
```

Expected output: a `VALID_SCOPES = [...] as const` tuple including `'health:weight:write'`, `'health:workouts:write'`, `'program:write'`, `'set_logs:write'`. Note that `requireScope`'s parameter is typed as `Scope` (the union derived from this tuple), so adding a string elsewhere fails typecheck.

- [ ] **Step 2: Write the failing test**

```ts
// add to api/tests/integration/scope-enforcement.test.ts (existing file)
// OR create api/tests/integration/scope-injuries.test.ts if isolation is preferred.
it('GET /api/user/injuries requires health:injuries:read scope', async () => {
  // mint a bearer with ONLY set_logs:write
  const noReadScope = await mintBearer({ scopes: ['set_logs:write'] });
  const resp = await app.inject({
    method: 'GET',
    url: '/api/user/injuries',
    headers: { authorization: `Bearer ${noReadScope}` },
  });
  expect(resp.statusCode).toBe(403);
});

it('POST /api/user/injuries requires health:injuries:write scope', async () => {
  const readOnly = await mintBearer({ scopes: ['health:injuries:read'] });
  const resp = await app.inject({
    method: 'POST',
    url: '/api/user/injuries',
    headers: { authorization: `Bearer ${readOnly}` },
    payload: { joint: 'knee_left' },
  });
  expect(resp.statusCode).toBe(403);
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/scope-enforcement.test.ts
```

Expected: FAIL — route doesn't exist yet AND scope strings not in allowlist.

- [ ] **Step 4: Add the scopes to `VALID_SCOPES`**

Edit `api/src/auth/scopes.ts`. Add three entries to the `VALID_SCOPES` `as const` tuple:

```ts
'health:injuries:read',
'health:injuries:write',
'health:recovery:read',   // [FIX-28] gates the existing /api/recovery-flags routes
```

(Order doesn't matter — the file is unordered today.) Because the tuple is `as const`, `Scope` (the union type) automatically widens to include the new values, and `requireScope('health:injuries:write')` typechecks.

- [ ] **Step 5: Commit**

```bash
git add api/src/auth/scopes.ts api/tests/integration/scope-enforcement.test.ts
git commit -m "feat(api): add health:injuries:{read,write} + health:recovery:read scopes"
```

(Note: tests will still FAIL on the route side — that's expected. They go green after Task 5.)

---

## Task 5: Route — GET /api/user/injuries (list)

**Files:**
- Create: `api/src/routes/userInjuries.ts`
- Modify: `api/src/app.ts` (register the route plugin)
- Test: `api/tests/routes/userInjuries.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
// api/tests/routes/userInjuries.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.w3-inj' });
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'w3-inj', scopes: ['health:injuries:read','health:injuries:write'] },
  });
  token = mint.json<{ token: string }>().token;
});

afterAll(async () => {
  await db.query('DELETE FROM user_injuries WHERE user_id=$1', [userId]);
  await cleanupUser(userId);
  await app.close();
});

describe('GET /api/user/injuries', () => {
  it('returns empty array for new user', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual({ injuries: [] });
  });

  it('returns user-owned rows only', async () => {
    await db.query(
      `INSERT INTO user_injuries (user_id, joint, severity, notes) VALUES ($1,$2,$3,$4)`,
      [userId, 'knee_left', 'mod', 'meniscus'],
    );
    const resp = await app.inject({
      method: 'GET',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ injuries: Array<{ joint: string }> }>();
    expect(body.injuries.map((r) => r.joint)).toEqual(['knee_left']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/userInjuries.test.ts
```

Expected: FAIL — 404 Route GET:/api/user/injuries not found.

- [ ] **Step 3: Write the route — list handler only for now**

```ts
// api/src/routes/userInjuries.ts
// [FIX-2] requireScope lives in middleware/scope.ts (singular), NOT cfAccess.js.
// [FIX-29] use typed req.userId with explicit nullish guard — matches setLogs.ts:50-51.
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import {
  UserInjuryListResponseSchema,
  type UserInjuryListResponse,
} from '../schemas/userInjuries.js';

export async function userInjuriesRoutes(app: FastifyInstance) {
  app.get('/api/user/injuries', {
    preHandler: [requireBearerOrCfAccess, requireScope('health:injuries:read')],
  }, async (req, reply) => {
    const userId = req.userId;
    if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
    const { rows } = await db.query(
      `SELECT joint, severity, notes,
              to_char(onset_at, 'YYYY-MM-DD') AS onset_at,
              created_at, updated_at
       FROM user_injuries WHERE user_id = $1 ORDER BY joint`,
      [userId],
    );
    const body: UserInjuryListResponse = {
      injuries: rows.map((r) => ({
        joint: r.joint, severity: r.severity, notes: r.notes,
        onset_at: r.onset_at, // null if NULL
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
      })),
    };
    return reply.send(UserInjuryListResponseSchema.parse(body));
  });
}
```

Then register in `api/src/app.ts`:

```ts
import { userInjuriesRoutes } from './routes/userInjuries.js';
// ...
await app.register(userInjuriesRoutes);
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/userInjuries.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/userInjuries.ts api/src/app.ts api/tests/routes/userInjuries.test.ts
git commit -m "feat(api): GET /api/user/injuries (list user-owned rows)"
```

---

## Task 6: Route — POST /api/user/injuries (upsert)

**Files:**
- Modify: `api/src/routes/userInjuries.ts`
- Modify: `api/tests/routes/userInjuries.test.ts` (extend)

- [ ] **Step 1: Add failing tests for POST**

Append to `api/tests/routes/userInjuries.test.ts`:

```ts
describe('POST /api/user/injuries', () => {
  it('creates a new row and returns 201 with the persisted shape', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'shoulder_left', severity: 'high', notes: 'impingement', onset_at: '2025-11-03' },
    });
    expect(resp.statusCode).toBe(201);
    const body = resp.json<{ injury: { joint: string; severity: string } }>();
    expect(body.injury).toMatchObject({ joint: 'shoulder_left', severity: 'high', notes: 'impingement' });
  });

  it('upserts on duplicate (user_id, joint) — 200 + updated row', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'shoulder_left', severity: 'low', notes: 'better now' },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ injury: { severity: string; notes: string } }>();
    expect(body.injury).toMatchObject({ severity: 'low', notes: 'better now' });
  });

  it('rejects unknown joint with 400 field_error', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'ankle' },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json<{ field_error?: object }>().field_error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/userInjuries.test.ts
```

Expected: 3 new FAILs (POST not registered).

- [ ] **Step 3: Implement POST handler**

Add to `api/src/routes/userInjuries.ts` inside `userInjuriesRoutes`:

```ts
import {
  UserInjuryUpsertRequestSchema,
  type UserInjuryItem,
} from '../schemas/userInjuries.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';

app.post('/api/user/injuries', {
  preHandler: [requireBearerOrCfAccess, requireScope('health:injuries:write')],
}, async (req, reply) => {
  const parsed = UserInjuryUpsertRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: 'invalid_payload',
      field_error: zodToFieldError(parsed.error),
    });
  }
  const userId = req.userId;
  if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
  const { joint, severity, notes, onset_at } = parsed.data;

  const { rows: [existing] } = await db.query(
    `SELECT joint FROM user_injuries WHERE user_id=$1 AND joint=$2`,
    [userId, joint],
  );
  const isNew = !existing;

  const { rows: [row] } = await db.query(
    `INSERT INTO user_injuries (user_id, joint, severity, notes, onset_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, joint) DO UPDATE SET
       severity = EXCLUDED.severity,
       notes = EXCLUDED.notes,
       onset_at = EXCLUDED.onset_at,
       updated_at = now()
     RETURNING joint, severity, notes,
               to_char(onset_at,'YYYY-MM-DD') AS onset_at,
               created_at, updated_at`,
    [userId, joint, severity, notes, onset_at ?? null],
  );

  const injury: UserInjuryItem = {
    joint: row.joint, severity: row.severity, notes: row.notes,
    onset_at: row.onset_at,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
  return reply.code(isNew ? 201 : 200).send({ injury });
});
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/userInjuries.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/userInjuries.ts api/tests/routes/userInjuries.test.ts
git commit -m "feat(api): POST /api/user/injuries (upsert with idempotent shape)"
```

---

## Task 7: Route — PATCH /api/user/injuries/:joint

**Files:**
- Modify: `api/src/routes/userInjuries.ts`
- Modify: `api/tests/routes/userInjuries.test.ts`

- [ ] **Step 1: Add failing PATCH tests**

```ts
describe('PATCH /api/user/injuries/:joint', () => {
  it('updates severity + notes; returns 200 with new shape', async () => {
    await app.inject({
      method: 'POST', url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'elbow' },
    });
    const resp = await app.inject({
      method: 'PATCH', url: '/api/user/injuries/elbow',
      headers: { authorization: `Bearer ${token}` },
      payload: { severity: 'high', notes: 'tendonitis' },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json<{ injury: { severity: string } }>().injury.severity).toBe('high');
  });

  it('404 when row does not exist', async () => {
    const resp = await app.inject({
      method: 'PATCH', url: '/api/user/injuries/wrist',
      headers: { authorization: `Bearer ${token}` },
      payload: { severity: 'low' },
    });
    expect(resp.statusCode).toBe(404);
  });

  it('400 on unknown :joint path param', async () => {
    const resp = await app.inject({
      method: 'PATCH', url: '/api/user/injuries/ankle',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(resp.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/userInjuries.test.ts
```

Expected: 3 new FAILs.

- [ ] **Step 3: Add PATCH handler**

```ts
import {
  UserInjuryPatchRequestSchema,
  INJURY_JOINTS,
} from '../schemas/userInjuries.js';

app.patch<{ Params: { joint: string } }>('/api/user/injuries/:joint', {
  preHandler: [requireBearerOrCfAccess, requireScope('health:injuries:write')],
}, async (req, reply) => {
  if (!INJURY_JOINTS.includes(req.params.joint as any)) {
    return reply.code(400).send({ error: 'unknown_joint' });
  }
  const parsed = UserInjuryPatchRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_payload', field_error: zodToFieldError(parsed.error) });
  }
  const userId = req.userId;
  if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
  const fields: string[] = []; const values: unknown[] = [userId, req.params.joint];
  let i = 3;
  for (const k of ['severity','notes','onset_at'] as const) {
    if (parsed.data[k] !== undefined) {
      fields.push(`${k} = $${i++}`); values.push(parsed.data[k]);
    }
  }
  if (!fields.length) return reply.code(400).send({ error: 'empty_patch' });
  const { rows: [row] } = await db.query(
    `UPDATE user_injuries SET ${fields.join(', ')}, updated_at = now()
     WHERE user_id = $1 AND joint = $2
     RETURNING joint, severity, notes,
               to_char(onset_at,'YYYY-MM-DD') AS onset_at,
               created_at, updated_at`,
    values,
  );
  if (!row) return reply.code(404).send({ error: 'not_found' });
  return reply.send({
    injury: {
      joint: row.joint, severity: row.severity, notes: row.notes,
      onset_at: row.onset_at,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    },
  });
});
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/userInjuries.test.ts
```

Expected: 8/8 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/userInjuries.ts api/tests/routes/userInjuries.test.ts
git commit -m "feat(api): PATCH /api/user/injuries/:joint"
```

---

## Task 8: Route — DELETE /api/user/injuries/:joint

**Files:**
- Modify: `api/src/routes/userInjuries.ts`
- Modify: `api/tests/routes/userInjuries.test.ts`

- [ ] **Step 1: Add failing DELETE tests**

```ts
describe('DELETE /api/user/injuries/:joint', () => {
  it('removes the row and returns 204', async () => {
    await app.inject({
      method: 'POST', url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'wrist' },
    });
    const resp = await app.inject({
      method: 'DELETE', url: '/api/user/injuries/wrist',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(204);
    const { rows } = await db.query(
      `SELECT 1 FROM user_injuries WHERE user_id=$1 AND joint='wrist'`, [userId]);
    expect(rows.length).toBe(0);
  });

  it('204 idempotent on missing row', async () => {
    const resp = await app.inject({
      method: 'DELETE', url: '/api/user/injuries/knee_right',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/userInjuries.test.ts
```

Expected: 2 new FAILs.

- [ ] **Step 3: Add DELETE handler**

```ts
app.delete<{ Params: { joint: string } }>('/api/user/injuries/:joint', {
  preHandler: [requireBearerOrCfAccess, requireScope('health:injuries:write')],
}, async (req, reply) => {
  if (!INJURY_JOINTS.includes(req.params.joint as any)) {
    return reply.code(400).send({ error: 'unknown_joint' });
  }
  const userId = req.userId;
  if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
  await db.query(
    `DELETE FROM user_injuries WHERE user_id=$1 AND joint=$2`,
    [userId, req.params.joint],
  );
  return reply.code(204).send();
});
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/userInjuries.test.ts
```

Expected: 10/10 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/userInjuries.ts api/tests/routes/userInjuries.test.ts
git commit -m "feat(api): DELETE /api/user/injuries/:joint (idempotent)"
```

---

## Task 9: Contamination matrix — G2 contribution

**Files:**
- Create: `api/tests/integration/contamination/userInjuries-contamination.test.ts`

- [ ] **Step 1: Write the cross-user IDOR matrix**

```ts
// api/tests/integration/contamination/userInjuries-contamination.test.ts
/**
 * G2 contribution — cross-user contamination test for /api/user/injuries.
 * Per master plan G2: every per-user route must assert 404/403 (never
 * 200-with-other-user-data) when a bearer for user A targets user B's resource.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userA: string; let tokenA: string;
let userB: string; let tokenB: string;

beforeAll(async () => {
  app = await buildApp();
  const a = await mkUser({ prefix: 'vitest.w3-cont-a' }); userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w3-cont-b' }); userB = b.id;
  const ma = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['health:injuries:read','health:injuries:write'] },
  });
  tokenA = ma.json<{ token: string }>().token;
  const mb = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userB, label: 'b', scopes: ['health:injuries:read','health:injuries:write'] },
  });
  tokenB = mb.json<{ token: string }>().token;

  await db.query(
    `INSERT INTO user_injuries (user_id, joint, severity) VALUES ($1,'shoulder_left','mod')`,
    [userB],
  );
});

afterAll(async () => {
  await db.query('DELETE FROM user_injuries WHERE user_id IN ($1,$2)', [userA, userB]);
  await cleanupUser(userA); await cleanupUser(userB); await app.close();
});

describe('userInjuries contamination — G2', () => {
  it('GET only returns user A rows, never user B rows', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/user/injuries',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ injuries: unknown[] }>().injuries).toEqual([]);
  });

  it('PATCH user B row from user A token returns 404 (no oracle)', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/user/injuries/shoulder_left',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { severity: 'high' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('DELETE user B row from user A token is silent-204 (idempotent, no row exposed)', async () => {
    const r = await app.inject({
      method: 'DELETE', url: '/api/user/injuries/shoulder_left',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(204);
    // Verify B's row is still there
    const { rows } = await db.query(
      `SELECT 1 FROM user_injuries WHERE user_id=$1 AND joint='shoulder_left'`,
      [userB],
    );
    expect(rows.length).toBe(1);
  });

  it('POST same joint from user A does not collide with user B row', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/user/injuries',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { joint: 'shoulder_left', severity: 'low' },
    });
    expect(r.statusCode).toBe(201);
    const { rows } = await db.query(
      `SELECT user_id, severity FROM user_injuries WHERE joint='shoulder_left' ORDER BY user_id`,
    );
    expect(rows.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect PASS** (the routes are already correct; this just locks the contract)

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/contamination/userInjuries-contamination.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 3: Commit**

```bash
git add api/tests/integration/contamination/userInjuries-contamination.test.ts
git commit -m "test(api): user_injuries cross-user contamination matrix (G2)"
```

---

## Phase 1 close — typecheck + full suite

- [ ] **Step 1: Run full API suite + typecheck**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit && npm test
```

Expected: clean. If anything is red, stop and fix before Phase 2 dispatch.

- [ ] **Step 2: Push the Phase-1 branch**

```bash
git push -u origin beta/w3-clinical-signals
```

Phase 1 ends here. Phase 2 fans out four independent sub-waves on top of this branch.

---

# Phase 2 — Parallel fan-out (4 worktrees)

> Dispatch the four sub-waves below in parallel via `superpowers:dispatching-parallel-agents`. **Per [[feedback_worktree_isolation]]:** each agent prompt must use `isolation: "worktree"` and must NOT contain absolute paths into the project root. Each sub-wave produces its own branch off `beta/w3-clinical-signals` and merges back to it.

## Sub-wave W3.1 — Recovery-flag evaluators

Branch: `beta/w3-clinical-signals/w3.1-evaluators`

### Task 10: stalledPrEvaluator — unit test (red)

**Files:**
- Modify: `api/tests/helpers/seed-fixtures.ts` (add `seedStalledPr` helper — [FIX-17])
- Create: `api/tests/services/stalledPrEvaluator.test.ts`
- Create: `api/src/services/stalledPrEvaluator.ts`

[FIX-4] set_logs columns are `performed_load_lbs` + `performed_reps` (not `weight_lbs`/`reps`); `set_logs` has NO `mesocycle_run_id`/`day_workout_id` columns — must join through `planned_sets → day_workouts` to identify session boundaries.

[FIX-6] `RecoveryFlagEvaluator` interface uses `key` (not `flag`); ctx is `{ userId, runId, weekIdx }` (not `{ userId, now }`); result is `{ triggered: false }` or `{ triggered: true, message, payload? }` — NO `flag` field on the result.

[FIX-24] Skip the rule when the active microcycle is a planned deload — stagnation is expected there.

[FIX-25] Gate on `max_reps >= 5` — strength blocks at 2–3 reps legitimately stall numerically.

- [ ] **Step 1: Add the seed helper + write the failing unit test**

In `api/tests/helpers/seed-fixtures.ts`, add:

```ts
export async function seedStalledPr(opts: {
  pattern: 'stalled' | 'progressing' | 'rir-mixed' | 'deload' | 'low-rep';
}): Promise<SeedHandle> {
  const seed = await seedUserWithMesocycle();
  const { userId, plannedSetId, exerciseId, dayWorkoutId, mesocycleRunId } = seed;
  // Add two more planned_sets on different day_workouts (different sessions) so we
  // can post 3 distinct sessions. Use the same dayWorkoutId across 3 sessions by
  // bumping week_idx on duplicated day_workout rows. (Helper details below — see
  // existing seedUserWithMesocycle for the pattern.)
  const sessions = await addThreeDistinctSessions(seed);
  const baseLoad = 225; const baseReps = 8;
  for (let i = 0; i < 3; i++) {
    let load = baseLoad; let reps = baseReps; let rir = 0;
    if (opts.pattern === 'progressing' && i === 2) load = 235;
    if (opts.pattern === 'rir-mixed'   && i === 1) rir = 2;
    if (opts.pattern === 'low-rep')   { reps = 3; }
    if (opts.pattern === 'deload' && i === 2) {
      // mark the most-recent session's microcycle as deload
      await db.query(`UPDATE day_workouts SET is_deload = TRUE WHERE id = $1`, [sessions[i].dayWorkoutId]);
    }
    await db.query(
      `INSERT INTO set_logs (user_id, planned_set_id, performed_at, performed_load_lbs, performed_reps, performed_rir)
       VALUES ($1, $2, now() - $3::int * INTERVAL '1 day', $4, $5, $6)`,
      [userId, sessions[i].plannedSetId, 3 - i, load, reps, rir],
    );
  }
  return seed;
}
```

(`addThreeDistinctSessions` is a small helper that inserts 2 additional `day_workouts` rows on the same mesocycle_run plus matching `planned_sets` rows pointing to the same exercise; follow the pattern in the existing W1.5 test `addExtraPlannedSets`. Note: this assumes `day_workouts.is_deload BOOLEAN` already exists from W2's deload work; if not, see the [FIX-24] note in Step 3 for a fallback.)

```ts
// api/tests/services/stalledPrEvaluator.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach } from 'vitest';
import { stalledPrEvaluator } from '../../src/services/stalledPrEvaluator.js';
import { seedStalledPr, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });

describe('stalledPrEvaluator', () => {
  it('fires when last 3 sessions same exercise have same load/reps, all RIR-0', async () => {
    const seed = await seedStalledPr({ pattern: 'stalled' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(true);
    if (r.triggered) expect(r.payload?.exercise_id).toBe(seed.exerciseId);
  });

  it('does NOT fire when most recent session shows weight increase', async () => {
    const seed = await seedStalledPr({ pattern: 'progressing' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  it('does NOT fire when any set in the 3-session streak has RIR > 0', async () => {
    const seed = await seedStalledPr({ pattern: 'rir-mixed' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  // [FIX-24]
  it('does NOT fire during a planned deload microcycle', async () => {
    const seed = await seedStalledPr({ pattern: 'deload' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  // [FIX-25]
  it('does NOT fire for low-rep (strength block) sessions', async () => {
    const seed = await seedStalledPr({ pattern: 'low-rep' });
    handles.push(seed);
    const r = await stalledPrEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/services/stalledPrEvaluator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the evaluator with corrected schema + clinical guards**

```ts
// api/src/services/stalledPrEvaluator.ts
//
// [FIX-4] set_logs columns: performed_load_lbs, performed_reps, performed_rir.
//         No mesocycle_run_id / day_workout_id on set_logs — join through
//         planned_sets → day_workouts.
// [FIX-6] Evaluator interface uses key/version + ctx {userId, runId, weekIdx};
//         result shape is { triggered: false } | { triggered: true, message, payload? }.
// [FIX-24] Skip evaluation when the most-recent session's day_workout is is_deload.
//          If migration for is_deload isn't shipped yet, infer deload from
//          mesocycle_runs.deload_week_idx === current week — implement whichever
//          source is canonical at execution time.
// [FIX-25] Gate on max_reps >= 5 — strength blocks at 2-3 reps legitimately stall.
import { db } from '../db/client.js';
import type { RecoveryFlagEvaluator } from './recoveryFlags.js';

export const stalledPrEvaluator: RecoveryFlagEvaluator = {
  key: 'stalled_pr',
  version: 1,
  async evaluate({ userId }) {
    const { rows } = await db.query<{
      exercise_id: string;
      day_workout_id: string;
      is_deload: boolean;
      max_load: number;
      max_reps: number;
      min_rir: number;
      session_rank: number;
    }>(
      `WITH session_agg AS (
         SELECT
           sl.exercise_id,
           dw.id AS day_workout_id,
           COALESCE(dw.is_deload, FALSE) AS is_deload,
           MAX(sl.performed_load_lbs)::float AS max_load,
           MAX(sl.performed_reps)::int AS max_reps,
           MIN(sl.performed_rir)::int AS min_rir,
           MAX(sl.performed_at) AS session_at
         FROM set_logs sl
         JOIN planned_sets ps ON ps.id = sl.planned_set_id
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         WHERE sl.user_id = $1
         GROUP BY sl.exercise_id, dw.id, dw.is_deload
       ),
       ranked AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY exercise_id ORDER BY session_at DESC) AS session_rank
         FROM session_agg
       )
       SELECT exercise_id, day_workout_id, is_deload, max_load, max_reps, min_rir, session_rank
       FROM ranked WHERE session_rank <= 3 ORDER BY exercise_id, session_rank`,
      [userId],
    );
    const byEx = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byEx.get(r.exercise_id) ?? [];
      arr.push(r); byEx.set(r.exercise_id, arr);
    }
    for (const sessions of byEx.values()) {
      if (sessions.length < 3) continue;
      // [FIX-24] skip if any of the 3 sessions is a planned deload
      if (sessions.some((s) => s.is_deload)) continue;
      const [a, b, c] = sessions;
      // [FIX-25] only fire on hypertrophy-range work (>=5 reps)
      if (a.max_reps < 5) continue;
      if (
        a.max_load === b.max_load && b.max_load === c.max_load &&
        a.max_reps === b.max_reps && b.max_reps === c.max_reps &&
        a.min_rir === 0 && b.min_rir === 0 && c.min_rir === 0
      ) {
        return {
          triggered: true,
          message: 'Stalled PR — consider a load drop or rep adjustment',
          payload: { exercise_id: a.exercise_id },
        };
      }
    }
    return { triggered: false };
  },
};
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/services/stalledPrEvaluator.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/stalledPrEvaluator.ts api/tests/services/stalledPrEvaluator.test.ts api/tests/helpers/seed-fixtures.ts
git commit -m "feat(api): stalledPrEvaluator — 3-session stagnation rule (W3.1)"
```

---

### Task 11: overreachingEvaluator — unit test (red)

**Files:**
- Modify: `api/tests/helpers/seed-fixtures.ts` (add `seedUserOverreaching` helper — [FIX-17])
- Create: `api/tests/services/overreachingEvaluator.test.ts`
- Create: `api/src/services/overreachingEvaluator.ts`

[FIX-5] `computeVolumeRollup(runId: string): Promise<{ run_id, weeks: WeekVolume[] }>` — takes a `mesocycle_run_id`, returns weeks with per-muscle `performed_sets` and `mav`. NOT `({ userId, now })` returning `{ muscles }`.

[FIX-6] Evaluator interface: `key`/`version`/ctx `{ userId, runId, weekIdx }`/result without `flag` field. Same as stalled-PR.

[FIX-27] Threshold preserved (1 week ≥ MAV) to keep the W1.5 e2e contract intact, with explicit docblock noting the clinical-naming mismatch. Tuning candidate post-cohort via `recovery_flag_events` telemetry.

- [ ] **Step 1: Seed helper + failing test**

In `api/tests/helpers/seed-fixtures.ts`:

```ts
export async function seedUserOverreaching(): Promise<SeedHandle & { bearer: string }> {
  const seed = await seedUserWithMesocycle();
  // 3 RIR-0 compound sessions in the current 7d
  const sessions = await addThreeDistinctSessions(seed); // same helper as Task 10
  for (let i = 0; i < 3; i++) {
    await db.query(
      `INSERT INTO set_logs (user_id, planned_set_id, performed_at, performed_load_lbs, performed_reps, performed_rir)
       VALUES ($1, $2, now() - $3::int * INTERVAL '1 day', 225, 8, 0)`,
      [seed.userId, sessions[i].plannedSetId, 3 - i],
    );
  }
  // Volume seed — push primary muscle's volume_rollup performed_sets >= MAV
  // by inserting enough set_logs against planned_sets that contribute to MAV.
  // (See volumeRollup.ts for the MAV computation; the W1.5 test already
  // seeds at MEV level, this needs MAV.)
  return seed;
}
```

```ts
// api/tests/services/overreachingEvaluator.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach } from 'vitest';
import { overreachingEvaluator } from '../../src/services/overreachingEvaluator.js';
import { seedUserOverreaching, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
// helpers to seed each negative case (2-RIR0, isolation-only, under-MAV)
import { seedOverreachingPartial } from '../helpers/seed-fixtures.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });

describe('overreachingEvaluator (W3.1 AND-gate)', () => {
  it('fires when ALL conditions met', async () => {
    const seed = await seedUserOverreaching(); handles.push(seed);
    const r = await overreachingEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(true);
  });

  it('does NOT fire when only 2 RIR-0 compound sessions / 7d', async () => {
    const seed = await seedOverreachingPartial({ rir0Sessions: 2 }); handles.push(seed);
    const r = await overreachingEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  it('does NOT fire when 3 RIR-0 sessions on isolation exercises', async () => {
    const seed = await seedOverreachingPartial({ exerciseType: 'isolation' }); handles.push(seed);
    const r = await overreachingEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });

  it('does NOT fire when 3 RIR-0 compound sessions but volume < MAV', async () => {
    const seed = await seedOverreachingPartial({ underMav: true }); handles.push(seed);
    const r = await overreachingEvaluator.evaluate({
      userId: seed.userId, runId: seed.mesocycleRunId, weekIdx: 0,
    });
    expect(r.triggered).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/services/overreachingEvaluator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement with corrected `computeVolumeRollup` signature**

```ts
// api/src/services/overreachingEvaluator.ts
//
// [FIX-5] computeVolumeRollup takes runId, returns { run_id, weeks: WeekVolume[] }.
//         Pick the current week via weekIdx from the evaluator ctx.
// [FIX-6] key/version + ctx {userId, runId, weekIdx} + result without flag field.
// [FIX-27] Threshold ("one week ≥ MAV") preserved to keep the W1.5 e2e contract
//          intact. The clinical reviewer flagged this as closer to "high-effort
//          week" than canonical overreaching; tuning candidate post-cohort
//          informed by recovery_flag_events telemetry. Reference:
//          [[reference_w3_tuning_candidates]] memory after merge.
import { db } from '../db/client.js';
import type { RecoveryFlagEvaluator } from './recoveryFlags.js';
import { computeVolumeRollup } from './volumeRollup.js';

const COMPOUND_PATTERNS = [
  'squat','hinge',
  'push_horizontal','push_vertical',
  'pull_horizontal','pull_vertical',
] as const;

export const overreachingEvaluator: RecoveryFlagEvaluator = {
  key: 'overreaching',
  version: 1,
  async evaluate({ userId, runId, weekIdx }) {
    // Condition 1: ≥3 RIR-0 sessions on compound exercises in trailing 7d.
    // Join through planned_sets to reach exercises.movement_pattern.
    const { rows: hits } = await db.query<{ ct: number }>(
      `SELECT COUNT(*)::int AS ct FROM set_logs sl
       JOIN planned_sets ps ON ps.id = sl.planned_set_id
       JOIN exercises e ON e.id = ps.exercise_id
       WHERE sl.user_id = $1
         AND sl.performed_rir = 0
         AND sl.performed_at > now() - INTERVAL '7 days'
         AND e.movement_pattern = ANY($2::text[])`,
      [userId, [...COMPOUND_PATTERNS]],
    );
    if ((hits[0]?.ct ?? 0) < 3) return { triggered: false };

    // Condition 2: current-week volume ≥ MAV for at least one worked muscle.
    // [FIX-5] Correct shape: weeks[].muscles[].performed_sets vs .mav
    const rollup = await computeVolumeRollup(runId);
    const week = rollup.weeks.find((w) => w.week_idx === weekIdx);
    if (!week) return { triggered: false };
    const overMav = week.muscles.some((m) => m.performed_sets >= m.mav);
    if (!overMav) return { triggered: false };

    return {
      triggered: true,
      message: 'Heavy week — consider a deload',
    };
  },
};
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/services/overreachingEvaluator.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/overreachingEvaluator.ts api/tests/services/overreachingEvaluator.test.ts api/tests/helpers/seed-fixtures.ts
git commit -m "feat(api): overreachingEvaluator — strict AND-gate (W3.1 Q1)"
```

---

### Task 12: Register both evaluators + telemetry on emit

**Files:**
- Create: `api/src/services/recoveryFlagEvents.ts`
- Modify: `api/src/routes/recoveryFlags.ts`
- Test: `api/tests/integration/recovery-flag-telemetry.test.ts`

- [ ] **Step 1: Write the telemetry test**

```ts
// api/tests/integration/recovery-flag-telemetry.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { seedUserOverreaching } from '../helpers/seed-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string;

beforeAll(async () => {
  app = await buildApp();
  const seed = await seedUserOverreaching();
  userId = seed.userId; token = seed.bearer;
});

afterAll(async () => {
  await db.query(`DELETE FROM recovery_flag_events WHERE user_id=$1`, [userId]);
  await app.close();
});

describe('recovery_flag_events telemetry', () => {
  it('writes a row on shown emit', async () => {
    const before = await db.query(`SELECT COUNT(*) FROM recovery_flag_events WHERE user_id=$1`, [userId]);
    await app.inject({
      method: 'GET', url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${token}` },
    });
    const after = await db.query(
      `SELECT flag, event_type, week_start FROM recovery_flag_events WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(after.rows[0]).toMatchObject({ flag: 'overreaching', event_type: 'shown' });
  });

  it('writes a row on dismiss', async () => {
    await app.inject({
      method: 'POST', url: '/api/recovery-flags/dismiss',
      headers: { authorization: `Bearer ${token}` },
      payload: { flag: 'overreaching' },
    });
    const { rows } = await db.query(
      `SELECT event_type FROM recovery_flag_events WHERE user_id=$1 AND event_type='dismissed' ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows[0]?.event_type).toBe('dismissed');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/recovery-flag-telemetry.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement telemetry service + wire into route**

```ts
// api/src/services/recoveryFlagEvents.ts
//
// [FIX-8] No JS isoWeekKey() helper — Postgres date_trunc('week', current_date)::date
//         is the existing project pattern, matching recovery_flag_dismissals.week_start.
// [FIX-16] 'shown' rows are deduped via ON CONFLICT against the partial unique index
//          recovery_flag_events_shown_dedupe_idx (Task 2 migration). 'dismissed'
//          rows are append-only.
// [FIX-30] flag is validated by the CHECK constraint on the table (Task 2 migration).
import { db } from '../db/client.js';
import type { RecoveryFlagKey } from '../schemas/recoveryFlags.js';

export async function recordFlagShown(params: {
  userId: string; flag: RecoveryFlagKey;
}): Promise<void> {
  await db.query(
    `INSERT INTO recovery_flag_events (user_id, flag, week_start, event_type)
     VALUES ($1, $2, date_trunc('week', current_date)::date, 'shown')
     ON CONFLICT (user_id, flag, week_start) WHERE event_type = 'shown' DO NOTHING`,
    [params.userId, params.flag],
  );
}

export async function recordFlagDismissed(params: {
  userId: string; flag: RecoveryFlagKey;
}): Promise<void> {
  await db.query(
    `INSERT INTO recovery_flag_events (user_id, flag, week_start, event_type)
     VALUES ($1, $2, date_trunc('week', current_date)::date, 'dismissed')`,
    [params.userId, params.flag],
  );
}
```

Modify `api/src/routes/recoveryFlags.ts` to register the new evaluators AND record telemetry. **Note `f.key`, not `f.flag`** — `EvaluatedFlag` has `key` per the existing service interface.

```ts
import { stalledPrEvaluator } from '../services/stalledPrEvaluator.js';
import { overreachingEvaluator } from '../services/overreachingEvaluator.js';
import { recordFlagShown, recordFlagDismissed } from '../services/recoveryFlagEvents.js';

export async function recoveryFlagRoutes(app: FastifyInstance) {
  registerEvaluator(bodyweightCrashEvaluator);
  registerEvaluator(stalledPrEvaluator);
  registerEvaluator(overreachingEvaluator);

  // In the existing GET handler — after computing the visible-flags list:
  for (const f of visibleFlags) {
    await recordFlagShown({ userId, flag: f.key });   // [FIX-6] key, not flag
  }

  // In the existing POST /dismiss handler — after recordDismissal:
  await recordFlagDismissed({ userId, flag: body.flag });
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/recovery-flag-telemetry.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/recoveryFlagEvents.ts api/src/routes/recoveryFlags.ts api/tests/integration/recovery-flag-telemetry.test.ts
git commit -m "feat(api): register W3 evaluators + recovery_flag_events telemetry"
```

---

### Task 12.5: Scope-gate the existing /api/recovery-flags routes — [FIX-28]

**Files:**
- Modify: `api/src/routes/recoveryFlags.ts` (add `requireScope` to both routes)
- Modify: `api/tests/integration/scope-enforcement.test.ts` (or `api/tests/routes/recoveryFlags.test.ts`)

Security finding: the existing `/api/recovery-flags` GET + `/dismiss` POST use only `requireBearerOrCfAccess` — any bearer with any scope can hit them. W3 adds telemetry writes to these routes, turning the missing scope into a write-amplification vector. Add `requireScope('health:recovery:read')` to both.

- [ ] **Step 1: Add failing scope tests**

```ts
// in api/tests/routes/recoveryFlags.test.ts
it('GET /api/recovery-flags requires health:recovery:read scope (FIX-28)', async () => {
  const noRecovery = await mintBearer({ scopes: ['set_logs:write'] });
  const r = await app.inject({
    method: 'GET', url: '/api/recovery-flags',
    headers: { authorization: `Bearer ${noRecovery}` },
  });
  expect(r.statusCode).toBe(403);
});

it('POST /api/recovery-flags/dismiss requires health:recovery:read scope (FIX-28)', async () => {
  const noRecovery = await mintBearer({ scopes: ['set_logs:write'] });
  const r = await app.inject({
    method: 'POST', url: '/api/recovery-flags/dismiss',
    headers: { authorization: `Bearer ${noRecovery}` },
    payload: { flag: 'overreaching' },
  });
  expect(r.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/recoveryFlags.test.ts
```

Expected: FAIL — routes accept any bearer today.

- [ ] **Step 3: Add the scope gate**

Edit `api/src/routes/recoveryFlags.ts`:

```ts
import { requireScope } from '../middleware/scope.js';

// Both routes:
app.get('/api/recovery-flags', {
  preHandler: [requireBearerOrCfAccess, requireScope('health:recovery:read')],
}, /* ...existing handler... */);

app.post('/api/recovery-flags/dismiss', {
  preHandler: [requireBearerOrCfAccess, requireScope('health:recovery:read')],
}, /* ...existing handler... */);
```

(Scope name uses `:read` even on the dismiss POST because dismiss is a UI action tied to viewing the flag — not a separate write-scope. If you'd rather split into `health:recovery:write`, that's fine, but adds an extra mint-time scope users need.)

- [ ] **Step 4: Existing recoveryFlags route tests need updated bearer mint**

The existing `api/tests/routes/recoveryFlags.test.ts` mints bearers without `health:recovery:read`. Add it to the existing mint payload (around line 35 in that file):

```ts
const mint = await app.inject({
  method: 'POST', url: '/api/tokens',
  body: { user_id: userId, label: 'rf-route-test', scopes: ['health:recovery:read'] },
});
```

- [ ] **Step 5: Run + commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/routes/recoveryFlags.test.ts
git add api/src/routes/recoveryFlags.ts api/tests/routes/recoveryFlags.test.ts
git commit -m "security(api): scope-gate /api/recovery-flags routes (FIX-28)"
```

---

### Task 13: Recovery-flag e2e (overreaching trigger → dismiss → re-dismissed)

**Files:**
- Create: `api/tests/integration/recovery-flag-overreaching-e2e.test.ts`

- [ ] **Step 1: Write the e2e**

```ts
// api/tests/integration/recovery-flag-overreaching-e2e.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { seedUserOverreaching } from '../helpers/seed-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string;

beforeAll(async () => {
  app = await buildApp();
  const seed = await seedUserOverreaching(); userId = seed.userId; token = seed.bearer;
});
afterAll(async () => { await app.close(); });

describe('recovery-flag overreaching e2e', () => {
  it('GET shows overreaching when condition true and not dismissed', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ flags: Array<{ flag: string }> }>().flags.some(f => f.flag === 'overreaching')).toBe(true);
  });

  it('POST /dismiss silences it for the rest of the ISO week', async () => {
    await app.inject({
      method: 'POST', url: '/api/recovery-flags/dismiss',
      headers: { authorization: `Bearer ${token}` },
      payload: { flag: 'overreaching' },
    });
    const r = await app.inject({
      method: 'GET', url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.json<{ flags: Array<{ flag: string }> }>().flags.some(f => f.flag === 'overreaching')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect PASS** (registration + telemetry already shipped)

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/recovery-flag-overreaching-e2e.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 3: Re-enable the it.skip from W1.5**

Open `api/tests/integration/set-logs-to-recovery-flags.test.ts`. Change the existing `it.skip(...)` block to a real assertion:

```ts
it('the /today overreaching toast appears after three RIR-0 logs (W3.1)', async () => {
  // Seed already done in the W1.5 fixture above; re-run /api/recovery-flags
  const app = await build();
  const seed = await seedUserWithMesocycle();
  handles.push(seed);
  // ... POST 3 RIR-0 sets as the existing test does ...
  const flags = await app.inject({
    method: 'GET', url: '/api/recovery-flags',
    headers: { authorization: `Bearer ${seed.bearer}` },
  });
  expect(flags.json<{ flags: Array<{ flag: string }> }>()
    .flags.some(f => f.flag === 'overreaching')).toBe(true);
  await app.close();
});
```

- [ ] **Step 4: Run full suite, expect green**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/
```

Expected: all green, including the previously-skipped test.

- [ ] **Step 5: Commit**

```bash
git add api/tests/integration/recovery-flag-overreaching-e2e.test.ts api/tests/integration/set-logs-to-recovery-flags.test.ts
git commit -m "test(api): W3.1 e2e + re-enable W1.5 it.skip overreaching assertion"
```

---

## Sub-wave W3.2 — Injury-aware ranker

Branch: `beta/w3-clinical-signals/w3.2-ranker`

### Task 14: joint_root helper + injuryRanker (unit)

**Files:**
- Create: `api/src/services/injuryRanker.ts`
- Test: `api/tests/services/injuryRanker.test.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// api/tests/services/injuryRanker.test.ts
import { describe, it, expect } from 'vitest';
import {
  jointRoot,
  applyInjuryAdvisory,
  type RankerCandidate,
} from '../../src/services/injuryRanker.js';

describe('jointRoot', () => {
  it('maps lateralized keys to joint_stress_profile root', () => {
    expect(jointRoot('knee_left')).toBe('knee');
    expect(jointRoot('shoulder_right')).toBe('shoulder');
    expect(jointRoot('low_back')).toBe('lumbar');
    expect(jointRoot('elbow')).toBe('elbow');
    expect(jointRoot('wrist')).toBe('wrist');
  });
});

describe('applyInjuryAdvisory', () => {
  const cands: RankerCandidate[] = [
    { id: 'a', slug: 'leg-press', name: 'Leg Press', score: 500, reason: '',
      joint_stress_profile: { _v: 1, knee: 'low' } },
    { id: 'b', slug: 'back-squat', name: 'Back Squat', score: 480, reason: '',
      joint_stress_profile: { _v: 1, knee: 'high', lumbar: 'mod' } },
    { id: 'c', slug: 'bss', name: 'BSS', score: 400, reason: '',
      joint_stress_profile: { _v: 1, knee: 'mod' } },
  ];

  it('passes through unchanged when no injuries', async () => {
    const out = await applyInjuryAdvisory(cands, []);
    expect(out).toEqual(cands);
  });

  it('penalizes high-load by 300, tags advisory', async () => {
    const out = await applyInjuryAdvisory(cands, ['knee_left']);
    const squat = out.find(c => c.slug === 'back-squat')!;
    expect(squat.score).toBe(180);
    expect(squat.injury_advisory).toEqual({ joint: 'knee_left', level: 'high' });
  });

  it('penalizes mod-load by 150, tags advisory', async () => {
    const out = await applyInjuryAdvisory(cands, ['knee_left']);
    const bss = out.find(c => c.slug === 'bss')!;
    expect(bss.score).toBe(250);
    expect(bss.injury_advisory).toEqual({ joint: 'knee_left', level: 'mod' });
  });

  it('leaves low-load candidates untagged', async () => {
    const out = await applyInjuryAdvisory(cands, ['knee_left']);
    const lp = out.find(c => c.slug === 'leg-press')!;
    expect(lp.score).toBe(500);
    expect(lp.injury_advisory).toBeUndefined();
  });

  it('re-sorts by adjusted score (lp > bss > squat now)', async () => {
    const out = await applyInjuryAdvisory(cands, ['knee_left']);
    expect(out.map(c => c.slug)).toEqual(['leg-press', 'bss', 'back-squat']);
  });

  it('keeps highest-penalty when two injuries match same candidate', async () => {
    const out = await applyInjuryAdvisory(cands, ['knee_left', 'low_back']);
    const squat = out.find(c => c.slug === 'back-squat')!;
    // knee=high(-300) vs lumbar=mod(-150) — keep the higher
    expect(squat.injury_advisory).toEqual({ joint: 'knee_left', level: 'high' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/services/injuryRanker.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// api/src/services/injuryRanker.ts
//
// [FIX-14] Same-root double-injury: deterministic tiebreaker — sort active
//          injuries alphabetically by joint, then pick the highest weighted
//          penalty (stress_penalty × severity_factor). With equal penalty the
//          alphabetically-first joint wins. Documented because the bilateral
//          mapping (knee_left + knee_right → 'knee' root) is intentional
//          given exercise joint_stress_profile carries no laterality data.
// [FIX-15] joint_stress_profile typed precisely: { _v: number } intersection
//          with Partial<Record<root, 'low'|'mod'|'high'>>.
// [FIX-26] Severity is wired into the penalty calc — low=0.5×, mod=1.0×,
//          high=1.5× multiplier on the stress-based base penalty. Resolves
//          the "severity stored but unused" UX-lie finding.
import { db } from '../db/client.js';
import type { InjuryJoint, InjurySeverity } from '../schemas/userInjuries.js';

const JOINT_ROOT: Record<InjuryJoint, string> = {
  // Bilateral mapping is intentional. Exercise joint_stress_profile carries
  // no laterality — both knees take the penalty for a one-sided knee injury.
  // See [[reference_w3_tuning_candidates]] memory for the future sided-stress
  // data exercise. DO NOT "fix" this by laterality-matching alone — back
  // squat (bilateral lift) would silently skip the penalty.
  shoulder_left:  'shoulder',
  shoulder_right: 'shoulder',
  low_back:       'lumbar',
  knee_left:      'knee',
  knee_right:     'knee',
  elbow:          'elbow',
  wrist:          'wrist',
};

const STRESS_PENALTY = { mod: 150, high: 300 } as const;
const SEVERITY_FACTOR: Record<InjurySeverity, number> = {
  low: 0.5, mod: 1.0, high: 1.5,
};

export function jointRoot(joint: InjuryJoint): string {
  return JOINT_ROOT[joint];
}

export type StressLevel = 'low' | 'mod' | 'high';
export type JointStressProfile = { _v: number } & Partial<Record<string, StressLevel>>;

export type RankerCandidate = {
  id: string; slug: string; name: string;
  score: number; reason: string;
  joint_stress_profile: JointStressProfile;
  injury_advisory?: { joint: InjuryJoint; level: 'mod' | 'high' };
};

export type UserInjuryRow = { joint: InjuryJoint; severity: InjurySeverity };

export async function applyInjuryAdvisory(
  candidates: RankerCandidate[],
  userInjuries: UserInjuryRow[],
): Promise<RankerCandidate[]> {
  if (!userInjuries.length) return candidates;
  // [FIX-14] sort alphabetically for deterministic tiebreaker
  const sortedInjuries = [...userInjuries].sort((a, b) => a.joint.localeCompare(b.joint));
  const out = candidates.map((c) => {
    let bestWeighted = 0;
    let bestTag: RankerCandidate['injury_advisory'];
    for (const injury of sortedInjuries) {
      const root = jointRoot(injury.joint);
      const stress = c.joint_stress_profile[root];
      if (stress === 'mod' || stress === 'high') {
        const weighted = STRESS_PENALTY[stress] * SEVERITY_FACTOR[injury.severity];
        if (weighted > bestWeighted) {
          bestWeighted = weighted;
          bestTag = { joint: injury.joint, level: stress };
        }
      }
    }
    return bestWeighted
      ? { ...c, score: Math.round(c.score - bestWeighted), injury_advisory: bestTag }
      : c;
  });
  return out.sort((a, b) => b.score - a.score);
}

export async function fetchUserInjuries(userId: string): Promise<UserInjuryRow[]> {
  const { rows } = await db.query<UserInjuryRow>(
    `SELECT joint, severity FROM user_injuries WHERE user_id = $1`,
    [userId],
  );
  return rows;
}
```

Update Task 14 Step 1 tests to use the new `UserInjuryRow[]` signature:

```ts
// Was: applyInjuryAdvisory(cands, ['knee_left'])
// Now: applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'mod' }])

it('penalizes high-load by 300 × severity-factor, tags advisory', async () => {
  const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'mod' }]);
  const squat = out.find(c => c.slug === 'back-squat')!;
  // stress=high (300) × severity=mod (1.0) = -300
  expect(squat.score).toBe(180);
  expect(squat.injury_advisory).toEqual({ joint: 'knee_left', level: 'high' });
});

it('severity=low halves the penalty (FIX-26)', async () => {
  const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'low' }]);
  const squat = out.find(c => c.slug === 'back-squat')!;
  // 300 × 0.5 = 150 penalty
  expect(squat.score).toBe(330);
});

it('severity=high amplifies penalty (FIX-26)', async () => {
  const out = await applyInjuryAdvisory(cands, [{ joint: 'knee_left', severity: 'high' }]);
  const squat = out.find(c => c.slug === 'back-squat')!;
  // 300 × 1.5 = 450 penalty
  expect(squat.score).toBe(30);
});

// [FIX-14] tiebreaker test
it('same-root double-injury picks alphabetical winner with equal severity', async () => {
  const out = await applyInjuryAdvisory(cands, [
    { joint: 'knee_right', severity: 'mod' },
    { joint: 'knee_left',  severity: 'mod' },
  ]);
  const squat = out.find(c => c.slug === 'back-squat')!;
  // both map to 'knee', equal weight — alphabetical 'knee_left' wins
  expect(squat.injury_advisory?.joint).toBe('knee_left');
});
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/services/injuryRanker.test.ts
```

Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/injuryRanker.ts api/tests/services/injuryRanker.test.ts
git commit -m "feat(api): injuryRanker — joint_root + applyInjuryAdvisory (W3.2)"
```

---

### Task 15: Wire injuryRanker into findSubstitutions + extend exercises schema

**Files:**
- Modify: `api/src/services/substitutions.ts`
- Modify: `api/src/schemas/exercises.ts`
- Modify: `api/src/routes/exercises.ts` (pass `userId` to `findSubstitutions`)
- Test: `api/tests/integration/substitutions-injury.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// api/tests/integration/substitutions-injury.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.w3-sub' }); userId = u.id;
  const m = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 'w3-sub', scopes: ['health:injuries:write'] },
  });
  token = m.json<{ token: string }>().token;
  await db.query(
    `INSERT INTO user_injuries (user_id, joint, severity) VALUES ($1,'knee_left','high')`,
    [userId],
  );
});
afterAll(async () => {
  await db.query(`DELETE FROM user_injuries WHERE user_id=$1`, [userId]);
  await cleanupUser(userId); await app.close();
});

it('demotes knee-stressful candidates and tags injury_advisory', async () => {
  const r = await app.inject({
    method: 'GET',
    url: '/exercises/back-squat/substitutions',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.statusCode).toBe(200);
  const body = r.json<{ subs: Array<{ slug: string; injury_advisory?: { joint: string; level: string } }> }>();
  const squat = body.subs.find((s) => s.slug === 'back-squat');
  expect(squat?.injury_advisory).toEqual({ joint: 'knee_left', level: 'high' });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/substitutions-injury.test.ts
```

Expected: FAIL — `injury_advisory` missing from response.

- [ ] **Step 3: Extend schema + wire ranker**

Edit `api/src/schemas/exercises.ts` to add the optional field on `SubstitutionResponse.subs[]`:

```ts
export const SubstitutionItemSchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(),
  score: z.number(), reason: z.string(),
  injury_advisory: z.object({
    joint: z.enum(INJURY_JOINTS),   // import from userInjuries
    level: z.enum(['mod','high']),
  }).optional(),
});
```

Edit `api/src/services/substitutions.ts` to pipe candidates through the ranker.

[FIX-12] `userId` is **optional** to preserve compatibility with the 3 existing callers: `routes/exercises.ts:70`, `services/getTodayWorkout.ts:101`, and `api/tests/substitutions.test.ts:38-81`. When `userId` is undefined, `applyInjuryAdvisory` is a no-op.

[FIX-13] Extend the candidate SELECT to include `e.joint_stress_profile`.

```ts
import { applyInjuryAdvisory, fetchUserInjuries, type RankerCandidate } from './injuryRanker.js';

export async function findSubstitutions(
  targetSlug: string,
  userEquipmentProfile: Record<string, unknown>,
  userId?: string,        // [FIX-12] optional — undefined = no injury awareness
): Promise<SubResult | null> {
  // ... existing target lookup + early-returns unchanged ...

  // [FIX-13] Extend SELECT to also fetch joint_stress_profile JSONB.
  const { rows: candidates } = await db.query<{
    id: string; slug: string; name: string;
    movement_pattern: string; primary_muscle_id: number;
    required_equipment: { _v: number; requires: PredicateT[] };
    joint_stress_profile: { _v: number } & Partial<Record<string, 'low'|'mod'|'high'>>;
    pattern_score: number; primary_score: number; overlap_score: number;
  }>(
    `SELECT
       e.id, e.slug, e.name, e.movement_pattern, e.primary_muscle_id,
       e.required_equipment, e.joint_stress_profile,    -- NEW
       /* existing scoring subqueries unchanged */
       ...`,
    [/* existing params */],
  );

  // existing equipment-predicate filter + scoring logic produces `subs: SubResult['subs']`.

  // [FIX-12] Apply injury awareness when userId provided
  let finalSubs = subs;
  if (userId) {
    const userInjuries = await fetchUserInjuries(userId);
    if (userInjuries.length) {
      finalSubs = await applyInjuryAdvisory(
        subs.map((s) => ({ ...s, joint_stress_profile: candidatesById[s.id].joint_stress_profile })),
        userInjuries,
      );
    }
  }

  // Existing TRUNCATION + return shape unchanged. The injury_advisory field
  // is only present when the candidate was tagged.
  return { from, subs: finalSubs.slice(0, TRUNCATION), truncated: subs.length > TRUNCATION };
}
```

Update all three callsites:

- `api/src/routes/exercises.ts:70` — pass `req.userId` (already typed): `findSubstitutions(slug, profile, req.userId)`.
- `api/src/services/getTodayWorkout.ts:101` — pass the user id from context: `findSubstitutions(slug, profile, ctx.userId)`.
- `api/tests/substitutions.test.ts:38-81` — no change needed; existing 2-arg calls remain valid because `userId` is optional.

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/integration/substitutions-injury.test.ts && npx tsc --noEmit
```

Expected: 1/1 PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/substitutions.ts api/src/schemas/exercises.ts api/src/routes/exercises.ts api/tests/integration/substitutions-injury.test.ts
git commit -m "feat(api): wire injuryRanker into findSubstitutions + injury_advisory shape (W3.2)"
```

---

## Sub-wave W3.3 — TodayWorkoutMobile entry point

Branch: `beta/w3-clinical-signals/w3.3-entry-point`

### Task 16: BlockOverflowMenu component

**Files:**
- Create: `frontend/src/components/programs/BlockOverflowMenu.tsx`
- Test: `frontend/src/components/programs/BlockOverflowMenu.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/src/components/programs/BlockOverflowMenu.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockOverflowMenu } from './BlockOverflowMenu';

describe('<BlockOverflowMenu>', () => {
  it('renders the trigger button', () => {
    render(<BlockOverflowMenu blockName="Back Squat" onGotATweak={() => {}} />);
    expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument();
  });

  it('opens menu on trigger click', () => {
    render(<BlockOverflowMenu blockName="Back Squat" onGotATweak={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.getByRole('menuitem', { name: /got a tweak/i })).toBeInTheDocument();
  });

  it('calls onGotATweak when "Got a tweak?" clicked', () => {
    const cb = vi.fn();
    render(<BlockOverflowMenu blockName="Back Squat" onGotATweak={cb} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /got a tweak/i }));
    expect(cb).toHaveBeenCalled();
  });

  it('closes on ESC', () => {
    render(<BlockOverflowMenu blockName="Back Squat" onGotATweak={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: /got a tweak/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/BlockOverflowMenu.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

[FIX-18] Use `TOKENS` and `FONTS` from `frontend/src/tokens.ts` instead of hardcoded hexes (matches `SettingsStorage.tsx` pattern).

[FIX-21] Focus the first menuitem on open; return focus to the trigger on close; dismiss on click outside.

```tsx
// frontend/src/components/programs/BlockOverflowMenu.tsx
import { useEffect, useRef, useState } from 'react';
import { TOKENS } from '../../tokens';

export function BlockOverflowMenu({
  blockName,
  onGotATweak,
}: {
  blockName: string;
  onGotATweak: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // [FIX-21] focus on open, return focus on close
  useEffect(() => {
    if (open) {
      firstItemRef.current?.focus();
    } else {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // ESC + click-outside
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current || !triggerRef.current) return;
      const t = e.target as Node;
      if (!menuRef.current.contains(t) && !triggerRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More options for ${blockName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent', border: 0,
          color: 'rgba(255,255,255,0.5)',
          fontSize: 18, padding: '4px 8px', cursor: 'pointer', borderRadius: 4,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, minWidth: 160,
            background: TOKENS.surface,
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: 4, zIndex: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => { onGotATweak(); setOpen(false); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'transparent', border: 0,
              color: TOKENS.accent,
              padding: '8px 12px', fontSize: 13, fontWeight: 600,
              borderRadius: 4, cursor: 'pointer',
            }}
          >
            Got a tweak?
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/BlockOverflowMenu.test.tsx
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/programs/BlockOverflowMenu.tsx frontend/src/components/programs/BlockOverflowMenu.test.tsx
git commit -m "feat(frontend): BlockOverflowMenu — per-block menu (W3.3 Q5)"
```

---

### Task 17: Wire BlockOverflowMenu into TodayWorkoutMobile + open MidSessionSwapSheet

**Files:**
- Modify: `frontend/src/components/programs/TodayWorkoutMobile.tsx`
- Modify: `frontend/src/components/programs/TodayWorkoutMobile.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `TodayWorkoutMobile.test.tsx`:

```tsx
it('opens MidSessionSwapSheet pre-loaded with injury context when "Got a tweak?" is tapped', async () => {
  render(<TodayWorkoutMobile {...defaultProps} />);
  const moreBtns = screen.getAllByRole('button', { name: /more options/i });
  fireEvent.click(moreBtns[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: /got a tweak/i }));
  expect(await screen.findByRole('dialog', { name: /swap/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/TodayWorkoutMobile.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement — mount BlockOverflowMenu per block**

[FIX-10] The existing component groups planned_sets via `Map<number, PlannedSet[]>` keyed by `block_idx` — there is no `Block` object type. Use `pickerTargetBlockIdx: number | null`. Also: an existing `swapTarget` state on this component drives the inline "Suggested sub" flow at the top of the file — DO NOT collide. The new picker state is independent.

Edit `TodayWorkoutMobile.tsx`:

```tsx
// Existing imports + the new ones:
import { BlockOverflowMenu } from './BlockOverflowMenu';
import { MidSessionSwapPicker } from './MidSessionSwapPicker';   // [FIX-9] new component (Task 18)

// Existing state (do not touch):
//   const [swapTarget, setSwapTarget] = useState<...>(null);   // inline-suggestion flow
// New state:
const [pickerTargetBlockIdx, setPickerTargetBlockIdx] = useState<number | null>(null);

// Inside the block render — `blocks` is Map<number, PlannedSet[]> keyed by block_idx.
// For each entry [blockIdx, sets]:
const firstSet = sets[0];                              // exercise info comes from the planned_set
const exerciseName = firstSet.exercise_name;
const exerciseSlug = firstSet.exercise_slug;

// In the block header row (right side):
<BlockOverflowMenu
  blockName={exerciseName}
  onGotATweak={() => setPickerTargetBlockIdx(blockIdx)}
/>

// Outside the block list — render the picker conditionally:
{pickerTargetBlockIdx !== null && (() => {
  const sets = blocks.get(pickerTargetBlockIdx);
  if (!sets) return null;
  return (
    <MidSessionSwapPicker
      plannedSetId={sets[0].id}
      fromName={sets[0].exercise_name}
      fromSlug={sets[0].exercise_slug}
      onClose={(changed) => {
        setPickerTargetBlockIdx(null);
        if (changed) refreshWorkout();          // existing refresh hook
      }}
    />
  );
})()}
```

The picker (Task 18) internally renders the existing `<MidSessionSwapSheet>` as the confirm step.

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/TodayWorkoutMobile.test.tsx
```

Expected: PASS (including the new test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/programs/TodayWorkoutMobile.tsx frontend/src/components/programs/TodayWorkoutMobile.test.tsx
git commit -m "feat(frontend): per-block menu wires 'Got a tweak?' into MidSessionSwapSheet"
```

---

### Task 18: New `<MidSessionSwapPicker>` component — lists candidates + renders advisory copy

**Files:**
- Create: `frontend/src/components/programs/MidSessionSwapPicker.tsx`
- Create: `frontend/src/components/programs/MidSessionSwapPicker.test.tsx`
- Modify: `frontend/src/lib/terms.ts`

[FIX-9] The existing `<MidSessionSwapSheet>` is a single-target **confirm dialog** with props `(plannedSetId, fromName, toId, toName, onClose)` — it does NOT list candidates. Rather than reshape it (which breaks existing callsites), we add a new `<MidSessionSwapPicker>` that:
1. Fetches ranked candidates via `GET /exercises/:slug/substitutions`.
2. Renders the list (with injury advisory copy on tagged rows).
3. On candidate click → opens the existing `<MidSessionSwapSheet>` for confirmation.
4. On sheet `onClose(changed)` → propagates `changed` upward and closes the picker.

This keeps the existing sheet's confirm-affordance intact and additive.

- [ ] **Step 1: Failing tests**

```tsx
// frontend/src/components/programs/MidSessionSwapPicker.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MidSessionSwapPicker } from './MidSessionSwapPicker';
import * as exApi from '../../lib/api/exercises';

vi.mock('../../lib/api/exercises');

const props = {
  plannedSetId: 'ps-1',
  fromName: 'Back Squat',
  fromSlug: 'back-squat',
  onClose: vi.fn(),
};

describe('<MidSessionSwapPicker>', () => {
  it('lists candidates and renders injury_advisory copy on tagged rows', async () => {
    vi.mocked(exApi.getSubstitutions).mockResolvedValueOnce({
      from: { slug: 'back-squat', name: 'Back Squat' },
      subs: [
        { id: 'a', slug: 'leg-press', name: 'Leg Press', score: 500, reason: '' },
        { id: 'b', slug: 'bss', name: 'BSS', score: 250, reason: '',
          injury_advisory: { joint: 'knee_left', level: 'mod' } },
      ],
      truncated: false,
    });
    render(<MidSessionSwapPicker {...props} />);
    await waitFor(() => screen.getByText('Leg Press'));
    expect(screen.getByText(/moderate knee load — you noted left knee/i)).toBeInTheDocument();
    expect(screen.queryByText(/leg press.*knee load/i)).not.toBeInTheDocument();
  });

  it('clicking a demoted candidate opens the confirm sheet (advisory ≠ block)', async () => {
    vi.mocked(exApi.getSubstitutions).mockResolvedValueOnce({
      from: { slug: 'back-squat', name: 'Back Squat' },
      subs: [{ id: 'b', slug: 'bss', name: 'BSS', score: 250, reason: '',
        injury_advisory: { joint: 'knee_left', level: 'high' } }],
      truncated: false,
    });
    render(<MidSessionSwapPicker {...props} />);
    await waitFor(() => screen.getByRole('button', { name: /BSS/i }));
    fireEvent.click(screen.getByRole('button', { name: /BSS/i }));
    expect(await screen.findByRole('dialog', { name: /swap/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/MidSessionSwapPicker.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Edit `frontend/src/lib/terms.ts` to add the copy map + helper:

```ts
// frontend/src/lib/terms.ts (additions — preserve existing exports)
export const INJURY_ADVISORY_COPY: Record<string, Record<'mod'|'high', string>> = {
  shoulder_left:  { mod: 'Moderate shoulder load — you noted left shoulder',  high: 'High shoulder load — you noted left shoulder' },
  shoulder_right: { mod: 'Moderate shoulder load — you noted right shoulder', high: 'High shoulder load — you noted right shoulder' },
  low_back:       { mod: 'Moderate low-back load — you noted low back',       high: 'High low-back load — you noted low back' },
  knee_left:      { mod: 'Moderate knee load — you noted left knee',          high: 'High knee load — you noted left knee' },
  knee_right:     { mod: 'Moderate knee load — you noted right knee',         high: 'High knee load — you noted right knee' },
  elbow:          { mod: 'Moderate elbow load — you noted elbow',             high: 'High elbow load — you noted elbow' },
  wrist:          { mod: 'Moderate wrist load — you noted wrist',             high: 'High wrist load — you noted wrist' },
};

export function injuryAdvisoryCopy(joint: string, level: 'mod'|'high'): string {
  return INJURY_ADVISORY_COPY[joint]?.[level] ?? 'Joint stress on this lift';
}
```

(Note: consistent "High X load" form across all joints — the original draft used "Higher" for knee and "High" elsewhere. Nice-to-have polish folded in.)

```tsx
// frontend/src/components/programs/MidSessionSwapPicker.tsx
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { getSubstitutions, type SubstitutionResponse } from '../../lib/api/exercises';
import { MidSessionSwapSheet } from './MidSessionSwapSheet';
import { injuryAdvisoryCopy } from '../../lib/terms';

export function MidSessionSwapPicker({
  plannedSetId, fromName, fromSlug, onClose,
}: {
  plannedSetId: string;
  fromName: string;
  fromSlug: string;
  onClose: (changed: boolean) => void;
}) {
  const [subs, setSubs] = useState<SubstitutionResponse['subs']>([]);
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await getSubstitutions(fromSlug);
        setSubs(r.subs ?? []);
      } finally { setLoading(false); }
    })();
  }, [fromSlug]);

  if (pick) {
    return (
      <MidSessionSwapSheet
        plannedSetId={plannedSetId}
        fromName={fromName}
        toId={pick.id}
        toName={pick.name}
        onClose={(changed) => { setPick(null); onClose(changed); }}
      />
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="picker-title"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
               display: 'flex', alignItems: 'flex-end', zIndex: 100 }}>
      <div style={{ background: TOKENS.surface, borderRadius: '16px 16px 0 0',
                    padding: 24, width: '100%', maxWidth: 480, margin: '0 auto',
                    color: '#fff', fontFamily: FONTS.ui, maxHeight: '80vh', overflowY: 'auto' }}>
        <h3 id="picker-title" style={{ marginTop: 0, fontSize: 16 }}>Swap {fromName}?</h3>
        {loading && <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Loading…</p>}
        {!loading && subs.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>No alternatives match your equipment.</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {subs.map((s) => (
            <li key={s.id} style={{ marginTop: 8 }}>
              <button type="button"
                onClick={() => setPick({ id: s.id, name: s.name })}
                style={{ width: '100%', textAlign: 'left', background: 'transparent',
                         border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                         padding: 12, color: '#fff', cursor: 'pointer' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                {s.injury_advisory && (
                  <div style={{ color: TOKENS.warn, fontSize: 11, marginTop: 4 }}>
                    ⚠ {injuryAdvisoryCopy(s.injury_advisory.joint, s.injury_advisory.level)}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => onClose(false)}
          style={{ marginTop: 12, padding: '8px 12px', background: 'transparent',
                   border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
                   borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/MidSessionSwapPicker.test.tsx
```

Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/programs/MidSessionSwapPicker.tsx frontend/src/components/programs/MidSessionSwapPicker.test.tsx frontend/src/lib/terms.ts
git commit -m "feat(frontend): MidSessionSwapPicker — candidates list + injury advisory (W3.3 Q4)"
```

---

## Sub-wave W3.4 — Settings injury chips UI

Branch: `beta/w3-clinical-signals/w3.4-settings`

### Task 19: API client `lib/api/userInjuries.ts`

**Files:**
- Create: `frontend/src/lib/api/userInjuries.ts`
- Test: `frontend/src/lib/api/userInjuries.test.ts`

- [ ] **Step 1: Failing test**

```ts
// frontend/src/lib/api/userInjuries.test.ts
//
// [FIX-20] We mock globalThis.fetch directly (rather than vi.mock('./userInjuries'))
// because this IS the api-client layer — we're testing the fetch boundary itself.
// Component-layer tests in InjuryChipsEditor.test.tsx use the project's standard
// vi.mock('../../lib/api/userInjuries') pattern.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listInjuries, upsertInjury, deleteInjury } from './userInjuries';

afterEach(() => vi.restoreAllMocks());

describe('userInjuries client', () => {
  it('listInjuries() GETs /api/user/injuries and returns array', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ injuries: [{ joint: 'knee_left', severity: 'mod', notes: '', onset_at: null, created_at: '', updated_at: '' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const out = await listInjuries();
    expect(out.map(i => i.joint)).toEqual(['knee_left']);
    expect(fetchSpy).toHaveBeenCalledWith('/api/user/injuries', expect.objectContaining({ method: 'GET' }));
  });

  it('upsertInjury POSTs payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ injury: { joint: 'wrist', severity: 'low', notes: '', onset_at: null, created_at: '', updated_at: '' } }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ));
    const r = await upsertInjury({ joint: 'wrist', severity: 'low' });
    expect(r.joint).toBe('wrist');
  });

  it('deleteInjury DELETEs and returns void', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteInjury('elbow');
    expect(fetchSpy).toHaveBeenCalledWith('/api/user/injuries/elbow', expect.objectContaining({ method: 'DELETE' }));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/api/userInjuries.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement client**

```ts
// frontend/src/lib/api/userInjuries.ts
export type InjuryJoint = 'shoulder_left'|'shoulder_right'|'low_back'|'knee_left'|'knee_right'|'elbow'|'wrist';
export type InjurySeverity = 'low'|'mod'|'high';

export type UserInjury = {
  joint: InjuryJoint;
  severity: InjurySeverity;
  notes: string;
  onset_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listInjuries(): Promise<UserInjury[]> {
  const r = await fetch('/api/user/injuries', { method: 'GET', credentials: 'include' });
  if (!r.ok) throw new Error(`listInjuries: ${r.status}`);
  const body = await r.json() as { injuries: UserInjury[] };
  return body.injuries;
}

export async function upsertInjury(payload: {
  joint: InjuryJoint;
  severity?: InjurySeverity;
  notes?: string;
  onset_at?: string | null;
}): Promise<UserInjury> {
  const r = await fetch('/api/user/injuries', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`upsertInjury: ${r.status}`);
  const body = await r.json() as { injury: UserInjury };
  return body.injury;
}

export async function patchInjury(joint: InjuryJoint, patch: {
  severity?: InjurySeverity; notes?: string; onset_at?: string | null;
}): Promise<UserInjury> {
  const r = await fetch(`/api/user/injuries/${joint}`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`patchInjury: ${r.status}`);
  const body = await r.json() as { injury: UserInjury };
  return body.injury;
}

export async function deleteInjury(joint: InjuryJoint): Promise<void> {
  const r = await fetch(`/api/user/injuries/${joint}`, {
    method: 'DELETE', credentials: 'include',
  });
  if (!r.ok && r.status !== 204) throw new Error(`deleteInjury: ${r.status}`);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/api/userInjuries.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/userInjuries.ts frontend/src/lib/api/userInjuries.test.ts
git commit -m "feat(frontend): lib/api/userInjuries CRUD client (W3.4)"
```

---

### Task 20: InjuryChipsEditor — chip grid + toggle (basic CRUD)

**Files:**
- Create: `frontend/src/components/settings/InjuryChipsEditor.tsx`
- Test: `frontend/src/components/settings/InjuryChipsEditor.test.tsx`

- [ ] **Step 1: Failing test (chip toggle behavior only)**

```tsx
// frontend/src/components/settings/InjuryChipsEditor.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { InjuryChipsEditor } from './InjuryChipsEditor';
import * as api from '../../lib/api/userInjuries';

vi.mock('../../lib/api/userInjuries');

describe('<InjuryChipsEditor>', () => {
  it('renders all 7 chip labels', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([]);
    render(<InjuryChipsEditor />);
    await waitFor(() => expect(screen.getByText('shoulder_left')).toBeInTheDocument());
    expect(screen.getByText('shoulder_right')).toBeInTheDocument();
    expect(screen.getByText('low_back')).toBeInTheDocument();
    expect(screen.getByText('knee_left')).toBeInTheDocument();
    expect(screen.getByText('knee_right')).toBeInTheDocument();
    expect(screen.getByText('elbow')).toBeInTheDocument();
    expect(screen.getByText('wrist')).toBeInTheDocument();
  });

  it('toggling an inactive chip calls upsertInjury', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([]);
    vi.mocked(api.upsertInjury).mockResolvedValueOnce({
      joint: 'knee_left', severity: 'mod', notes: '', onset_at: null,
      created_at: '', updated_at: '',
    });
    render(<InjuryChipsEditor />);
    await waitFor(() => screen.getByText('knee_left'));
    fireEvent.click(screen.getByRole('button', { name: /knee_left/i }));
    await waitFor(() =>
      expect(api.upsertInjury).toHaveBeenCalledWith({ joint: 'knee_left' }),
    );
  });

  it('toggling an active chip calls deleteInjury', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([{
      joint: 'wrist', severity: 'mod', notes: '', onset_at: null,
      created_at: '', updated_at: '',
    }]);
    vi.mocked(api.deleteInjury).mockResolvedValueOnce();
    render(<InjuryChipsEditor />);
    await waitFor(() => screen.getByText('wrist'));
    fireEvent.click(screen.getByRole('button', { name: /wrist/i }));
    await waitFor(() => expect(api.deleteInjury).toHaveBeenCalledWith('wrist'));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/settings/InjuryChipsEditor.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement chip-toggle skeleton (without expanded panel yet)**

```tsx
// frontend/src/components/settings/InjuryChipsEditor.tsx
import { useEffect, useState } from 'react';
import {
  listInjuries, upsertInjury, deleteInjury,
  type UserInjury, type InjuryJoint,
} from '../../lib/api/userInjuries';

const CHIPS: InjuryJoint[] = [
  'shoulder_left','shoulder_right','low_back',
  'knee_left','knee_right','elbow','wrist',
];

export function InjuryChipsEditor() {
  const [items, setItems] = useState<UserInjury[]>([]);
  const [pending, setPending] = useState<Set<InjuryJoint>>(new Set());

  useEffect(() => { listInjuries().then(setItems); }, []);

  function isActive(j: InjuryJoint) { return items.some(i => i.joint === j); }

  async function toggle(j: InjuryJoint) {
    if (pending.has(j)) return;
    setPending(p => new Set(p).add(j));
    try {
      if (isActive(j)) {
        await deleteInjury(j);
        setItems(prev => prev.filter(i => i.joint !== j));
      } else {
        const created = await upsertInjury({ joint: j });
        setItems(prev => [...prev, created]);
      }
    } finally {
      setPending(p => { const n = new Set(p); n.delete(j); return n; });
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {CHIPS.map(j => {
        const active = isActive(j);
        return (
          <button
            key={j}
            type="button"
            aria-pressed={active}
            disabled={pending.has(j)}
            onClick={() => toggle(j)}
            style={{
              padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
              cursor: pending.has(j) ? 'wait' : 'pointer',
              background: active ? '#4D8DFF' : 'transparent',
              color: active ? '#0A0D12' : '#fff',
              border: `1px solid ${active ? '#4D8DFF' : 'rgba(255,255,255,0.2)'}`,
            }}
          >
            {j}{active ? ' ✓' : ''}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/settings/InjuryChipsEditor.test.tsx
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/InjuryChipsEditor.tsx frontend/src/components/settings/InjuryChipsEditor.test.tsx
git commit -m "feat(frontend): InjuryChipsEditor — chip grid + toggle (W3.4 Q3 base)"
```

---

### Task 21: InjuryChipsEditor — expanded per-row panel

**Files:**
- Modify: `frontend/src/components/settings/InjuryChipsEditor.tsx`
- Modify: `frontend/src/components/settings/InjuryChipsEditor.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
it('clicking an active chip expands a panel with severity + notes + onset', async () => {
  vi.mocked(api.listInjuries).mockResolvedValueOnce([{
    joint: 'knee_left', severity: 'mod', notes: 'meniscus', onset_at: '2026-02-15',
    created_at: '', updated_at: '',
  }]);
  render(<InjuryChipsEditor />);
  await waitFor(() => screen.getByText(/knee_left/));
  // First click toggles, second click expands. Adjust UX: expand-on-active.
  fireEvent.click(screen.getByRole('button', { name: /knee_left/i }));
  expect(screen.getByDisplayValue('meniscus')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /mod/i, pressed: true })).toBeInTheDocument();
});

it('editing severity calls patchInjury', async () => {
  vi.mocked(api.listInjuries).mockResolvedValueOnce([{
    joint: 'knee_left', severity: 'mod', notes: '', onset_at: null,
    created_at: '', updated_at: '',
  }]);
  vi.mocked(api.patchInjury).mockResolvedValueOnce({
    joint: 'knee_left', severity: 'high', notes: '', onset_at: null,
    created_at: '', updated_at: '',
  });
  render(<InjuryChipsEditor />);
  await waitFor(() => screen.getByText(/knee_left/));
  fireEvent.click(screen.getByRole('button', { name: /knee_left/i })); // expand
  // [FIX-23] scope the severity-button query to the expanded panel to avoid
  // any future collision with chip labels containing "high".
  const panel = screen.getByRole('region', { name: /knee_left/i });
  fireEvent.click(within(panel).getByRole('button', { name: 'high' }));
  await waitFor(() =>
    expect(api.patchInjury).toHaveBeenCalledWith('knee_left', { severity: 'high' }),
  );
});

// [FIX-19] rollback path
it('reverts chip state and surfaces error when PATCH fails', async () => {
  vi.mocked(api.listInjuries).mockResolvedValueOnce([{
    joint: 'wrist', severity: 'mod', notes: '', onset_at: null,
    created_at: '', updated_at: '',
  }]);
  vi.mocked(api.patchInjury).mockRejectedValueOnce(new Error('500 server'));
  render(<InjuryChipsEditor />);
  await waitFor(() => screen.getByText(/wrist/));
  fireEvent.click(screen.getByRole('button', { name: /wrist/i }));
  const panel = screen.getByRole('region', { name: /wrist/i });
  fireEvent.click(within(panel).getByRole('button', { name: 'high' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  // severity stayed at 'mod' (the prior value)
  expect(within(panel).getByRole('button', { name: 'mod', pressed: true })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/settings/InjuryChipsEditor.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Re-implement with two-mode chips (toggle to activate, click again to expand)**

Update `InjuryChipsEditor.tsx`. State change: track `expanded: InjuryJoint | null`. Active-chip click expands the row instead of deactivating; deactivation moves to an explicit "Remove" button inside the expanded panel.

```tsx
// (replace prior file)
import { useEffect, useState } from 'react';
import { TOKENS } from '../../tokens';   // [FIX-18]
import {
  listInjuries, upsertInjury, patchInjury, deleteInjury,
  type UserInjury, type InjuryJoint, type InjurySeverity,
} from '../../lib/api/userInjuries';

const CHIPS: InjuryJoint[] = [
  'shoulder_left','shoulder_right','low_back',
  'knee_left','knee_right','elbow','wrist',
];
const SEVERITIES: InjurySeverity[] = ['low','mod','high'];

export function InjuryChipsEditor() {
  const [items, setItems] = useState<UserInjury[]>([]);
  const [expanded, setExpanded] = useState<InjuryJoint | null>(null);
  const [pending, setPending] = useState<Set<InjuryJoint>>(new Set());
  const [error, setError] = useState<string | null>(null);   // [FIX-19] rollback surface

  useEffect(() => { listInjuries().then(setItems); }, []);

  function isActive(j: InjuryJoint) { return items.some(i => i.joint === j); }
  function find(j: InjuryJoint) { return items.find(i => i.joint === j); }

  async function tap(j: InjuryJoint) {
    if (pending.has(j)) return;
    if (!isActive(j)) {
      // Inactive → activate
      setPending(p => new Set(p).add(j));
      try {
        const created = await upsertInjury({ joint: j });
        setItems(prev => [...prev, created]);
        setExpanded(j);
      } finally {
        setPending(p => { const n = new Set(p); n.delete(j); return n; });
      }
    } else {
      // Active → toggle the expanded panel
      setExpanded(prev => prev === j ? null : j);
    }
  }

  // [FIX-19] Optimistic update + rollback on error. Pattern: capture prior,
  // set new locally, call API, on failure restore prior and surface error.
  async function patchWithRollback(
    j: InjuryJoint,
    patch: { severity?: InjurySeverity; notes?: string; onset_at?: string | null },
  ) {
    const prior = items.find((i) => i.joint === j);
    if (!prior) return;
    const optimistic: UserInjury = { ...prior, ...patch };
    setItems((prev) => prev.map((i) => (i.joint === j ? optimistic : i)));
    try {
      const updated = await patchInjury(j, patch);
      setItems((prev) => prev.map((i) => (i.joint === j ? updated : i)));
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.joint === j ? prior : i)));
      setError(err instanceof Error ? err.message : 'Save failed — change reverted');
    }
  }

  const updateSeverity = (j: InjuryJoint, severity: InjurySeverity) => patchWithRollback(j, { severity });
  const updateNotes    = (j: InjuryJoint, notes: string)            => patchWithRollback(j, { notes });
  const updateOnset    = (j: InjuryJoint, onset_at: string | null)  => patchWithRollback(j, { onset_at });

  async function remove(j: InjuryJoint) {
    await deleteInjury(j);
    setItems(prev => prev.filter(i => i.joint !== j));
    setExpanded(null);
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {CHIPS.map(j => {
          const active = isActive(j);
          return (
            <button
              key={j}
              id={`injury-chip-${j}`}      // [FIX-22] target for panel aria-labelledby
              type="button"
              aria-pressed={active}
              aria-expanded={expanded === j}
              aria-controls={active ? `injury-panel-${j}` : undefined}
              disabled={pending.has(j)}
              onClick={() => tap(j)}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
                background: active ? TOKENS.accent : 'transparent',
                color: active ? TOKENS.bg : '#fff',
                border: `1px solid ${active ? TOKENS.accent : 'rgba(255,255,255,0.2)'}`,
              }}
            >
              {j}{active ? ' ✓' : ''}
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" style={{
          marginTop: 8, padding: 8, borderRadius: 4,
          background: 'rgba(255,106,106,0.1)', color: '#FF6A6A', fontSize: 12,
        }}>{error}</div>
      )}
      {expanded && (() => {
        const item = find(expanded);
        if (!item) return null;
        const panelId = `injury-panel-${expanded}`;
        const chipId = `injury-chip-${expanded}`;
        return (
          // [FIX-22] role=region + aria-labelledby pointing to the chip
          <section
            id={panelId}
            role="region"
            aria-labelledby={chipId}
            style={{
              marginTop: 12, padding: 12, borderRadius: 8,
              background: 'rgba(77,141,255,0.08)', borderLeft: `2px solid ${TOKENS.accent}`,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{item.joint}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {SEVERITIES.map(s => {
                // [FIX nice-12] Severity is a user classification, not a status.
                // CLAUDE.md reserves `good` (green) for "verified API success".
                // Use accent (low) / warn (mod) / danger (high) — keeps the
                // visual urgency gradient without misusing the "good" semantic.
                const activeBg = s === 'low' ? TOKENS.accent : s === 'mod' ? TOKENS.warn : TOKENS.danger;
                return (
                  <button
                    key={s} type="button"
                    aria-pressed={item.severity === s}
                    onClick={() => updateSeverity(item.joint, s)}
                    style={{
                      padding: '4px 10px', fontSize: 12, fontWeight: 600,
                      background: item.severity === s ? activeBg : 'rgba(255,255,255,0.05)',
                      color: item.severity === s ? TOKENS.bg : '#fff',
                      border: 0, borderRadius: 4, cursor: 'pointer',
                    }}
                  >{s}</button>
                );
              })}
            </div>
            <input
              defaultValue={item.notes}
              placeholder="Notes (optional)"
              onBlur={(e) => updateNotes(item.joint, e.target.value)}
              style={{ width: '100%', background: '#10141C', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: 6, borderRadius: 4, fontSize: 12 }}
            />
            <input
              type="date"
              defaultValue={item.onset_at ?? ''}
              onBlur={(e) => updateOnset(item.joint, e.target.value || null)}
              style={{ marginTop: 6, background: '#10141C', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: 4, borderRadius: 4, fontSize: 12 }}
            />
            <button
              type="button"
              onClick={() => remove(item.joint)}
              style={{ marginTop: 8, padding: '4px 10px', background: 'transparent', border: `1px solid ${TOKENS.danger}`, color: TOKENS.danger, borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
            >Remove</button>
          </section>
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/settings/InjuryChipsEditor.test.tsx
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/InjuryChipsEditor.tsx frontend/src/components/settings/InjuryChipsEditor.test.tsx
git commit -m "feat(frontend): InjuryChipsEditor expanded panel — severity/notes/onset (W3.4)"
```

---

### Task 22: /settings/injuries page + nav link

**Files:**
- Create: `frontend/src/pages/SettingsInjuriesPage.tsx`
- Modify: `frontend/src/App.tsx` (router file — see `App.tsx:39-58` for the existing route table)
- Modify: `frontend/src/components/layout/Sidebar.tsx` (FIX-11 — the actual Settings sub-nav lives at lines 35-40 in the `SETTINGS_SUB` const, not `SettingsNav.tsx`)

- [ ] **Step 1: Failing route reachability test**

```ts
// frontend/tests/routing/settings-injuries-reachability.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../src/App';

describe('reachability: /settings/injuries', () => {
  it('renders the page at /settings/injuries', () => {
    render(<MemoryRouter initialEntries={['/settings/injuries']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /injuries/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run tests/routing/settings-injuries-reachability.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create page + register route + link from Sidebar (FIX-11)**

```tsx
// frontend/src/pages/SettingsInjuriesPage.tsx
import { FONTS } from '../tokens';
import { InjuryChipsEditor } from '../components/settings/InjuryChipsEditor';

export default function SettingsInjuriesPage() {
  return (
    <main style={{ padding: 16, color: '#fff', fontFamily: FONTS.ui }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Injuries</h1>
      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 16 }}>
        Tap a chip to mark a joint. Active chips demote (but never block) load-bearing exercises during workouts.
      </p>
      <InjuryChipsEditor />
    </main>
  );
}
```

Register the route in `frontend/src/App.tsx` alongside the other settings routes (follow the W1.3.8 `/settings/storage` precedent):

```tsx
<Route path="/settings/injuries" element={<SettingsInjuriesPage/>} />
```

Add the nav entry in `frontend/src/components/layout/Sidebar.tsx` to the `SETTINGS_SUB` const (around line 35-40):

```ts
const SETTINGS_SUB = [
  // ...existing entries (e.g. 'Units & equipment', 'Storage')...
  { label: 'Injuries', to: '/settings/injuries' },
];
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run tests/routing/settings-injuries-reachability.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SettingsInjuriesPage.tsx frontend/src/App.tsx frontend/tests/routing/settings-injuries-reachability.test.tsx
git commit -m "feat(frontend): /settings/injuries page + Settings nav link (W3.4 G7)"
```

---

# Phase 2 close — merge each sub-wave back to `beta/w3-clinical-signals`

For each sub-wave branch (`w3.1-evaluators`, `w3.2-ranker`, `w3.3-entry-point`, `w3.4-settings`), in dependency order:

- [ ] Run `npx tsc --noEmit && npm test` on each side that the branch touched.
- [ ] Merge to `beta/w3-clinical-signals` (no rebase — preserve sub-wave history).
- [ ] On the integrated branch, run the full test suite again to catch cross-sub-wave conflicts.

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit && npm test
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx tsc --noEmit && npm test
```

Expected: clean. If anything is red, the sub-wave merge that introduced the conflict needs a follow-up commit on `beta/w3-clinical-signals` directly.

---

# Phase 3 — Wave-completion (serial)

## Task 23: Playwright e2e — full injury swap flow

**Files:**
- Create: `tests/e2e/w3-injury-swap-flow.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/w3-injury-swap-flow.spec.ts
/**
 * W3 acceptance — full injury-swap flow against the dev server.
 * Asserts: add chip in settings → see demoted candidate in mid-session swap →
 *          click-through demoted candidate succeeds (advisory ≠ block).
 */
import { test, expect } from '@playwright/test';

test('inj-swap: chip → today → swap → demoted candidate click-through', async ({ page }) => {
  // 1. Sign in (CF Access bypass via test-mode header; see existing e2e for pattern)
  await page.goto('/');

  // 2. Add knee_left chip
  await page.goto('/settings/injuries');
  await page.getByRole('button', { name: /^knee_left$/i }).click();
  await expect(page.getByRole('button', { name: /knee_left ✓/i })).toBeVisible();

  // 3. Navigate to today's workout (use the test-fixture mesocycle with a squat block)
  await page.goto('/today');
  const todayLink = page.getByRole('link', { name: /log workout/i }).first();
  await todayLink.click();

  // 4. Open per-block menu on the squat block
  const moreBtn = page.getByRole('button', { name: /more options for back squat/i });
  await moreBtn.click();
  await page.getByRole('menuitem', { name: /got a tweak/i }).click();

  // 5. Assert swap sheet is open and back-squat itself shows the advisory
  const sheet = page.getByRole('dialog', { name: /swap/i });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/higher knee load — you noted left knee/i)).toBeVisible();

  // 6. Click-through on a demoted candidate (the master-plan acceptance bullet)
  await sheet.getByRole('button', { name: /back squat/i }).click();
  // Sheet closes, no error toast — substitution succeeded
  await expect(sheet).not.toBeVisible();
  await expect(page.getByText(/swap failed/i)).not.toBeVisible();
});
```

- [ ] **Step 2: Run the spec**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx playwright test ../tests/e2e/w3-injury-swap-flow.spec.ts
```

Expected: PASS. If the test-mode auth bypass differs from the W1 pattern, copy the W1.3.6 e2e auth setup into this spec.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/w3-injury-swap-flow.spec.ts
git commit -m "test(e2e): W3 injury-swap full flow"
```

---

## Task 24: Reachability audit (G7)

- [ ] **Step 1: Manually walk the click-paths**

In a local browser:

1. From `/` → click "Settings" → click "Injuries" → arrive at `/settings/injuries`. **Count: 2 clicks. ✓**
2. From `/` → click into today's program → tap "..." on a block → tap "Got a tweak?". **Count: 3 clicks. ✓**

Document both paths in `docs/qa/beta-reachability.md` (extend the existing G7-tracking doc).

- [ ] **Step 2: Commit**

```bash
git add docs/qa/beta-reachability.md
git commit -m "docs(qa): document W3 reachability paths (G7)"
```

---

## Task 25: Wave-complete tsc + test sweep

- [ ] **Step 1: Run full suite on both sides**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit && npm test && \
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx tsc --noEmit && npm test
```

Expected: clean. Address any reds before reviewer matrix.

- [ ] **Step 2: No commit needed unless suites surfaced cleanup work.**

---

## Task 26: Reviewer-matrix dispatch (parallel agents)

Dispatch all four reviewers in parallel via a single message with four `Agent` tool calls. Each agent gets a copy of the spec and the integrated branch diff.

**Prompts (skeleton — fill in branch SHA + spec path before dispatch):**

- **Backend reviewer** (subagent_type: claude) — "Review the W3 backend diff on branch `beta/w3-clinical-signals`. Focus: SQL injection in raw queries (Task 5/6/7/8), evaluator correctness (Tasks 10–13), injuryRanker score-math edge cases, schema CHECK constraints. Categorize findings as Critical / Important / Nice-to-have. Spec: docs/superpowers/specs/2026-05-22-W3-clinical-signals-design.md."
- **Frontend reviewer** (subagent_type: claude) — "Review the W3 frontend diff on `beta/w3-clinical-signals`. Focus: a11y (aria-expanded, focus management on menu/sheet), optimistic-update rollback paths, design-token compliance, terms.ts copy precision. Same severity tiers."
- **Clinical reviewer** (subagent_type: claude) — "Review the W3 evaluator thresholds and advisory copy against the master plan + Engineering Handoff.md clinical guidance. Focus: overreaching false-positive risk, stalled-PR false-negative risk, advisory copy not exposing user-typed notes (NIT line 617), penalty magnitudes (150/300) vs candidate score gaps."
- **Security reviewer** (subagent_type: claude) — "Review the W3 diff for: bearer-scope coverage on new routes, CSRF posture on POST/PATCH/DELETE, raw-note exfiltration paths (must never leak via injury_advisory copy), contamination-test coverage. Same severity tiers."

Wait for all four. Aggregate findings.

- [ ] **Step 3: Apply Critical + Important findings inline**

Per [[feedback_ship_clean]]: every Critical + Important closes before merge. Nice-to-have only deferred with explicit user approval. Each finding-fix is its own commit:

```bash
git commit -m "fix(api): W3 reviewer Critical — <specific finding>"
```

- [ ] **Step 4: Final tsc + test sweep**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx tsc --noEmit && npm test && \
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx tsc --noEmit && npm test
```

Expected: clean.

---

## Task 27: Wave-complete summary + merge approval

- [ ] **Step 1: Present "Wave 3 Complete" summary to user**

In chat, post:
- Branches merged into `beta/w3-clinical-signals`: list each sub-wave.
- Reviewer findings landed: count per tier (Critical / Important / Nice-to-have).
- Test counts: API `<N>`, Frontend `<N>`, e2e `<N>`. Compare to pre-W3 baseline.
- Plan deviations: any place reality forced a change from the spec (link to the inline plan edit).
- G-gate flips: G2 (4 contamination tests added), G7 (reachability documented), G3 (new e2e spec).

Ask: **"OK to merge to `main`?"**

- [ ] **Step 2: On explicit user approval — merge to main**

```bash
git checkout main && git pull
git merge --no-ff beta/w3-clinical-signals -m "Merge W3 — clinical signals + injury swap"
git push origin main
git push origin --delete beta/w3-clinical-signals
git branch -D beta/w3-clinical-signals
```

- [ ] **Step 3: Update the live dashboard**

Edit `docs/superpowers/goals/beta.md`:
- Flip W3 row from `[ ]` → `[x]`.
- Flip G2 status if contamination matrix now meets the ≥35-route threshold (verify).
- Flip G7 status to `[~]` partial (W3 closes its surfaces; full audit happens in W8.8).
- Refresh **Next dispatch** — point at W4 (now serial since W3 closed), with W2/W5/W6 still parallel-eligible.
- Bump **Last updated** to today's date.

```bash
git add docs/superpowers/goals/beta.md
git commit -m "docs(goals): W3 merged — refresh dashboard + next dispatch"
git push origin main
```

---

# Self-review checklist (run by the plan author + 4 specialist reviewers)

- ✅ **Spec coverage** — every locked decision Q1–Q7 + every master-plan §W3 acceptance bullet has a task. Q1→Task 11; Q2→Tasks 1,3,5–8; Q3→Tasks 20,21; Q4→Tasks 14,15,18; Q5→Tasks 16,17; Q6→Tasks 12,13; Q7→Tasks 1,3.
- ✅ **No placeholders** — every step contains real code or a real command + expected output.
- ✅ **Type consistency** — `InjuryJoint`, `UserInjury`, `UserInjuryRow` (with severity), `RankerCandidate`, `JointStressProfile` (FIX-15), `injury_advisory: { joint, level }`, `recovery_flag_events.event_type ∈ {'shown','dismissed'}` consistent across server schemas, services, route tests, frontend types, and component contracts. `EvaluatedFlag` uses `key` (not `flag`) per FIX-6.
- ✅ **Test code is real**, not "write tests for the above."
- ✅ **Reviewer findings applied** — all 11 Critical + 19 Important findings from the backend / frontend / clinical / security review pass land inline (see "Reviewer findings applied" table at the top). 9 Nice-to-have findings deferred to `[[reference_w3_tuning_candidates]]` memory post-merge.
- ✅ **Codebase accuracy verified** — set_logs columns (`performed_load_lbs`, `performed_reps`, no `mesocycle_run_id`), `computeVolumeRollup(runId)` signature, `RecoveryFlagEvaluator` interface, `set_updated_at` non-existence, `requireScope` path, `VALID_SCOPES` tuple location, `MidSessionSwapSheet` existing prop shape, `Sidebar.tsx` Settings nav location, and `frontend/src/tokens.ts` design tokens all match the live codebase.

---

# Reviewer-matrix footer (Phase 3 dispatch reference)

For Task 26 dispatch. Each reviewer is a parallel `Agent` invocation with subagent_type `claude`.

| Reviewer | Focus | Spec anchor |
|----------|-------|-------------|
| **Backend** | SQL injection in raw queries, evaluator correctness, ranker score-math edge cases, CHECK constraints, migration shape | Spec §Components (server rows), §Error handling |
| **Frontend** | a11y (aria-expanded, focus mgmt), optimistic-update rollback, design tokens, terms.ts copy | Spec §Components (frontend rows), §Data flow B |
| **Clinical** | Overreaching false-positive risk, stalled-PR false-negative, advisory-copy non-exposure of raw notes (NIT line 617), penalty magnitudes vs score gaps | Spec Q1, Q1b, Penalty tuning rationale, NIT line 617 |
| **Security** | Bearer-scope coverage, CSRF on writes, raw-note exfiltration paths, contamination coverage | Spec §Error handling auth row, Task 9 |
