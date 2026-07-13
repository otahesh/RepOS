# Measurement Model (holds + cardio logging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-class duration-based exercises (isometric holds, timed carries) and a cardio completion path, replacing the reps-only assumption that has Side Plank prescribed as "8–15 reps."

**Architecture:** A 2-value `exercises.measurement` discriminator (`'reps'|'duration'`) with load staying orthogonal; sparse additive columns on `planned_sets` (`target_duration_low_sec/high_sec`) and `set_logs` (`performed_duration_sec`). **Render mode derives from the planned row's populated targets, never from `exercises.measurement`** — this keeps the in-flight production mesocycle rendering its old reps-targeted side-plank rows correctly (design decision N1; no retro-migration, run-snapshot invariant preserved). Cardio is a different dimension (minutes/week, session grain) and gets its own `cardio_logs` table in phase 2. Effort is ONE unit end-to-end: proximity-to-failure stored in `target_rir`/`performed_rir`; duration sets *display* RPE = 10 − RIR via a single conversion seam.

**Tech Stack:** Fastify 5 + zod + pg (api/), Vite + React 18 + Dexie (frontend/), additive-first SQL migrations (band 090), Vitest + Playwright.

**Design authority:** `~/.claude/jobs/3496544e/tmp/measurement-model-final-v2.md` (approved 2026-07-12) — three-specialist adversarial review, all verdicts incorporated. Referenced below as [v2 §fix-N].

**Delivery: 6 stacked PRs, each independently green against the 8 required checks:**

| PR | Contents | Migrations |
|---|---|---|
| PR1 | Additive migrations + seeds + materializer/manualDeload/substitution column lists + API schemas NULL-tolerant + stalled-PR guard | 090, 091 |
| PR2 | `DROP NOT NULL` on `target_reps_low/high` + XOR CHECK — **destructive, needs `Dry-run:` link in PR body** (D10 gate) | 092 |
| PR3 | Logger UI: duration mode, hold timer, effort seam, offline pipeline | — |
| PR4 | History/display formatters, effort cue + tooltips, e2e `_helpers` + duration offline spec | — |
| PR5 | `cardio_logs` table + CRUD routes + today-view `logged` | 093 |
| PR6 | Inline cardio logging UI + hold Best-Time PR (recap) + "new best hold" toast | — |

**Stacked-PR discipline (memory `feedback_stacked_pr_retarget`):** each branch bases on the previous; after each merge, retarget the next PR's base to `main` and verify `main` contains the previous PR before trusting "merged."

**Rollback-skew hazard (PR2 body, next to the Dry-run link):** a client shipping PR3 UI against a rolled-back pre-PR1 API would have `duration_sec` silently stripped by non-strict zod and the hold marked synced with no data. The PR1 `.refine` (at-least-one-of reps/duration_sec) makes the old-API-new-client case a 400 (row stays pending) once PR1 is deployed; never roll back past PR1 after PR3 deploys.

---

## PR1 — Additive foundation

### Task 1: Migration 090 — `exercises.measurement`

**Files:**
- Create: `api/src/db/migrations/090_exercises_measurement.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Measurement model (2026-07-12 design, docs/superpowers/plans/2026-07-12-measurement-model.md).
-- 'reps'     — discrete contraction cycles (dynamic work, external load or bodyweight).
-- 'duration' — unbroken time under load (isometric holds, time-prescribed carries).
-- Cardio is deliberately NOT in this enum: its dimension is minutes/week at
-- session grain (Q15) and it lives in planned_cardio_blocks / cardio_logs.
-- INVARIANT: measurement drives materialization, seeds, and substitution
-- filtering ONLY. Rendering of an already-materialized planned_sets row keys
-- on which target columns are populated — never on this column — so rows
-- materialized before an exercise was reclassified keep rendering correctly.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS measurement TEXT NOT NULL DEFAULT 'reps'
  CONSTRAINT exercises_measurement_check CHECK (measurement IN ('reps','duration'));
```

- [ ] **Step 2: Run migrations against the local test DB**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate`
Expected: `090_exercises_measurement.sql applied` (or equivalent runner output), exit 0.

- [ ] **Step 3: Verify the guard**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && psql postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test -c "INSERT INTO exercises (slug,name,primary_muscle_id,movement_pattern,peak_tension_length,skill_complexity,loading_demand,systemic_fatigue,measurement) VALUES ('x-test-meas','X',1,'carry','mid',1,1,1,'minutes')" 2>&1 | grep -o 'exercises_measurement_check'`
Expected: `exercises_measurement_check` (CHECK rejects unknown value). No row inserted.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
git add api/src/db/migrations/090_exercises_measurement.sql
git commit -m "feat(api): exercises.measurement discriminator (reps|duration)"
```

### Task 2: Migration 091 — duration columns on `planned_sets` + `set_logs`

**Files:**
- Create: `api/src/db/migrations/091_duration_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Duration targets (prescription) + performed duration (log). Sparse additive
-- columns per the measurement-model design: reps and duration are two units of
-- the same set concept, so they share planned_sets/set_logs.
-- The reps↔duration XOR CHECK lands in 092 together with DROP NOT NULL on
-- target_reps_* (a duration row needs NULL reps, impossible before 092).
ALTER TABLE planned_sets
  ADD COLUMN IF NOT EXISTS target_duration_low_sec  SMALLINT,
  ADD COLUMN IF NOT EXISTS target_duration_high_sec SMALLINT,
  ADD CONSTRAINT planned_sets_duration_range_check
    CHECK (target_duration_low_sec IS NULL OR target_duration_high_sec IS NULL
           OR target_duration_low_sec <= target_duration_high_sec),
  ADD CONSTRAINT planned_sets_duration_pair_check
    CHECK ((target_duration_low_sec IS NULL) = (target_duration_high_sec IS NULL));

ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS performed_duration_sec SMALLINT
  CONSTRAINT set_logs_duration_positive_check CHECK (performed_duration_sec IS NULL OR performed_duration_sec > 0);
```

- [ ] **Step 2: Run migrations**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate`
Expected: 091 applied, exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
git add api/src/db/migrations/091_duration_columns.sql
git commit -m "feat(api): duration target + performed columns (additive)"
```

### Task 3: Seeds — reclassify side-plank + carries, re-prescribe templates

**Files:**
- Modify: `api/src/seed/exercises.ts` (side-plank ~line 919; carries at ~733, 853, 963, 985)
- Modify: the seed exercise adapter/upsert so it writes `measurement` (find with `grep -n "required_equipment" api/src/seed/runSeed.ts api/src/seed/*.ts` — the INSERT/UPSERT column list for exercises)
- Test: `api/tests/seed.test.ts` (or the existing seed-validation suite — locate with `ls api/tests | grep -i seed`), `api/tests/schemas/programTemplate.test.ts` (XOR block cases)

> **PR-sequencing rule (review fix C1): the `programTemplates.ts` side-plank flip does NOT happen in this task.** Templates keep reps 8–15 through all of PR1; the flip lives in Task 8 (PR2, with DROP NOT NULL). This task only reclassifies exercises + relaxes the template zod so duration blocks *validate* — no seed data uses them yet.

- [ ] **Step 1: Write the failing test** (in the existing seed suite; adjust the import path to match the suite's conventions)

```typescript
it('classifies holds and carries as duration, dynamic work as reps', async () => {
  const { rows } = await db.query(
    `SELECT slug, measurement FROM exercises
     WHERE slug IN ('side-plank','dumbbell-farmers-carry','suitcase-carry',
                    'dumbbell-suitcase-carry','dumbbell-overhead-carry','dead-bug','barbell-back-squat')`,
  );
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.measurement]));
  expect(bySlug['side-plank']).toBe('duration');
  expect(bySlug['dumbbell-farmers-carry']).toBe('duration');
  expect(bySlug['suitcase-carry']).toBe('duration');
  expect(bySlug['dumbbell-suitcase-carry']).toBe('duration');
  expect(bySlug['dumbbell-overhead-carry']).toBe('duration');
  expect(bySlug['dead-bug']).toBe('reps'); // dynamic — stays reps [v2: N9]
  expect(bySlug['barbell-back-squat']).toBe('reps');
});
```

(The "side-plank templates prescribed in seconds" test belongs to Task 8/PR2 — see the PR-sequencing rule above.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/<seed-suite> -t 'duration'`
Expected: FAIL — measurement column is 'reps' for side-plank (default).

- [ ] **Step 3: Update seed data**

In `api/src/seed/exercises.ts`, add `measurement: 'duration'` to the five entries (side-plank + 4 carries). Every other entry needs NO edit if the seed type defaults `measurement` to `'reps'` — define it as optional in the seed row type:

```typescript
// in the seed row type/interface:
measurement?: 'reps' | 'duration'; // default 'reps'
```

and in the upsert column mapping: `measurement: e.measurement ?? 'reps'`.

**Do NOT touch `programTemplates.ts` in this task** (review fix C1 — the flip is Task 8/PR2; the exact block diff lives there).

Carry-progression note [v2 §fix-11]: no seeded template references any carry slug (verified in review), so no template block changes for carries. When a carry IS ever templated, its duration ceiling is ~60s — progress load, not time. Record this as a comment atop the carries in `exercises.ts`.

- [ ] **Step 4: Update the template zod (`api/src/schemas/programTemplate.ts:10-43`)** — StrengthBlock gains the duration pair and an XOR refine:

```typescript
const StrengthBlock = z
  .object({
    exercise_slug: z.string().regex(SLUG_RE),
    mev: z.number().int().min(1).max(10),
    mav: z.number().int().min(1).max(12),
    target_reps_low: z.number().int().min(1).max(50).optional(),
    target_reps_high: z.number().int().min(1).max(50).optional(),
    target_duration_low_sec: z.number().int().min(5).max(600).optional(),
    target_duration_high_sec: z.number().int().min(5).max(600).optional(),
    target_rir: z.number().int().min(1).max(5), // RIR 0 banned globally (Q4)
    rest_sec: z.number().int().min(15).max(900),
  })
  .refine((b) => b.mev <= b.mav, { message: 'mev must be <= mav', path: ['mev'] })
  .refine((b) => (b.target_reps_low == null) === (b.target_reps_high == null), {
    message: 'target_reps_low and target_reps_high must be set together',
    path: ['target_reps_low'],
  })
  .refine((b) => (b.target_duration_low_sec == null) === (b.target_duration_high_sec == null), {
    message: 'duration targets must be set together',
    path: ['target_duration_low_sec'],
  })
  // Exactly one measurement dimension per block [v2 §fix-7].
  .refine((b) => (b.target_reps_low != null) !== (b.target_duration_low_sec != null), {
    message: 'block must have exactly one of reps targets or duration targets',
    path: ['target_reps_low'],
  })
  .refine((b) => b.target_reps_low == null || b.target_reps_low <= (b.target_reps_high ?? 0), {
    message: 'target_reps_low must be <= target_reps_high',
    path: ['target_reps_low'],
  })
  .refine(
    (b) =>
      b.target_duration_low_sec == null ||
      b.target_duration_low_sec <= (b.target_duration_high_sec ?? 0),
    { message: 'target_duration_low_sec must be <= target_duration_high_sec', path: ['target_duration_low_sec'] },
  );
```

Mirror the same optional/XOR shape in `api/src/schemas/programs.ts:45-62` (the user-programs fork copy — keep the two in lockstep per the schemas README convention).

- [ ] **Step 5: Reset the local DB, reseed, run the seed + template-schema suites**

There is NO `npm run db:reset` script (review fix I2). Reset explicitly:

```bash
psql postgres://repos:repos_dev_pw@127.0.0.1:5432/postgres -c "DROP DATABASE IF EXISTS repos_test WITH (FORCE)" -c "CREATE DATABASE repos_test OWNER repos"
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npm run seed
npx vitest run tests/<seed-suite> tests/schemas/programTemplate.test.ts
```

(memory `reference_ci_fresh_db_masks_backfill`: CI is fresh-DB — the seed path itself must set `measurement`; also reset locally so cruft doesn't mask gaps. Add the XOR block cases — duration-only OK, reps+duration rejected, neither rejected — to `tests/schemas/programTemplate.test.ts`, which is the zod suite; `program-schema.test.ts` is the DDL suite.)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
git add api/src/seed/ api/src/schemas/programTemplate.ts api/src/schemas/programs.ts api/tests/
git commit -m "feat(api): classify exercises by measurement; template schema accepts duration blocks"
```

### Task 4: Materializer + manualDeload + substitution column lists

**Files:**
- Modify: `api/src/services/materializeMesocycle.ts:229-336` (setRows + INSERT)
- Modify: `api/src/services/manualDeload.ts:91-97` (snapshot SELECT) and `:281-292` (restore INSERT + recordset type) — **[v2 §fix-5, Critical N2]**
- Modify: `api/src/routes/plannedSets.ts:85-101` (UPDATE/RETURNING lists)
- Modify: `api/src/services/substitutions.ts:87-98` (measurement filter) — **[v2 §fix-6, N4]**
- Modify: `frontend/src/lib/api/plannedSets.ts:21-35` (`PlannedSetPatchResponse` mirror gains the duration fields — lockstep with the RETURNING change)
- Test: `api/tests/materializeMesocycle.test.ts`, `api/tests/manualDeload.test.ts` (or wherever manual deload is covered — `grep -rl manualDeload api/tests`), `api/tests/contract/plannedSets.contract.test.ts` (covers the reshaped RETURNING)

- [ ] **Step 1: Write the failing materializer test**

```typescript
it('materializes duration blocks with duration targets and NULL-free reps handling', async () => {
  // Start a run from a template containing side-plank (e.g. the seeded template at slug used by tests today).
  // After materialization:
  const { rows } = await db.query(
    `SELECT ps.target_reps_low, ps.target_reps_high,
            ps.target_duration_low_sec, ps.target_duration_high_sec
     FROM planned_sets ps
     JOIN exercises e ON e.id = ps.exercise_id
     JOIN day_workouts dw ON dw.id = ps.day_workout_id
     WHERE dw.mesocycle_run_id = $1 AND e.slug = 'side-plank'`,
    [runId],
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.target_duration_low_sec).toBe(30);
    expect(r.target_duration_high_sec).toBe(45);
  }
});
```

NOTE: until PR2 lands, `target_reps_low/high` are still NOT NULL. **Interim rule for PR1:** the materializer writes duration blocks with `reps_low = reps_high = 0`? **No — never sentinel data [v2 review].** Instead, PR1's materializer keeps writing side-plank rows exactly as the template says — and since Task 3 changed the template to duration targets, the materializer must already handle them. Resolution: PR1 writes duration targets into the new columns AND continues to write `target_reps_low/high` from the template *only when present*; for duration blocks it writes **1/1 as a placeholder that PR2 nulls out**? Also sentinel. **Final resolution (what this plan mandates):** Tasks 3+4 (template duration targets + materializer duration path) are written in PR1 but the seeded template flip is **gated behind the 092 migration**: PR1 seeds side-plank templates unchanged (reps 8–15), PR2 flips the template seed to duration in the same PR as DROP NOT NULL. To keep PR1 testable, the materializer test above materializes from a **test-fixture template** with duration targets and asserts against a scratch schema where 092 is applied — impossible on CI before PR2. **Therefore: move the template-seed flip and this materializer test to PR2** (see Task 8). PR1's materializer change is code-only (accepts optional duration fields, passes them through when present, writes NULL reps only if the column allows it — which it will after 092). This ordering keeps every PR independently green.

- [ ] **Step 2: Materializer code change** (`materializeMesocycle.ts`)

Extend the `setRows` element type and push:

```typescript
const setRows: {
  day_workout_id: string;
  block_idx: number;
  set_idx: number;
  exercise_id: string;
  reps_low: number | null;
  reps_high: number | null;
  dur_low: number | null;
  dur_high: number | null;
  rir: number;
  rest: number;
}[] = [];
// ... inside the per-block loop:
setRows.push({
  day_workout_id: dwId,
  block_idx: blockIdx,
  set_idx: s,
  exercise_id: ex.id,
  reps_low: b.target_reps_low ?? null,
  reps_high: b.target_reps_high ?? null,
  dur_low: b.target_duration_low_sec ?? null,
  dur_high: b.target_duration_high_sec ?? null,
  rir: b.target_rir,
  rest: b.rest_sec,
});
```

And the UNNEST INSERT gains the two columns:

```typescript
`INSERT INTO planned_sets
   (day_workout_id, block_idx, set_idx, exercise_id,
    target_reps_low, target_reps_high, target_duration_low_sec, target_duration_high_sec,
    target_rir, rest_sec)
 SELECT dw, bi, si, ex, rl, rh, dl, dh, ri, rs
 FROM unnest($1::uuid[], $2::int[], $3::int[], $4::uuid[],
             $5::int[], $6::int[], $7::int[], $8::int[], $9::int[], $10::int[])
      AS t(dw, bi, si, ex, rl, rh, dl, dh, ri, rs)`,
[
  setRows.map((r) => r.day_workout_id),
  setRows.map((r) => r.block_idx),
  setRows.map((r) => r.set_idx),
  setRows.map((r) => r.exercise_id),
  setRows.map((r) => r.reps_low),
  setRows.map((r) => r.reps_high),
  setRows.map((r) => r.dur_low),
  setRows.map((r) => r.dur_high),
  setRows.map((r) => r.rir),
  setRows.map((r) => r.rest),
],
```

(The `resolveUserProgramStructure` block type feeding `b` must carry the optional duration fields — chase the `Block`/`StrengthBlock` TS types from Task 3's zod through `resolveUserProgramStructure.ts`.)

- [ ] **Step 3: manualDeload column lists** — snapshot SELECT (`:91-97`) gains the two columns:

```sql
SELECT ps.id, ps.day_workout_id, ps.block_idx, ps.set_idx, ps.exercise_id,
       ps.target_reps_low, ps.target_reps_high,
       ps.target_duration_low_sec, ps.target_duration_high_sec,
       ps.target_rir, ps.target_load_hint, ps.rest_sec
FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
WHERE dw.mesocycle_run_id=$1 AND dw.week_idx >= $2
```

Restore INSERT (`:281-292`):

```sql
INSERT INTO planned_sets
  (id, day_workout_id, block_idx, set_idx, exercise_id,
   target_reps_low, target_reps_high, target_duration_low_sec, target_duration_high_sec,
   target_rir, target_load_hint, rest_sec)
SELECT id, day_workout_id, block_idx, set_idx, exercise_id,
       target_reps_low, target_reps_high, target_duration_low_sec, target_duration_high_sec,
       target_rir, target_load_hint, rest_sec
FROM jsonb_to_recordset($1::jsonb)
     AS t(id uuid, day_workout_id uuid, block_idx int, set_idx int, exercise_id uuid,
          target_reps_low int, target_reps_high int,
          target_duration_low_sec int, target_duration_high_sec int,
          target_rir int, target_load_hint text, rest_sec int)
```

Also check the re-materialize INSERT the audit flagged at `manualDeload.ts:93/:284-289` region — run `grep -n "INSERT INTO planned_sets\|RETURNING .*target_reps" api/src/services/*.ts api/src/routes/*.ts` and add the duration columns to **every** hit [v2 §fix-5 checklist grep].

- [ ] **Step 4: Substitution route RETURNING + measurement filter**

`api/src/routes/plannedSets.ts` — **BOTH RETURNING lists** gain `target_duration_low_sec, target_duration_high_sec` (review fix I6): the override-PATCH UPDATE at :94-96 AND the substitution UPDATE. Keep `PlannedSetPatchResponse` in `frontend/src/lib/api/plannedSets.ts` in lockstep (keeps stale-target bugs visible to clients).

`api/src/services/substitutions.ts:96-98` candidate query gains the measurement equality [v2 §fix-6]:

```sql
FROM exercises e
WHERE e.id <> $1 AND e.archived_at IS NULL AND e.measurement = $4
```

with `target.measurement` as the fourth param (add `measurement` to the target-exercise SELECT earlier in the same file).

- [ ] **Step 5: Write the failing substitution test**

```typescript
it('never suggests a duration exercise for a reps block or vice versa', async () => {
  // side-plank (duration, anti_rotation) must not appear in substitutions
  // for cable-pallof-press (reps, anti_rotation) even though the pattern matches.
  const subs = await findSubstitutions('cable-pallof-press', emptyProfile, userId);
  expect(subs.subs.map((s) => s.slug)).not.toContain('side-plank');
});
```

- [ ] **Step 6: Run the API suites that cover these services**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/materializeMesocycle.test.ts tests/substitutions* tests/plannedSets.test.ts && npx tsc --noEmit`
Expected: PASS (materializer duration-path assertions deferred to PR2 per Step 1 resolution; existing tests stay green because reps blocks still populate reps columns identically).

- [ ] **Step 7: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
git add api/src/services/ api/src/routes/plannedSets.ts api/tests/
git commit -m "feat(api): duration-aware planned_sets writers + measurement-filtered substitutions"
```

### Task 5: set-logs API — duration_sec end-to-end

**Files:**
- Modify: `api/src/schemas/setLogs.ts:27-59` + `SetLogRow` (77-91)
- Modify: `api/src/routes/setLogs.ts` (INSERT ~:87-98, SELECT aliases ~:43/:140-151/:386, PATCH map :238)
- Test: **Create** `api/tests/schemas/setLogs.test.ts` (zod-parse tests — the schemas dir exists with `plannedSetPatch.test.ts` as the pattern); modify `api/tests/integration/set-logs-flow.test.ts` (flow test). NOTE (review fix I1): the existing `set-logs-schema.test.ts` under `tests/integration/` is a DDL/information_schema suite, NOT zod — don't put parse tests there. Plain `npm test` EXCLUDES `tests/integration/**`; integration suites run via `npm run test:integration`.

- [ ] **Step 1: Write the failing schema tests**

```typescript
it('accepts a duration-only log (no reps)', () => {
  const r = SetLogPostSchema.safeParse({
    client_request_id: crypto.randomUUID(),
    planned_set_id: crypto.randomUUID(),
    duration_sec: 42,
    performed_at: new Date().toISOString(),
  });
  expect(r.success).toBe(true);
});

it('rejects a log with neither reps nor duration_sec', () => {
  const r = SetLogPostSchema.safeParse({
    client_request_id: crypto.randomUUID(),
    planned_set_id: crypto.randomUUID(),
    weight_lbs: 100,
    performed_at: new Date().toISOString(),
  });
  expect(r.success).toBe(false); // [v2 §fix-8 rollback-skew guard]
});

it('rejects duration_sec out of range', () => {
  // 0 and 3601 both fail
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/schemas/setLogs.test.ts`
Expected: FAIL — the at-least-one-of refine doesn't exist yet, so the "rejects neither" test FAILS (schema accepts). That's the red we need.

- [ ] **Step 3: Schema change** (`api/src/schemas/setLogs.ts`)

```typescript
export const SetLogPostSchema = z
  .object({
    client_request_id: z.string().uuid(),
    planned_set_id: z.string().uuid(),
    weight_lbs: z.number().min(0).max(2000).optional(),
    reps: z.number().int().min(0).max(100).optional(),
    duration_sec: z.number().int().min(1).max(3600).optional(),
    rir: z.number().int().min(0).max(5).optional(),
    rpe: z.number().int().min(1).max(10).optional(),
    performed_at: z
      .string()
      .datetime({ offset: true })
      .refine(performedAtRefine, {
        message: 'performed_at must be within the last 365 days and not >5 minutes in the future',
      }),
    notes: z.string().max(500).optional(),
  })
  // Rollback-skew + junk-row guard: a set log must measure SOMETHING.
  // Old clients always send reps for reps sets — no compat break.
  .refine((v) => v.reps != null || v.duration_sec != null, {
    message: 'either reps or duration_sec is required',
    path: ['reps'],
  });
```

`SetLogPatchSchema` gains `duration_sec: z.number().int().min(1).max(3600).optional(),`.
`SetLogRow` gains `duration_sec: number | null;`.

- [ ] **Step 4: Route change** (`api/src/routes/setLogs.ts`)

- INSERT column list gains `performed_duration_sec` with the parsed `duration_sec ?? null`.
- Every SELECT projection that aliases performed columns gains `performed_duration_sec AS duration_sec` (grep `performed_reps AS reps` in this file — 3 sites).
- PATCH field→column map at :238 gains `duration_sec: 'performed_duration_sec',`.

- [ ] **Step 5: Write the failing flow test**

```typescript
it('POST + GET round-trips a hold log', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/set-logs',
    headers: authHeaders,
    payload: {
      client_request_id: crypto.randomUUID(),
      planned_set_id: plannedSetId, // fixture: any planned set
      duration_sec: 40,
      rir: 2, // proximity-to-failure — RPE 8 hold
      performed_at: new Date().toISOString(),
    },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().duration_sec).toBe(40);
  expect(res.json().reps).toBeNull();
});
```

- [ ] **Step 6: Run flow + schema suites to green, then typecheck**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/schemas/setLogs.test.ts && npm run test:integration -- set-logs-flow && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
git add api/src/schemas/setLogs.ts api/src/routes/setLogs.ts api/tests/
git commit -m "feat(api): set-logs accepts and returns performed_duration_sec"
```

### Task 6: Today view + history routes expose duration

**Files:**
- Modify: `api/src/services/getTodayWorkout.ts` (type :40-64, SQL :163-178, mapping :228-240)
- Modify: `api/src/routes/workoutHistory.ts:157-181`, `api/src/routes/exercises.ts:107-114`
- Modify: `api/src/schemas/mesocycles.ts:55-64` (today-view wire zod — **lockstep, [v2 §fix-9 N6]**)
- Modify: `frontend/src/lib/api/mesocycles.ts` `TodaySet` (mirror)
- Test: `api/tests/getTodayWorkout.test.ts`, `api/tests/workoutHistory.test.ts`, `api/tests/exerciseHistory.test.ts`, `api/tests/contract/mesocycles.contract.test.ts` (covers the reshaped today-view response)

> **PR1 typecheck guard (review fix C2):** the frontend `TodaySet` mirror's new fields are **optional** in this task (`target_duration_low_sec?: number | null` etc., `measurement?: 'reps' | 'duration'`, `logged` gains `duration_sec?: number | null`) so the un-updated fixtures in `TodayLoggerMobile.test.tsx` / `ExerciseFocus.test.tsx` still compile. PR3 (Task 13) tightens them to required when the fixtures are updated. `target_reps_low/high` become `number | null` (they're consumed with `??`/rendering guards — verify with `npx tsc --noEmit` and fix any strictness fallout inside this task, NOT by loosening the API type).

- [ ] **Step 1: Failing test** (getTodayWorkout)

```typescript
it('exposes duration targets and logged duration on sets', async () => {
  // fixture: planned set with target_duration_low_sec=30/high=45, one hold log 40s
  const w = await getTodayWorkout(userId);
  const holdSet = w.sets.find((s) => s.exercise.slug === 'side-plank');
  expect(holdSet.target_duration_low_sec).toBe(30);
  expect(holdSet.target_duration_high_sec).toBe(45);
  expect(holdSet.logged.duration_sec).toBe(40);
});
```

(Until PR2, fixtures create these rows via direct SQL with reps ALSO set — the NOT NULL is still in force; the test asserts duration passthrough, not NULL reps.)

- [ ] **Step 2: Service change** — `TodayWorkout` sets element gains:

```typescript
target_reps_low: number | null;
target_reps_high: number | null;
target_duration_low_sec: number | null;
target_duration_high_sec: number | null;
exercise: { id: string; slug: string; name: string; bodyweight: boolean; measurement: 'reps' | 'duration' };
logged: { weight_lbs: number | null; reps: number | null; duration_sec: number | null } | null;
```

SQL gains `ps.target_duration_low_sec, ps.target_duration_high_sec`, `e.measurement AS ex_measurement`, and in the LATERAL: `performed_duration_sec` (aliased `logged_duration`). Mapping passes all through; `measurement: s.ex_measurement`.

- [ ] **Step 3: History routes** — `workoutHistory.ts` projection gains `sl.performed_duration_sec AS duration_sec`; `exercises.ts:107-114` `json_build_object` gains `'duration_sec', sl.performed_duration_sec`.

- [ ] **Step 4: Wire zod + frontend mirror** — `schemas/mesocycles.ts` today-view set shape: `target_reps_low/high` become `.nullable()`, add `target_duration_low_sec: z.number().int().nullable()`, `target_duration_high_sec: z.number().int().nullable()`, `logged` object gains `duration_sec: z.number().int().nullable()`, exercise gains `measurement: z.enum(['reps','duration'])`. Frontend `TodaySet` in `lib/api/mesocycles.ts` mirrors exactly (all four nullable fields + `measurement` + `logged.duration_sec`); `HistorySession` set type (find in `lib/api/exercises.ts` or equivalent) gains `duration_sec: number | null`.

- [ ] **Step 5: Run all three suites + both typechecks**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/getTodayWorkout.test.ts tests/workoutHistory.test.ts tests/exerciseHistory.test.ts && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
git add api/src/services/getTodayWorkout.ts api/src/routes/ api/src/schemas/mesocycles.ts frontend/src/lib/api/ api/tests/
git commit -m "feat(api): today view + history expose duration targets and performed duration"
```

### Task 7: Stalled-PR evaluator guard + PR1 wrap-up

**Files:**
- Modify: `api/src/services/stalledPrEvaluator.ts:80-96`
- Test: `api/tests/stalled-pr-deload-parity.test.ts` (or the evaluator's own suite — `grep -rl stalledPr api/tests`)
- Modify: `docs/superpowers/plans/2026-07-12-measurement-model.md` (check off PR1 tasks)

- [ ] **Step 1: Failing test**

```typescript
it('ignores duration exercises entirely (NULL loads must not false-fire)', async () => {
  // fixture: 3 uniform sessions of side-plank hold logs, no load, no reps.
  // Before the guard: MAX/MIN of NULL loads are NULL; null === null across
  // sessions satisfies the streak equality and can false-fire.
  const result = await evaluateStalledPr(userId, runId);
  expect(result.triggered).toBe(false);
});
```

- [ ] **Step 2: Guard** — in the `session_agg` CTE:

```sql
FROM set_logs sl
JOIN planned_sets ps ON ps.id = sl.planned_set_id
JOIN exercises e     ON e.id = ps.exercise_id
JOIN day_workouts dw ON dw.id = ps.day_workout_id
WHERE sl.user_id = $1
  AND dw.mesocycle_run_id = $2
  AND dw.is_deload = false
  AND e.measurement = 'reps'   -- duration sets have no load/rep progression to stall [v2 §fix-10]
```

Also add the known-gap comment to `api/src/services/overreachingEvaluator.ts:90` [v2 review, product #4]:

```typescript
// KNOWN GAP (by design): duration sets log effort only when the user opts in
// (performed_rir omitted otherwise), so holds rarely contribute to the RIR-0
// condition. Do NOT "fix" by feeding RPE through a separate unit — performed
// effort is stored as proximity-to-failure (rir) for ALL measurement classes.
```

- [ ] **Step 3: Run evaluator suites + full API sweep**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run && npx tsc --noEmit`
Expected: full green.

- [ ] **Step 4: Commit, push, open PR1**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
git add api/src/services/ api/tests/ docs/superpowers/plans/2026-07-12-measurement-model.md
git commit -m "fix(api): stalled-PR evaluator ignores duration exercises"
git push -u origin meas-pr1-additive
gh pr create --title "feat: measurement model PR1 — additive duration foundation" --body "$(cat <<'EOF'
Part 1/6 of docs/superpowers/plans/2026-07-12-measurement-model.md (approved design).
Additive only: exercises.measurement, duration columns, duration-aware writers,
measurement-filtered substitutions, set-logs duration support, stalled-PR guard.
No behavior change for reps exercises; side-plank templates still reps until PR2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: 8 required checks green. Merge (0-approval gate), verify `main` contains the commit.

---

## PR2 — Destructive migration + template flip

### Task 8: Migration 092 — DROP NOT NULL + XOR CHECK, template seed flip

**Files:**
- Create: `api/src/db/migrations/092_planned_sets_reps_nullable.sql`
- Modify: `api/src/seed/programTemplates.ts` (the Task 3 Step 3 template flip — moved here per Task 4 Step 1 resolution)
- Test: `api/tests/materializeMesocycle.test.ts` (the duration materialization test from Task 4 Step 1), `api/tests/program-schema.test.ts` (XOR block cases)

- [ ] **Step 1: Rehearse the dry-run** (D10 gate requires a linked successful dry-run for destructive migrations)

Run the restore-into-ephemeral rehearsal: `cd /Users/jasonmeyer.ict/Projects/RepOS && tests/dr/restore-into-ephemeral.sh` with 092 staged, capturing forward → restore → reapply output. Record the log/run link for the PR body.

- [ ] **Step 2: Write the migration**

```sql
-- DESTRUCTIVE (column demotion): planned_sets.target_reps_low/high lose NOT NULL
-- so duration-measured sets can carry NULL reps instead of sentinel values.
-- Dry-run: <link in PR body>.
ALTER TABLE planned_sets
  ALTER COLUMN target_reps_low  DROP NOT NULL,
  ALTER COLUMN target_reps_high DROP NOT NULL;

-- Reps targets remain pair-consistent…
ALTER TABLE planned_sets
  ADD CONSTRAINT planned_sets_reps_pair_check
    CHECK ((target_reps_low IS NULL) = (target_reps_high IS NULL)),
-- …and every planned set measures exactly one dimension [v2 §fix-7].
  ADD CONSTRAINT planned_sets_measurement_xor_check
    CHECK ((target_reps_low IS NULL) <> (target_duration_low_sec IS NULL));
```

(All existing rows: reps NOT NULL + duration NULL → XOR satisfied. The pre-092 `CHECK (target_reps_low <= target_reps_high)` from 019 passes NULL rows automatically — SQL CHECK is satisfied by NULL.)

- [ ] **Step 3: Flip the three side-plank template blocks to duration targets** (review fix C1 — this diff lives HERE, not PR1). Each of the three side-plank blocks in `api/src/seed/programTemplates.ts` (lines ~162, ~390, ~690) changes from

```typescript
{
  exercise_slug: 'side-plank',
  mev: 2,
  mav: 3,
  target_reps_low: 8,
  target_reps_high: 15,
  target_rir: 2,
  rest_sec: 60,
},
```

to

```typescript
{
  exercise_slug: 'side-plank',
  mev: 2,
  mav: 3,
  target_duration_low_sec: 30,
  target_duration_high_sec: 45,
  target_rir: 2, // proximity-to-failure; UI renders RPE 8 for duration sets
  rest_sec: 60,
},
```

Add the deferred materializer duration test (Task 4 Step 1 verbatim) and a seed test asserting the three templates' side-plank blocks carry 30/45s and no reps targets.

- [ ] **Step 3b: PATCH XOR guard (review fix I5)** — after 092, `PATCH /api/planned-sets/:id` COALESCE-ing `target_reps_low` onto a duration row would violate `planned_sets_measurement_xor_check` → unhandled 500. In the PATCH handler in `api/src/routes/plannedSets.ts`, before the UPDATE: read the row's populated dimension; if the patch sets reps fields on a duration row (or duration fields on a reps row, once the patch schema ever carries them), return `422 { error: 'measurement_mismatch', detail: 'this set is duration-targeted; reps targets do not apply' }`. Test: PATCH reps onto the materialized side-plank row → 422, row unchanged.

- [ ] **Step 4: Reset DB, migrate, seed, full API suite**

```bash
psql postgres://repos:repos_dev_pw@127.0.0.1:5432/postgres -c "DROP DATABASE IF EXISTS repos_test WITH (FORCE)" -c "CREATE DATABASE repos_test OWNER repos"
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npm run seed && npx vitest run && npm run test:integration && npx tsc --noEmit
```

Expected: full green, including the new materializer duration test (fresh materialization from the flipped template now writes NULL reps + 30/45 duration).

- [ ] **Step 5: Production-safety assertion (manual, before merge):** the live run's existing side-plank rows keep `target_reps 8–15` + NULL duration → XOR satisfied, logger renders reps mode (populated-targets rule). Nothing retro-migrates [v2 §fix-1]. State this in the PR body.

- [ ] **Step 6: Commit, push, open PR2** with `Dry-run: <link>` AND the rollback-skew hazard paragraph (top of this plan) in the body. Merge after green; verify main.

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS
git add api/src/db/migrations/092_planned_sets_reps_nullable.sql api/src/seed/programTemplates.ts api/tests/
git commit -m "feat(api)!: planned_sets reps targets nullable + measurement XOR; side-plank prescribed in seconds"
```

---

## PR3 — Logger UI + offline pipeline

### Task 9: Effort seam + row-mode helper

**Files:**
- Create: `frontend/src/lib/effort.ts`
- Test: `frontend/src/lib/effort.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { rpeFromRir, rirFromRpe, rowMode } from './effort';

describe('effort seam — the ONLY rir<->rpe conversion in the app [v2 §fix-4]', () => {
  it('converts both directions and round-trips', () => {
    expect(rpeFromRir(2)).toBe(8);
    expect(rirFromRpe(8)).toBe(2);
    for (let rir = 0; rir <= 5; rir++) expect(rirFromRpe(rpeFromRir(rir))).toBe(rir);
  });
  it('derives row mode from populated targets, not exercise.measurement [v2 §fix-1]', () => {
    expect(rowMode({ target_duration_low_sec: 30 } as never)).toBe('duration');
    expect(rowMode({ target_duration_low_sec: null, target_reps_low: 8 } as never)).toBe('reps');
    // In-flight legacy row: duration exercise materialized pre-092 with reps targets → reps mode.
    expect(
      rowMode({ target_duration_low_sec: null, target_reps_low: 8, exercise: { measurement: 'duration' } } as never),
    ).toBe('reps');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { TodaySet } from './api/mesocycles';

// =============================================================================
// effort.ts — THE single conversion seam between stored proximity-to-failure
// (rir, effort-descending, DB unit for targets AND performed) and displayed
// RPE (effort-ascending) on duration sets. If you need 10 - rir anywhere else,
// import from here instead. [design v2 §fix-4]
// =============================================================================

export function rpeFromRir(rir: number): number {
  return 10 - rir;
}

export function rirFromRpe(rpe: number): number {
  return 10 - rpe;
}

/**
 * Which input mode a planned row renders. Derives from the row's OWN populated
 * targets — never from exercise.measurement — so rows materialized before an
 * exercise was reclassified (the in-flight production run) keep rendering as
 * they were prescribed. exercise.measurement is for materialization, seeds,
 * and substitution filtering only. [design v2 §fix-1]
 */
export function rowMode(set: Pick<TodaySet, 'target_duration_low_sec'>): 'reps' | 'duration' {
  return set.target_duration_low_sec != null ? 'duration' : 'reps';
}
```

- [ ] **Step 3: Run** `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/effort.test.ts` → PASS. Commit: `feat(frontend): effort conversion seam + row-mode derivation`

### Task 10: useHoldTimer

**Files:**
- Create: `frontend/src/components/programs/logger/useHoldTimer.ts`
- Test: `frontend/src/components/programs/logger/useHoldTimer.test.ts`

- [ ] **Step 1: Failing test** (fake timers + Date mocking, same pattern as the existing `useRestTimer` tests — copy its harness)

```typescript
it('counts up wall-clock-anchored and stop() returns elapsed seconds', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useHoldTimer());
  act(() => result.current.start());
  act(() => vi.advanceTimersByTime(42_000));
  expect(result.current.elapsed).toBe(42);
  let final = 0;
  act(() => { final = result.current.stop(); });
  expect(final).toBe(42);
  expect(result.current.running).toBe(false);
});

it('reset() clears elapsed back to null', () => { /* start → stop → reset → elapsed null */ });
```

- [ ] **Step 2: Implement** — sibling of `useRestTimer` (same wall-clock + visibilitychange discipline):

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

// =============================================================================
// useHoldTimer — count-UP stopwatch for duration-set logging (side plank etc).
// Same wall-clock anchoring as useRestTimer: elapsed derives from Date.now()
// minus the recorded start timestamp, so a locked phone mid-hold stays correct;
// visibilitychange forces a recompute on unlock. stop() freezes and returns
// the elapsed whole seconds for the duration input.
// =============================================================================

export function useHoldTimer(): {
  elapsed: number | null;
  running: boolean;
  start: () => void;
  stop: () => number;
  reset: () => void;
} {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const startAtRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const startAt = startAtRef.current;
    if (startAt == null) return;
    setElapsed(Math.floor((Date.now() - startAt) / 1000));
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(recompute, 1000);
    return () => clearTimeout(t);
  }, [running, elapsed, recompute]);

  useEffect(() => {
    if (!running) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') recompute();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running, recompute]);

  const start = useCallback(() => {
    startAtRef.current = Date.now();
    setElapsed(0);
    setRunning(true);
  }, []);

  const stop = useCallback((): number => {
    const startAt = startAtRef.current;
    const final = startAt == null ? 0 : Math.floor((Date.now() - startAt) / 1000);
    startAtRef.current = null;
    setRunning(false);
    setElapsed(final);
    return final;
  }, []);

  const reset = useCallback(() => {
    startAtRef.current = null;
    setRunning(false);
    setElapsed(null);
  }, []);

  return { elapsed, running, start, stop, reset };
}
```

- [ ] **Step 3: Run** the test → PASS. Commit: `feat(frontend): useHoldTimer count-up stopwatch hook`

### Task 11: Offline pipeline carries duration_sec

**Files:**
- Modify: `frontend/src/lib/idbQueue.ts:8-11` (`PendingSetLog`), `frontend/src/lib/logBuffer.ts:33-40` (`EnqueueFields`) and `:66-82` (`postSetLog` strip list)
- Test: `frontend/src/lib/logBuffer.test.ts`

- [ ] **Step 1: Failing test**

```typescript
it('posts duration_sec when present and strips it when null', async () => {
  // enqueue a row with duration_sec: 40, reps: null → fetch body includes
  // duration_sec: 40 and omits reps entirely; and vice versa for a reps row.
});
```

- [ ] **Step 2: Implement** — `PendingSetLog` gains `duration_sec: number | null;` (Dexie stores non-indexed props without a version bump; old queued rows lack the key and read as `undefined` → strip path treats as absent — both directions compatible [v2 review]). `EnqueueFields` gains `duration_sec?: number | null;`. `postSetLog` gains `if (row.duration_sec != null) payload.duration_sec = row.duration_sec;`. `logBuffer.enqueue` writes `duration_sec: fields.duration_sec ?? null` into the IDB row.

- [ ] **Step 3: Run** `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/lib/logBuffer.test.ts src/lib/idbQueue.test.ts` → PASS. Commit: `feat(frontend): offline queue carries duration_sec`

### Task 12: SetRow duration mode

**Files:**
- Modify: `frontend/src/components/programs/logger/SetRow.tsx`
- Test: **Create** `frontend/src/components/programs/logger/SetRow.test.tsx` (no suite exists for SetRow today — model the harness on `ExerciseFocus.test.tsx` in the same dir)

- [ ] **Step 1: Failing tests**

```typescript
it('renders duration mode: seconds input + HOLD chip + stopwatch, no reps input, no RIR slider', () => {
  render(<SetRow set={holdSet} state={{ phase: 'input' }} inputs={emptyHoldInputs} ... />);
  expect(screen.getByLabelText(/seconds/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/reps$/i)).not.toBeInTheDocument();
  expect(screen.getByText('HOLD')).toBeInTheDocument();
  expect(screen.queryByText(/RIR/)).not.toBeInTheDocument(); // RIR-as-reps is meaningless for holds
  expect(screen.getByRole('button', { name: /start hold/i })).toBeInTheDocument();
});

it('stopwatch fills the seconds input on stop', async () => { /* start → advance 30s → stop → input value '30' */ });

it('duration mode Log gate: seconds required, weight only when not bodyweight', () => { /* canLog matrix */ });

it('optional RPE control stores effort without defaulting', () => {
  // No RPE tapped → onLog payload has rir omitted (never fabricated) [v2 §fix-2, N3].
  // RPE 8 tapped → converted via rirFromRpe → rir 2.
});
```

- [ ] **Step 2: Implement.** `RowInputs` (SetRow.tsx:20-24) becomes:

```typescript
export interface RowInputs {
  weight: string;
  reps: string;
  durationSec: string; // duration-mode primary input
  rir: number; // reps mode: 0..5, seeded from target (existing behavior)
  holdRpe: number | null; // duration mode: OPTIONAL user-reported RPE 5..10; null = not provided
}
```

Rendering branches on `rowMode(set)` (import from `../../../lib/effort`):
- **duration mode:** target line renders `target {target_duration_low_sec}–{target_duration_high_sec}s`; the input row shows the load column (BODYWEIGHT chip if `set.exercise.bodyweight`, else Weight NumInput — weighted holds/carries) + a `NumInput label="Hold" unit="sec"` bound to `inputs.durationSec`; below it a stopwatch row: `START HOLD` / `STOP` button pair driven by `useHoldTimer` — on stop, `onInputChange({ durationSec: String(stop()) })`; while running show `m:ss` elapsed in mono font. A `HOLD` chip renders next to the set label, styled like the BODYWEIGHT chip (mono, letterSpacing 1, surface background, `<Term k="HOLD" compact/>` wrapping). Instead of `RirSlider`, an **optional** `RpeSlider` (values 5–10 displayed, stored as-is into `holdRpe`, with a "skip" affordance = simply never tapping it; label `<Term k="RPE" compact/>`, no default selection).
- **reps mode:** byte-identical to today (weight/reps/RIR).

`canLog` becomes:

```typescript
const mode = rowMode(set);
const primaryFilled = mode === 'duration' ? inputs.durationSec.trim() !== '' : inputs.reps.trim() !== '';
const canLog = !debounced && !isLogged && !isLogging && (isBodyweight || inputs.weight.trim() !== '') && primaryFilled;
```

- [ ] **Step 3: Run** `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/logger/SetRow.test.tsx` → PASS. Commit: `feat(frontend): SetRow duration mode — seconds input, HOLD chip, count-up stopwatch, optional RPE`

### Task 13: TodayLoggerMobile — enqueue, hydration, prefill

**Files:**
- Modify: `frontend/src/components/programs/TodayLoggerMobile.tsx` (rowInputs seed :224-238, prefill :296-312, handleLog :389-427)
- Modify: `frontend/src/components/programs/logger/ExerciseFocus.tsx` (passes inputs through — chase the RowInputs type change)
- Test: `frontend/src/components/programs/TodayLoggerMobile.test.tsx`

- [ ] **Step 1: Failing tests**

```typescript
it('logs a hold: duration_sec enqueued, reps omitted, rir omitted when RPE untouched', async () => {
  // duration-mode set, type 40 into Hold field, tap Log →
  // logBuffer.enqueue called with { weight_lbs: null, reps: null, duration_sec: 40, rir: null, performed_at: ... }
});
it('logs a hold with RPE 8 → rir 2 via the effort seam', async () => {});
it('hydrates a logged hold row from logged.duration_sec', () => {});
it('prefills duration ONLY from history duration_sec — never reinterprets old reps as seconds', () => {
  // history set { reps: 45, duration_sec: null } (pre-flip ambiguous data) → durationSec stays ''.
  // history set { duration_sec: 38 } → durationSec '38'. [v2 §fix-3 quarantine]
});
```

- [ ] **Step 2: Implement.**

rowInputs seed (:224-238):

```typescript
{
  weight: s.logged?.weight_lbs != null ? String(s.logged.weight_lbs) : '',
  reps: s.logged?.reps != null ? String(s.logged.reps) : '',
  durationSec: s.logged?.duration_sec != null ? String(s.logged.duration_sec) : '',
  rir: s.target_rir,
  holdRpe: null,
}
```

Prefill effect (:296-312) — inside the per-set loop, branch on mode:

```typescript
const hs = last.sets[set.set_idx] ?? last.sets[0];
if (!hs) continue;
if (rowMode(set) === 'duration') {
  // Quarantine: pre-reclassification history logged holds as "reps" (units
  // ambiguous — some are seconds). Only genuine duration_sec prefills. [v2 §fix-3]
  next[set.id] = {
    ...cur,
    durationSec: hs.duration_sec != null ? String(hs.duration_sec) : cur.durationSec,
    weight: hs.weight_lbs != null ? String(hs.weight_lbs) : cur.weight,
  };
} else {
  next[set.id] = {
    ...cur,
    weight: hs.weight_lbs != null ? String(hs.weight_lbs) : cur.weight,
    reps: hs.reps != null ? String(hs.reps) : cur.reps,
  };
}
```

(The untouched-row guard `cur.weight !== '' || cur.reps !== ''` gains `|| cur.durationSec !== ''`.)

handleLog (:389-427) — branch on mode:

```typescript
const mode = rowMode(set);
const isBodyweight = set.exercise.bodyweight === true;
const weight = isBodyweight ? null : parseFloat(inputs.weight);
let reps: number | null = null;
let durationSec: number | null = null;
if (mode === 'duration') {
  durationSec = parseInt(inputs.durationSec, 10);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false;
} else {
  reps = parseInt(inputs.reps, 10);
  if (!Number.isFinite(reps) || reps <= 0) return false;
}
if (weight !== null && !Number.isFinite(weight)) return false;
// Effort: reps mode keeps existing behavior (rir always sent — beginner
// hideRir silently keeps target). Duration mode NEVER fabricates effort:
// rir is sent only when the user tapped the optional RPE control. [v2 §fix-2]
const rir = mode === 'duration' ? (inputs.holdRpe != null ? rirFromRpe(inputs.holdRpe) : null) : inputs.rir;
// ... unchanged performedAt logic ...
const clientRequestId = await logBuffer.enqueue(
  set.id,
  { weight_lbs: weight, reps, duration_sec: durationSec, rir, performed_at: performedAt },
  currentUserId,
);
```

- [ ] **Step 3: Run** logger suites + typecheck: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs && npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit, push, open PR3.** `feat(frontend): duration-mode logging — hold timer, quarantined prefill, no fabricated effort`

---

## PR4 — Display, cues, e2e

### Task 14: History + recap formatters

**Files:**
- Modify: `frontend/src/components/history/WorkoutHistoryPage.tsx:249-254` and `:495`, `frontend/src/components/programs/logger/HistorySheet.tsx` (last-time line)
- Create: `frontend/src/lib/formatSetPerformance.ts` (+ test)

- [ ] **Step 1: Failing test**

```typescript
import { formatSetPerformance } from './formatSetPerformance';
it('formats all measurement shapes', () => {
  expect(formatSetPerformance({ weight_lbs: 185, reps: 8, duration_sec: null })).toBe('185 lb × 8');
  expect(formatSetPerformance({ weight_lbs: null, reps: 12, duration_sec: null })).toBe('BW × 12');
  expect(formatSetPerformance({ weight_lbs: null, reps: null, duration_sec: 40 })).toBe('BW · 40s hold');
  expect(formatSetPerformance({ weight_lbs: 70, reps: null, duration_sec: 45 })).toBe('70 lb · 45s hold');
});
```

- [ ] **Step 2: Implement** (single seam; both history surfaces call it):

```typescript
export function formatSetPerformance(s: {
  weight_lbs: number | null;
  reps: number | null;
  duration_sec: number | null;
}): string {
  const load = s.weight_lbs != null ? `${s.weight_lbs} lb` : 'BW';
  if (s.duration_sec != null) return `${load} · ${s.duration_sec}s hold`;
  return `${load} × ${s.reps ?? 0}`;
}
```

Replace the inline `weight_lbs ?? 'BW'` + `× reps` sites in WorkoutHistoryPage (both) and HistorySheet with calls to it. Old mixed history (pre-flip side-plank reps rows) renders `BW × 45` — correct, we never reinterpret [v2 §fix-3].

- [ ] **Step 3: Run + commit.** `npx vitest run src/lib/formatSetPerformance.test.ts src/components/history` → PASS. Commit: `feat(frontend): measurement-aware set formatting in history surfaces`

### Task 15: Effort cue, tooltips, target rendering on non-logger surfaces

**Files:**
- Modify: `frontend/src/lib/programTracks.ts:18-21` (effortCue), `frontend/src/lib/terms.ts` (HOLD + RPE entries)
- Modify: `frontend/src/components/programs/TodayWorkoutMobile.tsx`, `DayCard.tsx`, `ProgramTemplateDetail.tsx` (target text: render `30–45s` when duration targets populated, existing reps text otherwise — same populated-targets rule)
- Test: extend `programTracks` test + component snapshots

- [ ] **Step 1: effortCue gains a mode param** (find all callers with `grep -rn effortCue frontend/src`):

```typescript
export function effortCue(rir: number, mode: 'reps' | 'duration' = 'reps'): string {
  if (mode === 'duration') {
    // One unit rule: rir is proximity-to-failure; render as RPE for holds.
    return `Hold to about RPE ${rpeFromRir(rir)} — hard, but stop short of failure`;
  }
  return `Leave ${rir} reps in the tank`;
}
```

- [ ] **Step 2: terms.ts** gains (match the file's existing entry shape exactly):

```typescript
HOLD: {
  label: 'Hold',
  definition: 'A timed isometric set — you hold the position instead of counting reps.',
  why: 'Time under tension is the progression currency: add seconds, then add load.',
},
RPE: {
  label: 'RPE',
  definition: 'Rate of Perceived Exertion, 1–10. 10 = failure; 8 ≈ could hold ~2 more seconds/reps.',
  why: 'For holds we ask RPE instead of RIR because "reps in reserve" has no meaning mid-plank.',
},
```

- [ ] **Step 3: Fork `change_rir` label** — in the desktop fork/customization UI that surfaces the `change_rir` op (find with `grep -rn change_rir frontend/src`), when the block has duration targets label the control `RPE` and display `rpeFromRir(value)` via the seam [v2 §fix-4 scope].

- [ ] **Step 4: Run frontend suite + commit.** `feat(frontend): hold-aware effort cues, HOLD/RPE tooltips, duration target rendering`

### Task 16: e2e — `_helpers.ts` + duration offline spec

**Files:**
- Modify: `frontend/src/components/programs/__offline__/_helpers.ts` (mock today-payload gains a duration set + `measurement`/`target_duration_*`/`logged.duration_sec` fields; `logSet` helper gains a duration variant)
- Create: `frontend/src/components/programs/__offline__/O10-duration-offline.spec.ts` (Playwright, mobile viewport per memory `reference_e2e_ci_gaps`; `/api/me` mock must include `onboarding_completed_at` AND `beta_disclaimer_ack_at`)

- [ ] **Step 1: Extend `_helpers.ts`** — every mocked set gains the four new nullable fields (reps sets: `target_duration_low_sec: null, target_duration_high_sec: null`, `logged` gains `duration_sec: null`, exercise gains `measurement: 'reps'`); add one hold set fixture:

```typescript
{
  id: 'ps-hold-1',
  block_idx: 2,
  set_idx: 0,
  exercise: { id: 'ex-hold', slug: 'side-plank', name: 'Side Plank', bodyweight: true, measurement: 'duration' },
  target_reps_low: null,
  target_reps_high: null,
  target_duration_low_sec: 30,
  target_duration_high_sec: 45,
  target_rir: 2,
  rest_sec: 60,
  logged: null,
},
```

- [ ] **Step 2: O10 spec** — offline → type 40s into the hold row → Log → assert IDB row has `duration_sec: 40, reps: null` → back online → flush → assert POST body carried `duration_sec` and the row hits `synced`. Model the spec on O1/O2's structure.

- [ ] **Step 3: Run the O-matrix + full frontend gate locally**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run && npx playwright test src/components/programs/__offline__ && npx tsc --noEmit`
Expected: O1–O10 green (O1–O9 unchanged — the added fixture fields are nullable-compatible).

- [ ] **Step 4: Commit, push, open PR4.** `test: duration-set offline matrix (O10) + measurement-aware e2e fixtures`

---

## PR5 — cardio_logs (phase 2, API)

### Task 17: Migration 093 + cardio-logs schema/routes

**Files:**
- Create: `api/src/db/migrations/093_cardio_logs.sql`
- Create: `api/src/schemas/cardioLogs.ts`, `api/src/routes/cardioLogs.ts` (register in the app’s route index — find with `grep -rn "setLogs" api/src/app.ts api/src/routes/index.ts 2>/dev/null` and mirror)
- Modify: `api/src/services/getTodayWorkout.ts` (cardio array gains `logged`)
- Test: `api/tests/cardio-logs-flow.test.ts` (new), `api/tests/integration/contamination/` (new cardio-logs contamination test mirroring set-logs')

- [ ] **Step 1: Migration**

```sql
-- Cardio execution log — session/block grain (Q15: cardio's dimension is
-- minutes/week, not sets/week). Mirrors set_logs' idempotency + dedupe
-- discipline. source distinguishes manual logging from the future Apple
-- Health ingestion (phase 3), which is session-grained by HealthKit design.
CREATE TABLE IF NOT EXISTS cardio_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_cardio_block_id UUID NOT NULL REFERENCES planned_cardio_blocks(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id             UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  client_request_id       UUID NOT NULL,
  performed_duration_sec  INT  NOT NULL CHECK (performed_duration_sec BETWEEN 1 AND 86400),
  performed_distance_m    INT      CHECK (performed_distance_m IS NULL OR performed_distance_m > 0),
  avg_hr                  SMALLINT CHECK (avg_hr IS NULL OR avg_hr BETWEEN 30 AND 250),
  max_hr                  SMALLINT CHECK (max_hr IS NULL OR max_hr BETWEEN 30 AND 250),
  energy_kcal             INT      CHECK (energy_kcal IS NULL OR energy_kcal BETWEEN 1 AND 10000),
  srpe                    SMALLINT CHECK (srpe IS NULL OR srpe BETWEEN 1 AND 10),
  source                  TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','apple_health')),
  performed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cardio_logs_user_client_request_key
  ON cardio_logs (user_id, client_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS cardio_logs_minute_dedupe_key
  ON cardio_logs (planned_cardio_block_id, date_trunc('minute', performed_at, 'UTC'));
CREATE INDEX IF NOT EXISTS idx_cardio_logs_user_performed
  ON cardio_logs (user_id, exercise_id, performed_at DESC);

-- updated_at trigger (review fix I3) — same table-scoped pattern as
-- set_logs_set_updated_at() in 029; PATCH relies on it.
CREATE OR REPLACE FUNCTION cardio_logs_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cardio_logs_updated_at ON cardio_logs;
CREATE TRIGGER cardio_logs_updated_at
  BEFORE UPDATE ON cardio_logs
  FOR EACH ROW
  EXECUTE FUNCTION cardio_logs_set_updated_at();
```

- [ ] **Step 2: Schema** (`api/src/schemas/cardioLogs.ts`) — mirror `setLogs.ts` structure: `CardioLogPostSchema` with `client_request_id`, `planned_cardio_block_id`, required `duration_sec` (1..86400), optional `distance_m/avg_hr/max_hr/energy_kcal/srpe/notes`, `performed_at` with the same `performedAtRefine` (import it — export it from setLogs.ts). `CardioLogRow` interface mirrors `SetLogRow`.

- [ ] **Step 3: Route** (`api/src/routes/cardioLogs.ts`) — POST (auth + ownership via planned_cardio_block → day_workout → mesocycle_run join, exactly the pattern `setLogs.ts` uses for planned_set ownership; `ON CONFLICT DO NOTHING` + re-select idempotency; 201/200), GET `?planned_cardio_block_id=`, PATCH/DELETE with the same 24h audit window helper setLogs uses. Contamination test: user B POST/GET against user A's block → 404, no row.

- [ ] **Step 4: getTodayWorkout cardio `logged`** — LATERAL join mirroring sets:

```sql
LEFT JOIN LATERAL (
  SELECT id, performed_duration_sec, performed_distance_m FROM cardio_logs
  WHERE planned_cardio_block_id = pc.id ORDER BY performed_at DESC LIMIT 1
) cl ON true
```

cardio element type gains `logged: { duration_sec: number; distance_m: number | null } | null`; wire zod + frontend `TodayCardio` mirror in lockstep [v2 §fix-9].

- [ ] **Step 5: TDD the flow test** (POST 201 → idempotent replay 200 → GET → PATCH inside window → cross-user 404), run full API suite + typecheck, commit, push, open PR5. `feat(api): cardio_logs — cardio blocks become completable`

---

## PR6 — Cardio logging UI + hold PRs (phase 2, surfaces)

### Task 18: Inline cardio logging in the session logger

**Files:**
- Modify: `frontend/src/components/programs/TodayWorkoutMobile.tsx:255-283` (cardio chips → loggable rows), `frontend/src/components/programs/TodayLoggerMobile.tsx` (cardio section)
- Create: `frontend/src/components/programs/logger/CardioBlockRow.tsx` (+ test)
- Create: `frontend/src/lib/api/cardioLogs.ts` (POST wrapper)

**Acceptance criterion [v2 review, product]: the cardio block renders INLINE in the same session logger flow — schema separation must never become UI separation.**

- [ ] **Step 1: Failing component test** — `CardioBlockRow` renders exercise name + target chips (`45 min · Z2` as today), a duration input **prefilled from the target**, optional distance, a `LOG CARDIO` CTA; on success shows the logged state; on network failure shows an inline retry affordance (per repo error-handling rule: actionable message, not generic).

- [ ] **Step 2: Implement.** Direct `fetch` POST with `client_request_id` minted per attempt-set (idempotent retries safe). **Deliberate scope decision (documented here, flag at review):** cardio logging does NOT ride the idbQueue offline pipeline in this PR — cardio completion is a single post-session tap (not 20 mid-set taps), failure is recoverable by re-tap, and idempotency makes retry safe. Offline parity is a stated deferral, not an oversight.

- [ ] **Step 3: Wire into both logger surfaces**, run suites, commit. `feat(frontend): inline cardio logging — prescribed cardio is finally completable`

### Task 19: Hold Best-Time PR (recap) + live toast

**Files:**
- Modify: `api/src/routes/mesocycles.ts:129-158` (recap `prs` query gains a duration branch), `api/src/schemas/mesocycles.ts:195-201` (recap zod)
- Modify: `api/src/routes/exercises.ts` history response gains `best_duration_sec` meta (MAX over all-time duration logs for the slug)
- Modify: `frontend/src/components/programs/MesocycleRecap.tsx:39-43` (render duration PRs as `Best hold: 52s @ BW`), `TodayLoggerMobile.tsx` (toast via the existing ToastHost when a logged duration exceeds `best_duration_sec`)
- Test: recap route test + component tests

- [ ] **Step 1: Recap duration-PR query** — alongside the existing `MAX(performed_load_lbs)` PR CTE, a duration branch:

```sql
SELECT sl.exercise_id, MAX(sl.performed_duration_sec) AS best_duration_sec
FROM set_logs sl
JOIN day_workouts dw ON ... (this run)
WHERE sl.performed_duration_sec IS NOT NULL
GROUP BY sl.exercise_id
```

compared against the same aggregate over prior runs (mirror the load-PR comparison structure). Hevy convention: Best Time is the ONLY duration PR [v2].

**Recap response shape (review fix I4):** the current recap `prs` is a bare count-style aggregate — duration PRs need explicit per-exercise fields. Extend the recap zod (`api/src/schemas/mesocycles.ts:195-201`) with:

```typescript
duration_prs: z.array(
  z.object({
    exercise_slug: z.string(),
    exercise_name: z.string(),
    best_duration_sec: z.number().int(),
    load_lbs: z.number().nullable(), // null = bodyweight hold
  }),
),
```

and render each in `MesocycleRecap.tsx` as `Best hold: {best_duration_sec}s @ {load_lbs ?? 'BW'}`.

**ToastHost precondition (review note):** `ToastHost` (`frontend/src/components/common/ToastHost.tsx`) is currently imported only by Settings surfaces — verify it's mounted on the logger route (or mount it in the logger layout) before wiring the new-best toast.

- [ ] **Step 2: TDD both surfaces, full sweep both sides** (`npx vitest run && npx tsc --noEmit` in api/ AND frontend/), commit, push, open PR6. `feat: hold best-time PRs in recap + new-best toast`

---

## Post-wave

- [ ] Update memory `project_measurement_model_design.md` → DECIDED + link this plan; add `[[project_measurement_model_design]]` outcome note to `MEMORY.md` line.
- [ ] `docs/PASSDOWN.md`: measurement-model wave record (design file, PR list, the in-flight-run rendering rule).
- [ ] Verify live after each deploy per memory `project_precutover_window`: wait for the docker run matching the merge sha, redeploy, smoke. After PR3 deploys: log a real side-plank hold on prod (next materialized meso only — current run stays reps-mode by design) or via a scratch run.
- [ ] Assisted-bodyweight tripwire [v2 open item]: NOT in this wave. Before any assisted exercise is ever seeded, negative-load ordering needs a schema comment + test.

## Plan review record

Engineering-specialist review 2026-07-12: **SHIP-WITH-FIXES**, all fixes applied inline — C1 (template flip physically moved to Task 8), C2 (PR1 frontend mirror fields optional + contract suites added), I1 (set-logs test locations + `npm run test:integration`), I2 (explicit DB reset — no `db:reset` script exists), I3 (cardio_logs updated_at trigger), I4 (recap `duration_prs` shape), I5 (PATCH measurement-mismatch 422 guard), I6 (both RETURNING lists + `PlannedSetPatchResponse` mirror), plus SetRow.test.tsx create-not-extend and the ToastHost mount check. Migration SQL for 090–093 verified valid against the runner's per-file transaction and existing prod data; D10 gate correctly flags 092.

## Self-review notes (per writing-plans skill)

- Spec coverage: all 12 v2 mandatory fixes mapped — fix-1 (Task 9/12/13), fix-2 (Task 12/13), fix-3 (Task 13/14), fix-4 (Task 9/15), fix-5 (Task 4), fix-6 (Task 4), fix-7 (Task 8), fix-8 (Task 5), fix-9 (Task 6/17), fix-10 (Task 7), fix-11 (Task 3), fix-12 (documented, no change). Phase-2 acceptance criterion in Task 18.
- Ordering hazard resolved inline: template flip + NULL-reps materialization moved from PR1 to PR2 (Task 4 Step 1) so every PR is independently green.
- Type consistency: `RowInputs.durationSec`/`holdRpe` (Tasks 12–13), `duration_sec` on wire + IDB (Tasks 5/6/11), `rowMode`/`rpeFromRir`/`rirFromRpe` (Task 9) used consistently thereafter.
