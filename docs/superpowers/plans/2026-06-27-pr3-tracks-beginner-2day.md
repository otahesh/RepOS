# PR3 — First-class Tracks + Beginner 2-Day Template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-class `track` (beginner/intermediate/advanced) on program templates, classify the existing three templates, author a new beginner `full-body-2-day` template, and group the catalog + onboarding by track.

**Architecture:** Additive `track` column on `program_templates` via an **expand/contract two-migration** split (072 adds the nullable column + backfills; 073 flips it to `NOT NULL` last) so every commit keeps the test suite green and prod migrates safely. `track` is threaded through the Zod seed schema, wire-record types, REST response schemas, the seed adapter upsert, and the seed entries. The frontend groups the already-fetched template list by `track` client-side (catalog + onboarding) with a "More coming" empty state; an additive `?track=` API filter is added for completeness. The new `full-body-2-day` template was authored and adversarially reviewed by a strength-programming judge panel (see `docs/superpowers/specs/2026-06-26-program-experience-batch-design.md` Feature B).

**Tech Stack:** Fastify 5 + TypeScript (`api/`), Vite 5 + React 18 + TypeScript (`frontend/`), Postgres, Vitest, React Testing Library.

> **This plan was adversarially reviewed (4 independent reviewers) before finalization.** Fixes folded in: schema-before-adapter ordering (avoids a red `typecheck-api`), `baseTpl` track moved to the schema task (it is both a TS excess-property error and a `.strict()` rejection if added earlier), the existing `programs.test.ts` "returns 3 templates" + `validate-cli.test.ts` "3 entries" + `ProgramCatalog.test.tsx` "renders 3 cards" assertions (all go red on the 3→4 template change and are updated here), the `ProgramTemplateDetail.test.tsx` badge mock, and the materializer-test cleanup ordering. **Known spec deviation (surface to reviewer):** the spec sketch prescribes a *vertical* pull on Day A; the authored template covers lats via the 1-arm dumbbell row (`pull_horizontal`) instead, to hold the dumbbells+bench beginner equipment floor — the same call the sibling `full-body-3-day` makes. Documented, deliberate, consistent with precedent.

---

## Context the implementer MUST know (RepOS-specific gotchas)

- **Bash does NOT preserve cwd between calls.** Always use absolute paths or chain with `&&` in one call. API commands run from `/Users/jasonmeyer.ict/Projects/RepOS/api`; frontend from `/Users/jasonmeyer.ict/Projects/RepOS/frontend`.
- **CI gates local `tsc`/`test` MISS** (memory `reference_ci_api_gates_d10_migration`):
  - `typecheck-api` ALSO runs `cd api && npm run lint && npm run format:check` (Prettier!). Run `npm run format` before pushing.
  - `npm test` (api) **EXCLUDES** `tests/integration/**`. Run integration tests separately. `tests/contract/**` and `tests/seed/**` DO run under `npm test`.
  - `migration-gate` (`scripts/check-migration-dryrun.sh`) rejects a migration whose **text (including comments)** matches `DROP TABLE|DROP COLUMN|DROP CONSTRAINT|DROP INDEX|DROP DEFAULT|DROP NOT NULL` unless the PR body has a `Dry-run: http…` line. **Both migrations in this plan are additive (`ADD COLUMN` / `UPDATE` / `SET NOT NULL`) — keep those exact phrases out of the SQL and the comments** and no dry-run link is needed.
- **`as any` test mocks defeat `tsc`.** Frontend template mocks are cast `as any`, so a missing `track` is NOT a type error — it only shows up by *running the tests*. Do not trust a green `tsc` to prove the mocks are updated; run vitest.
- **`main` is branch-protected**: 8 required checks, squash-merge (linear history), 0 approvals. Every change lands via a green PR; aim to keep each commit green.
- **Local test DB**: `postgres://repos:repos_dev_pw@127.0.0.1:5432/repos_test` (`api/.env`). Apply migrations with `cd api && npm run migrate`; seed with `cd api && npm run seed`. Interrupted runs can leave cruft (memory `reference_test_db_cruft`) → reset, don't edit code.
- **Do NOT touch** root `*.jsx` / `RepOS.html` / `Engineering Handoff.md`.
- **Conventional Commits**, frequent small commits per task.

## Verification commands (used throughout)

```bash
# API unit tests (EXCLUDES integration; INCLUDES contract + seed):
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test
# API integration tests (run separately):
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run test:integration
# API lint + format + typecheck (mirrors CI typecheck-api):
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run lint && npm run format:check && npx tsc --noEmit
# Apply migrations / seed the local test DB:
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npm run seed
# Frontend full gate (Prettier + lint + tsc + vitest + custom gates):
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate
```

> Confirm exact script names once via `cd api && cat package.json` (e.g. `test:integration`, `format`/`format:check`).

---

## File Structure (what changes and why)

**New files**
- `api/src/db/migrations/072_program_templates_track_add.sql` — add nullable `track` + backfill existing 3 + catch-all.
- `api/src/db/migrations/073_program_templates_track_notnull.sql` — `ALTER COLUMN track SET NOT NULL` (runs after all insert paths set `track`).

**Modified — API source**
- `api/src/schemas/programTemplate.ts` — add `track` enum to `ProgramTemplateSchema` (required).
- `api/src/types/program.ts` — add `track` to `ProgramTemplateRecord`.
- `api/src/schemas/programs.ts` — add `track` to `ProgramTemplateSummarySchema` (detail extends it).
- `api/src/routes/programs.ts` — `SELECT track` on list + detail; add `?track=` filter (validated).
- `api/src/seed/adapters/programTemplates.ts` — add `track` to the upsert INSERT columns/params + `ON CONFLICT DO UPDATE`.
- `api/src/seed/programTemplates.ts` — add `track` to the 3 existing templates + append `full-body-2-day`.

**Modified — API tests + fixtures** (all direct `INSERT INTO program_templates` must provide `track` before 073; all count/slug assertions move 3→4)
- `api/tests/helpers/program-fixtures.ts` — `mkTemplate`: add optional `track` param + INSERT column.
- `api/tests/helpers/seed-fixtures.ts` — 4 INSERT sites (≈ lines 162, 597, 678, 1032).
- `api/tests/program-schema.test.ts` — INSERTs (≈ lines 66, 75, 84, 93, 111, 129) + new `track` CHECK tests.
- `api/tests/programs.test.ts` — INSERTs (≈ lines 52, 90) + existing "returns 3" test → 4 + list/detail/`?track=` assertions.
- `api/tests/integration/account-deletion-cascade.test.ts` (≈ line 107), `api/tests/integration/contamination/account-deletion-contamination.test.ts` (≈ line 85).
- `api/tests/schemas/programTemplate.test.ts` — add `track` to `validTemplate` + accept/reject tests.
- `api/tests/seed/programTemplates.validator.test.ts` — add `track` to `baseTpl`.
- `api/tests/seed/programTemplates.test.ts` — count 3→4 + slug list.
- `api/tests/seed/programTemplatesEntries.test.ts` — assert `full-body-2-day` present with `track='beginner'`.
- `api/tests/seed/validate-cli.test.ts` — "3 entries" → "4 entries".
- `api/tests/materializeMesocycle.test.ts` — new tests: 2-day structure + the real seeded template materialize to offsets 0/3 across 5 weeks.
- `api/tests/integration/program-template-core-blocks.test.ts` — add `full-body-2-day` to the curated list (asserts its core coverage).

**Modified — frontend**
- `frontend/src/lib/api/programs.ts` — add `track` to `ProgramTemplate` type.
- `frontend/src/components/programs/ProgramCatalog.tsx` — group by track + "More coming" empty state.
- `frontend/src/components/onboarding/steps/ProgramStep.tsx` — group by track (compact).
- `frontend/src/components/programs/ProgramTemplateDetail.tsx` — track badge in header metadata.
- `frontend/src/components/programs/ProgramCatalog.test.tsx` — rewrite mocks + grouping/empty-state assertions.
- `frontend/src/components/programs/ProgramTemplateDetail.test.tsx` — add `track` to mock + assert badge.
- `frontend/src/components/onboarding/__tests__/OnboardingOverlay.test.tsx` — add `track` to mock.

---

## Task ordering rationale (keep the suite green)

`track` is required app-side but the DB column is added nullable first. Order:
1. **072** (nullable + backfill) → green.
2. **Fixtures + standalone test INSERTs** all provide `track` (column still nullable) → green; pre-empts all `NOT NULL` breakage. (Excludes `baseTpl` — see Task 4.)
3. **Types + response schema + route SELECT + `?track=` filter** → green (all rows have `track`).
4. **Zod seed schema requires `track` + classify 3 existing entries + `baseTpl`** → green.
5. **Seed adapter persists `track`** (depends on Task 4's type) → green.
6. **Author + add `full-body-2-day`** (+ seed-count, entries, validate-cli, materializer, core-blocks tests; the existing "returns 3" assertions move to 4) → green.
7. **073** (`SET NOT NULL`) → green (every insert path now sets `track`).
8. **Frontend** grouping + badge + tests → green.
9. **Final verification + independent programming review + PR.**

> **Why schema (Task 4) precedes adapter (Task 5):** the adapter reads `e.track` where `e: ProgramTemplateSeed = z.infer<ProgramTemplateSchema>`. Until Task 4 adds `track` to that schema, `e.track` is a `tsc` (TS2339) error — a standalone adapter commit would fail `typecheck-api`. Re-seeding never nulls existing rows: the adapter's `ON CONFLICT DO UPDATE` only sets listed columns, so before Task 5 the backfilled `track` is preserved.

---

### Task 1: Migration 072 — add nullable `track` + backfill

**Files:**
- Create: `api/src/db/migrations/072_program_templates_track_add.sql`

- [ ] **Step 1: Write the migration**

Create `api/src/db/migrations/072_program_templates_track_add.sql`:

```sql
-- 072_program_templates_track_add.sql
-- First-class experience tracks for program templates (Feature B).
-- D10 EXPAND step: ADDITIVE only. Adds a nullable column and backfills it. The
-- companion 073 migration adds the NOT NULL constraint after every insert path
-- (seed adapter + test fixtures) sets track. Splitting expand/enforce keeps the
-- test suite green and gives prod a safe backfill-before-enforce window.
ALTER TABLE program_templates
  ADD COLUMN track TEXT CHECK (track IN ('beginner','intermediate','advanced'));

-- Classify the three curated v1 templates.
UPDATE program_templates SET track='beginner'     WHERE slug='full-body-3-day';
UPDATE program_templates SET track='intermediate' WHERE slug='upper-lower-4-day';
UPDATE program_templates SET track='intermediate' WHERE slug='strength-cardio-3-2';

-- Catch-all so 073's enforce cannot fail on any legacy/archived row created by an
-- earlier seed generation (the seed archiver leaves old rows in place — this is
-- load-bearing, not merely defensive). Harmless when there are none. 'intermediate'
-- is the neutral default for any stray row.
UPDATE program_templates SET track='intermediate' WHERE track IS NULL;
```

- [ ] **Step 2: Apply migration locally**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate`
Expected: `✓ 072_program_templates_track_add.sql` then `Migrations complete.`

- [ ] **Step 3: Verify column + backfill**

Run:
```bash
PGPASSWORD=repos_dev_pw psql -h 127.0.0.1 -U repos -d repos_test -tAc \
  "SELECT slug, track FROM program_templates ORDER BY slug;"
```
Expected: `full-body-3-day|beginner`, `strength-cardio-3-2|intermediate`, `upper-lower-4-day|intermediate` (no NULLs).

- [ ] **Step 4: Confirm the suite is still green** (nothing requires `track` yet)

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test`
Expected: PASS (no change in counts).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/db/migrations/072_program_templates_track_add.sql && \
  git commit -m "feat(programs): add nullable track column + backfill (expand step)"
```

---

### Task 2: Make every test fixture + standalone test INSERT provide `track`

This pre-empts all `NOT NULL` breakage (Task 7) and guarantees no NULL-`track` rows leak into list/contract responses. The column is still nullable, so this is safe and the suite stays green. **`baseTpl` is intentionally NOT here** — it is a `ProgramTemplateSeed`-typed literal validated by the `.strict()` schema, so adding `track` before Task 4 is both a TS excess-property error and a runtime `.strict()` rejection; it moves to Task 4.

**Files:**
- Modify: `api/tests/helpers/program-fixtures.ts`, `api/tests/helpers/seed-fixtures.ts`
- Modify: `api/tests/program-schema.test.ts`, `api/tests/programs.test.ts`
- Modify: `api/tests/integration/account-deletion-cascade.test.ts`, `api/tests/integration/contamination/account-deletion-contamination.test.ts`

- [ ] **Step 1: `program-fixtures.ts` `mkTemplate` — add `track`**

In `MkTemplateOpts` add `track?: 'beginner' | 'intermediate' | 'advanced';` and update the INSERT to include `track`:

```ts
    `INSERT INTO program_templates (slug, name, weeks, days_per_week, structure, version, created_by, track)
     VALUES ($1, $2, $3, $4, $5::jsonb, 1, 'system', $6) RETURNING id, slug`,
    [
      slug,
      opts.name ?? 'Vitest Template',
      opts.weeks ?? 5,
      opts.daysPerWeek ?? 1,
      JSON.stringify(opts.structure),
      opts.track ?? 'beginner',
    ],
```

- [ ] **Step 2: `seed-fixtures.ts` — add `track` to all 4 template INSERTs**

For each `INSERT INTO program_templates (...)` in this file (≈ lines 162, 597, 678, 1032), add `track` to the column list and a literal `'beginner'`. Example for the `mkFixtureTemplate` insert (≈ line 597):

```ts
    `INSERT INTO program_templates
       (slug, name, weeks, days_per_week, structure, version, created_by, track)
     VALUES ($1, $2, $3, 2, $4::jsonb, $5, 'system', 'beginner')
     RETURNING id`,
```

Apply the same `track`-column addition to the other three INSERTs (keep their existing params; append `'beginner'` literal in the column list + VALUES).

- [ ] **Step 3: `program-schema.test.ts` — add `track` to the INSERTs**

There are 6 INSERTs. The **success** cases — `test-valid-template` (≈ line 111) and the cascade insert (≈ line 129) — MUST include `track` (they will violate `NOT NULL` after 073 otherwise). Add `track` + a literal value:

```ts
`INSERT INTO program_templates (slug, name, weeks, days_per_week, structure, track)
 VALUES ('test-valid-template','Valid', 5, 3, '{"_v":1,"days":[]}'::jsonb, 'beginner')
 RETURNING version, created_by`,
```

The **rejection** cases (≈ lines 66 bad slug, 75 weeks>16, 84, 93 bad `created_by`) already `.rejects.toThrow()` for other reasons. Add `track` to them too so that after 073 they still throw for the *intended* reason, not an incidental missing-`track` error. (While the column is nullable they pass either way.)

- [ ] **Step 4: `programs.test.ts` — add `track` to the 2 INSERTs**

≈ line 52 (`vitest-archived-tmpl`) and ≈ line 90: add `track` column + `'beginner'` literal:

```ts
`INSERT INTO program_templates
 (slug, name, weeks, days_per_week, structure, archived_at, track)
 VALUES ('vitest-archived-tmpl', 'Archived', 4, 3, '{"_v":1,"days":[]}'::jsonb, now(), 'beginner')
 RETURNING id`,
```

- [ ] **Step 5: account-deletion INSERTs**

In `account-deletion-cascade.test.ts` (≈ line 107) and `contamination/account-deletion-contamination.test.ts` (≈ line 85), add `track` to the `INSERT INTO program_templates (...)` column list + `'beginner'` value.

- [ ] **Step 6: Run the affected suites**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/tests && \
  git commit -m "test(programs): thread track through program_templates fixtures + inserts"
```

---

### Task 3: Wire-record type + REST response schema + route SELECT + `?track=` filter

**Files:**
- Modify: `api/src/types/program.ts`, `api/src/schemas/programs.ts`, `api/src/routes/programs.ts`
- Test: `api/tests/programs.test.ts`, `api/tests/contract/programs.contract.test.ts`

- [ ] **Step 1 (test first): list/detail return `track` + `?track=` filters**

In `api/tests/programs.test.ts`, add after the existing list test:

```ts
it('list returns a track on every template', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/program-templates' });
  expect(r.statusCode).toBe(200);
  const body = r.json<{ templates: { slug: string; track: string }[] }>();
  expect(body.templates.length).toBeGreaterThanOrEqual(3);
  for (const t of body.templates) {
    expect(['beginner', 'intermediate', 'advanced']).toContain(t.track);
  }
});

it('?track=intermediate returns only intermediate templates', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/program-templates?track=intermediate' });
  expect(r.statusCode).toBe(200);
  const body = r.json<{ templates: { slug: string; track: string }[] }>();
  expect(body.templates.length).toBeGreaterThan(0);
  expect(body.templates.every((t) => t.track === 'intermediate')).toBe(true);
});

it('?track=bogus returns 400 with actionable error', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/program-templates?track=bogus' });
  expect(r.statusCode).toBe(400);
  expect(r.json<{ error: string }>().error).toMatch(/track/i);
});

it('detail returns a track', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/program-templates/full-body-3-day' });
  expect(r.statusCode).toBe(200);
  expect(r.json<{ track: string }>().track).toBe('beginner');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/programs.test.ts`
Expected: FAIL (route doesn't select/filter `track`; `?track=bogus` is 200 not 400).

- [ ] **Step 3: `types/program.ts` — add `track`**

In `ProgramTemplateRecord` (after `days_per_week`):

```ts
  track: 'beginner' | 'intermediate' | 'advanced';
```

- [ ] **Step 4: `schemas/programs.ts` — add `track` to the summary schema**

In `ProgramTemplateSummarySchema` (after `days_per_week`):

```ts
  track: z.enum(['beginner', 'intermediate', 'advanced']),
```

(`ProgramTemplateDetailResponseSchema` extends the summary, so detail gets `track` automatically.)

- [ ] **Step 5: `routes/programs.ts` — SELECT `track` + `?track=` filter**

Replace the list handler with a validated optional `track` filter:

```ts
  app.get<{ Querystring: { track?: string } }>('/program-templates', async (req, reply) => {
    const track = req.query.track;
    if (track !== undefined && !['beginner', 'intermediate', 'advanced'].includes(track)) {
      reply.code(400);
      return { error: 'track must be one of beginner|intermediate|advanced', field: 'track' };
    }
    const { rows } = await db.query(
      `SELECT id, slug, name, description, weeks, days_per_week, track, version, created_at
       FROM program_templates
       WHERE archived_at IS NULL
         AND ($1::text IS NULL OR track = $1)
       ORDER BY slug ASC`,
      [track ?? null],
    );
    reply.header('cache-control', 'public, max-age=300');
    const listResp: ProgramTemplateListResponse = { templates: rows };
    return listResp;
  });
```

And add `track` to the detail SELECT (after `days_per_week`):

```ts
      `SELECT id, slug, name, description, weeks, days_per_week, track, structure, version,
              seed_key, seed_generation, created_at
       FROM program_templates
       WHERE slug=$1 AND archived_at IS NULL`,
```

> The response routes return raw DB rows (no Fastify response schema), and the contract test parses them with `ProgramTemplateListResponseSchema` (which now *requires* `track`). Steps 4 + 5 MUST land in the same commit, and all live rows already carry `track` (072 backfill) — so the contract test stays green.

- [ ] **Step 6: Run tests**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/programs.test.ts tests/contract/programs.contract.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint/format/typecheck + commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run lint && npm run format && npx tsc --noEmit
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/types/program.ts api/src/schemas/programs.ts api/src/routes/programs.ts api/tests/programs.test.ts && \
  git commit -m "feat(programs): return track on list/detail + add ?track= filter"
```

---

### Task 4: Zod seed schema requires `track` + classify the 3 existing seeds

> **Must precede Task 5 (adapter).** See the ordering rationale above.

**Files:**
- Modify: `api/src/schemas/programTemplate.ts`, `api/src/seed/programTemplates.ts`
- Test: `api/tests/schemas/programTemplate.test.ts`, `api/tests/seed/programTemplates.validator.test.ts`

- [ ] **Step 1 (test first): schema accepts/rejects `track`**

In `api/tests/schemas/programTemplate.test.ts`, add `track: 'beginner',` to the `validTemplate` object, then add:

```ts
it('accepts each track value', () => {
  for (const track of ['beginner', 'intermediate', 'advanced'] as const) {
    expect(ProgramTemplateSchema.safeParse({ ...validTemplate, track }).success).toBe(true);
  }
});

it('rejects an unknown track', () => {
  const r = ProgramTemplateSchema.safeParse({ ...validTemplate, track: 'expert' });
  expect(r.success).toBe(false);
  if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/track/);
});

it('rejects a template with no track', () => {
  const { track, ...noTrack } = validTemplate as typeof validTemplate & { track: string };
  expect(ProgramTemplateSchema.safeParse(noTrack).success).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/schemas/programTemplate.test.ts`
Expected: FAIL (`.strict()` rejects the `track` key today; no-track case still passes).

- [ ] **Step 3: Add `track` to `ProgramTemplateSchema`**

In `api/src/schemas/programTemplate.ts`, INSIDE the `.object({...})` and **before** the `.strict()` (i.e. after the `days_per_week` line, not after `.strict()`):

```ts
    track: z.enum(['beginner', 'intermediate', 'advanced']),
```

- [ ] **Step 4: Classify the 3 existing seed entries**

In `api/src/seed/programTemplates.ts`, add the `track` field to each existing template object (top-level, alongside `slug`/`name`):
- `full-body-3-day` → `track: 'beginner',`
- `upper-lower-4-day` → `track: 'intermediate',`
- `strength-cardio-3-2` → `track: 'intermediate',`

- [ ] **Step 5: Add `track` to the validator `baseTpl`**

In `api/tests/seed/programTemplates.validator.test.ts`, add `track: 'beginner',` to the `baseTpl: ProgramTemplateSeed` literal (now required by the schema, and now valid since the type carries `track`).

- [ ] **Step 6: Run schema + entries + validator tests**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/schemas/programTemplate.test.ts tests/seed/`
Expected: PASS (entries test still 3 templates; the 4th is added in Task 6).

- [ ] **Step 7: Lint/format/typecheck + commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run lint && npm run format && npx tsc --noEmit
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/schemas/programTemplate.ts api/src/seed/programTemplates.ts api/tests/schemas/programTemplate.test.ts api/tests/seed/programTemplates.validator.test.ts && \
  git commit -m "feat(programs): require track in template schema + classify v1 seeds"
```

---

### Task 5: Seed adapter persists `track`

**Files:**
- Modify: `api/src/seed/adapters/programTemplates.ts`
- Test: `api/tests/seed/programTemplates.test.ts`

- [ ] **Step 1 (test first): `track` round-trips through `upsertOne`**

In `api/tests/seed/programTemplates.test.ts`, add (uses the file's existing `loadKnownSlugs()` + `runSeed` + `makeProgramTemplateAdapter` imports):

```ts
it('persists track through upsertOne', async () => {
  const { all, cardio } = await loadKnownSlugs();
  const entry = {
    slug: 'vitest-track-rt',
    name: 'Track RT',
    description: '',
    weeks: 1,
    days_per_week: 1,
    track: 'advanced' as const,
    structure: {
      _v: 1 as const,
      days: [
        {
          idx: 0,
          day_offset: 0,
          kind: 'strength' as const,
          name: 'D',
          blocks: [
            {
              exercise_slug: 'dumbbell-curl',
              mev: 2,
              mav: 3,
              target_reps_low: 8,
              target_reps_high: 12,
              target_rir: 2,
              rest_sec: 90,
            },
          ],
        },
      ],
    },
  };
  try {
    await runSeed({
      key: 'vitest_track_rt',
      entries: [entry],
      adapter: makeProgramTemplateAdapter(all, cardio),
    });
    const { rows } = await db.query<{ track: string }>(
      `SELECT track FROM program_templates WHERE slug='vitest-track-rt'`,
    );
    expect(rows[0].track).toBe('advanced');
  } finally {
    await db.query(`DELETE FROM program_templates WHERE slug='vitest-track-rt'`);
    await db.query(`DELETE FROM _seed_meta WHERE key='vitest_track_rt'`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/seed/programTemplates.test.ts -t "persists track"`
Expected: FAIL (`track` is NULL — adapter doesn't write it).

- [ ] **Step 3: Add `track` to the adapter upsert**

In `api/src/seed/adapters/programTemplates.ts` `upsertOne`, update the INSERT to include `track`:

```ts
      await tx.query(
        `INSERT INTO program_templates (
           slug, name, description, weeks, days_per_week, structure, version,
           created_by, seed_key, seed_generation, archived_at, updated_at, track
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'system',$8,$9,NULL,now(),$10)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name,
           description=EXCLUDED.description,
           weeks=EXCLUDED.weeks,
           days_per_week=EXCLUDED.days_per_week,
           structure=EXCLUDED.structure,
           version=EXCLUDED.version,
           seed_key=EXCLUDED.seed_key,
           seed_generation=EXCLUDED.seed_generation,
           archived_at=NULL,
           updated_at=now(),
           track=EXCLUDED.track`,
        [
          e.slug,
          e.name,
          e.description ?? '',
          e.weeks,
          e.days_per_week,
          JSON.stringify(e.structure),
          nextVersion,
          'program_templates',
          generation,
          e.track,
        ],
      );
```

> `e.track` is typed (Task 4 added it to `ProgramTemplateSeed`). The `track=EXCLUDED.track` clause means the re-seed that fires on deploy (adding `track` changes the seed hash) corrects `track` on every existing row.

- [ ] **Step 4: Run tests + lint/format/typecheck**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npx vitest run tests/seed/programTemplates.test.ts && npm run lint && npm run format && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/seed/adapters/programTemplates.ts api/tests/seed/programTemplates.test.ts && \
  git commit -m "feat(seed): persist track through program-template upsert"
```

---

### Task 6: Author + add the `full-body-2-day` beginner template

The template below was authored and adversarially reviewed by a strength-programming judge panel (3 candidates → 3 diverse-lens judges → synthesis → adversarial validation) per spec Feature B, then independently re-validated in this session against the real `ProgramTemplateSchema` (PASS) with all 11 slugs confirmed in `exercises.ts`.

**Files:**
- Modify: `api/src/seed/programTemplates.ts`
- Test: `api/tests/seed/programTemplates.test.ts`, `api/tests/seed/programTemplatesEntries.test.ts`, `api/tests/seed/validate-cli.test.ts`, `api/tests/programs.test.ts`, `api/tests/materializeMesocycle.test.ts`, `api/tests/integration/program-template-core-blocks.test.ts`

- [ ] **Step 1: Append the new template to the seed array**

In `api/src/seed/programTemplates.ts`, append this object to the `programTemplates` array (after `strength-cardio-3-2`):

```ts
  {
    slug: 'full-body-2-day',
    name: 'Full Body 2-Day Foundation',
    description:
      'Two full-body sessions per week (Mon/Thu) for a true beginner training twice weekly. Day A is squat-emphasis, Day B is hinge-emphasis. Short, learnable sessions built only from low-skill dumbbell movements plus bodyweight core. Quads, chest, back, and core each get the full-body 2x/week advantage; lats are trained directly via the 1-arm dumbbell row (a vertical-pull machine or pull-up bar is intentionally not required, to hold the beginner equipment floor — the same call full-body-3-day makes). Equipment minimum: dumbbells + adjustable bench.',
    weeks: 5,
    days_per_week: 2,
    track: 'beginner',
    structure: {
      _v: 1,
      days: [
        {
          idx: 0,
          day_offset: 0,
          kind: 'strength',
          name: 'Full Body A — Squat',
          blocks: [
            {
              exercise_slug: 'dumbbell-goblet-squat',
              mev: 3,
              mav: 5,
              target_reps_low: 8,
              target_reps_high: 10,
              target_rir: 3,
              rest_sec: 150,
            },
            {
              exercise_slug: 'dumbbell-bench-press',
              mev: 3,
              mav: 5,
              target_reps_low: 8,
              target_reps_high: 10,
              target_rir: 3,
              rest_sec: 150,
            },
            {
              exercise_slug: 'chest-supported-dumbbell-row',
              mev: 3,
              mav: 5,
              target_reps_low: 8,
              target_reps_high: 12,
              target_rir: 2,
              rest_sec: 120,
            },
            {
              exercise_slug: 'dumbbell-shoulder-press-seated',
              mev: 2,
              mav: 4,
              target_reps_low: 8,
              target_reps_high: 12,
              target_rir: 2,
              rest_sec: 120,
            },
            {
              exercise_slug: 'dead-bug',
              mev: 2,
              mav: 4,
              target_reps_low: 8,
              target_reps_high: 12,
              target_rir: 2,
              rest_sec: 60,
            },
          ],
        },
        {
          idx: 1,
          day_offset: 3,
          kind: 'strength',
          name: 'Full Body B — Hinge',
          blocks: [
            {
              exercise_slug: 'dumbbell-romanian-deadlift',
              mev: 3,
              mav: 5,
              target_reps_low: 8,
              target_reps_high: 12,
              target_rir: 3,
              rest_sec: 150,
            },
            {
              exercise_slug: 'dumbbell-reverse-lunge',
              mev: 2,
              mav: 4,
              target_reps_low: 8,
              target_reps_high: 12,
              target_rir: 2,
              rest_sec: 120,
            },
            {
              exercise_slug: 'incline-dumbbell-bench-press',
              mev: 2,
              mav: 4,
              target_reps_low: 8,
              target_reps_high: 12,
              target_rir: 3,
              rest_sec: 120,
            },
            {
              exercise_slug: 'dumbbell-row-1arm',
              mev: 3,
              mav: 5,
              target_reps_low: 8,
              target_reps_high: 12,
              target_rir: 2,
              rest_sec: 120,
            },
            {
              exercise_slug: 'dumbbell-standing-calf-raise',
              mev: 2,
              mav: 3,
              target_reps_low: 10,
              target_reps_high: 15,
              target_rir: 2,
              rest_sec: 75,
            },
            {
              exercise_slug: 'side-plank',
              mev: 2,
              mav: 4,
              target_reps_low: 8,
              target_reps_high: 15,
              target_rir: 2,
              rest_sec: 60,
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 2 (test): seed loads 4 templates incl. the new slug**

In `api/tests/seed/programTemplates.test.ts`, in the first-run test: change `expect(r.upserted).toBe(3)` → `toBe(4)` and update the expected slug array to (sorted ASC):

```ts
expect(rows.map((r) => r.slug)).toEqual([
  'full-body-2-day',
  'full-body-3-day',
  'strength-cardio-3-2',
  'upper-lower-4-day',
]);
```

- [ ] **Step 3 (test): entries test asserts the new template**

In `api/tests/seed/programTemplatesEntries.test.ts` (already imports `ProgramTemplateSeedSchema`), add:

```ts
it('includes full-body-2-day: beginner, 5 weeks, 2 days/week on offsets [0,3]', () => {
  const t = programTemplates.find((p) => p.slug === 'full-body-2-day');
  expect(t).toBeDefined();
  expect(t!.track).toBe('beginner');
  expect(t!.weeks).toBe(5);
  expect(t!.days_per_week).toBe(2);
  expect(t!.structure.days.map((d) => d.day_offset)).toEqual([0, 3]);
  expect(ProgramTemplateSeedSchema.safeParse(t).success).toBe(true);
});
```

- [ ] **Step 4 (test): fix the two existing 3→4 count assertions**

- `api/tests/programs.test.ts` — the existing "returns 3 non-archived templates" test (≈ lines 37, 39): change `expect(body.templates.length).toBe(3)` → `toBe(4)` and the slug array to `['full-body-2-day','full-body-3-day','strength-cardio-3-2','upper-lower-4-day']`. (The `cardio` assertion on `strength-cardio-3-2` stays valid.)
- `api/tests/seed/validate-cli.test.ts` (≈ line 11): change the `/program_templates OK · 3 entries/` assertion to `/program_templates OK · 4 entries/`.

- [ ] **Step 5 (test): materialization lands on Mon + Thu across 5 weeks**

In `api/tests/materializeMesocycle.test.ts`, import `addDaysISO` from `'../src/services/_dateUtil.js'`. Declare the fixture ids at MODULE scope and clean them up in the **existing top-level `afterAll`** (which calls `db.end()` last) — do NOT add a new `describe`-level `afterAll` (Vitest LIFO ordering makes a closed-pool error possible). Add this `describe`:

```ts
describe('full-body-2-day style template materializes to offsets 0 and 3', () => {
  let uId2: string;
  let tId2: string;
  let upId2: string;
  const STRUCT_2DAY = {
    _v: 1,
    days: [
      { idx: 0, day_offset: 0, kind: 'strength', name: 'Full Body A', blocks: [
        { exercise_slug: 'dumbbell-goblet-squat', mev: 2, mav: 4, target_reps_low: 8, target_reps_high: 12, target_rir: 2, rest_sec: 150 } ] },
      { idx: 1, day_offset: 3, kind: 'strength', name: 'Full Body B', blocks: [
        { exercise_slug: 'dumbbell-romanian-deadlift', mev: 2, mav: 4, target_reps_low: 8, target_reps_high: 12, target_rir: 2, rest_sec: 150 } ] },
    ],
  };

  beforeAll(async () => {
    const u = await mkUser({ prefix: 'vitest.materialize.2day' });
    uId2 = u.id;
    const t = await mkTemplate({ prefix: 'vitest-2day', name: '2-day', weeks: 5, daysPerWeek: 2, structure: STRUCT_2DAY });
    tId2 = t.id;
    const up = await mkUserProgram({ userId: uId2, templateId: tId2, name: '2-day run' });
    upId2 = up.id;
  });

  it('produces 10 day_workouts on start (offset 0) and start+3 (offset 3) each week', async () => {
    const start = '2026-05-04'; // a Monday
    const { run_id } = await materializeMesocycle({ userProgramId: upId2, startDate: start, startTz: 'America/New_York' });
    const { rows } = await db.query<{ week_idx: number; day_idx: number; scheduled_date: string }>(
      `SELECT week_idx, day_idx, scheduled_date FROM day_workouts WHERE mesocycle_run_id=$1 ORDER BY week_idx, day_idx`,
      [run_id],
    );
    expect(rows.length).toBe(10);
    const iso = (d: unknown) => String(d).slice(0, 10);
    for (let w = 1; w <= 5; w++) {
      const mon = rows.find((r) => r.week_idx === w && r.day_idx === 0)!;
      const thu = rows.find((r) => r.week_idx === w && r.day_idx === 1)!;
      expect(iso(mon.scheduled_date)).toBe(addDaysISO(start, (w - 1) * 7 + 0));
      expect(iso(thu.scheduled_date)).toBe(addDaysISO(start, (w - 1) * 7 + 3));
    }
  });
});
```

Then add `cleanupUser(uId2)` / `cleanupTemplate(tId2)` to the file's existing top-level `afterAll` (alongside the current cleanup, before `db.end()`). Confirm `mkUser/mkTemplate/mkUserProgram/cleanupUser/cleanupTemplate` are already imported (they are).

- [ ] **Step 6 (test): core-block coverage includes the new template**

In `api/tests/integration/program-template-core-blocks.test.ts`, add `'full-body-2-day'` to the `CURATED` slug list (so the test asserts the new template also carries a core block — it has `dead-bug` + `side-plank`). Run the file to confirm it passes; if its assertion shape doesn't fit, leave the list at 3 and note why.

- [ ] **Step 7: Run all affected suites**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npm run seed && npm test && npm run test:integration`
Expected: PASS. (`npm run seed` ensures the local test DB has the 4th template for the route/contract tests.)

- [ ] **Step 8: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/seed/programTemplates.ts api/tests && \
  git commit -m "feat(programs): author beginner full-body-2-day template (5wk, Mon/Thu)"
```

---

### Task 7: Migration 073 — enforce `NOT NULL`

**Files:**
- Create: `api/src/db/migrations/073_program_templates_track_notnull.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 073_program_templates_track_notnull.sql
-- D10 ENFORCE step for the track column added in 072. Additive constraint only:
-- every insert path (seed adapter + every test fixture) now sets track, and 072
-- backfilled all pre-existing rows, so enforcing the constraint cannot fail.
ALTER TABLE program_templates ALTER COLUMN track SET NOT NULL;
```

> Migration-gate: this file contains `SET NOT NULL` (additive), NOT `DROP NOT NULL`. No destructive phrase appears anywhere → gate passes without a dry-run link.

- [ ] **Step 2: Apply locally + verify**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && \
PGPASSWORD=repos_dev_pw psql -h 127.0.0.1 -U repos -d repos_test -tAc \
  "SELECT is_nullable FROM information_schema.columns WHERE table_name='program_templates' AND column_name='track';"
```
Expected: `✓ 073_...` then `NO`.

- [ ] **Step 3: Full API suite green under NOT NULL**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test && npm run test:integration`
Expected: PASS (proves every INSERT path provides `track`).

- [ ] **Step 4: Migration-gate dry check (simulate CI)**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS && CHANGED_FILES="api/src/db/migrations/072_program_templates_track_add.sql api/src/db/migrations/073_program_templates_track_notnull.sql" bash scripts/check-migration-dryrun.sh`
Expected: `OK: migration(s) are additive (no destructive step) — dry-run link not required`.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add api/src/db/migrations/073_program_templates_track_notnull.sql && \
  git commit -m "feat(programs): enforce NOT NULL on track (contract step)"
```

---

### Task 8: Frontend — `track` type, catalog grouping, onboarding grouping, detail badge

**Files:**
- Modify: `frontend/src/lib/api/programs.ts`, `frontend/src/components/programs/ProgramCatalog.tsx`, `frontend/src/components/onboarding/steps/ProgramStep.tsx`, `frontend/src/components/programs/ProgramTemplateDetail.tsx`
- Test: `frontend/src/components/programs/ProgramCatalog.test.tsx`, `frontend/src/components/programs/ProgramTemplateDetail.test.tsx`, `frontend/src/components/onboarding/__tests__/OnboardingOverlay.test.tsx`

> Reminder: list/detail test mocks are cast `as any`, so missing `track` won't fail `tsc` — it fails by *rendering wrong*. Rely on vitest, not typecheck, to prove these.

- [ ] **Step 1: `ProgramTemplate` type — add `track`**

In `frontend/src/lib/api/programs.ts`, add to the `ProgramTemplate` type (after `days_per_week`):

```ts
  track: 'beginner' | 'intermediate' | 'advanced';
```

(No production consumer constructs a `ProgramTemplate` literal — they only read it from the API client — so making it required breaks no consumer. Only test mocks need updating, below.)

- [ ] **Step 2 (test first): rewrite catalog test for grouping + "More coming"**

In `frontend/src/components/programs/ProgramCatalog.test.tsx`, replace the `beforeEach` mock with a representative post-PR set (2 beginner, 2 intermediate, 0 advanced) and replace the existing "renders 3 cards" test:

```ts
vi.spyOn(api, 'listProgramTemplates').mockResolvedValue([
  { id: '1', slug: 'full-body-2-day', name: 'Full Body 2-Day Foundation', description: 'b', weeks: 5, days_per_week: 2, version: 1, track: 'beginner' },
  { id: '2', slug: 'full-body-3-day', name: 'Full Body 3-Day Foundation', description: 'b', weeks: 5, days_per_week: 3, version: 1, track: 'beginner' },
  { id: '3', slug: 'upper-lower-4-day', name: 'Upper/Lower 4-Day Hypertrophy', description: 'i', weeks: 5, days_per_week: 4, version: 1, track: 'intermediate' },
  { id: '4', slug: 'strength-cardio-3-2', name: 'Strength + Z2 3+2', description: 'i', weeks: 5, days_per_week: 5, version: 1, track: 'intermediate' },
] as any);
```

```ts
import { render, screen, within } from '@testing-library/react';

it('renders all template cards grouped under track headings', async () => {
  render(<ProgramCatalog onPick={vi.fn()} />);
  expect(await screen.findByText(/Full Body 2-Day Foundation/)).toBeInTheDocument();
  expect(screen.getByText(/Full Body 3-Day Foundation/)).toBeInTheDocument();
  expect(screen.getByText(/Upper\/Lower 4-Day Hypertrophy/)).toBeInTheDocument();
  expect(screen.getByText(/Strength \+ Z2 3\+2/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Beginner/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Intermediate/i })).toBeInTheDocument();
});

it('shows a "More coming" state for the empty Advanced track', async () => {
  render(<ProgramCatalog onPick={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: /Advanced/i })).toBeInTheDocument();
  expect(screen.getByText(/More coming/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npx vitest run src/components/programs/ProgramCatalog.test.tsx`
Expected: FAIL (no track headings / "More coming").

- [ ] **Step 4: Implement grouping in `ProgramCatalog.tsx`**

Replace the render body so templates are grouped into the three tracks in fixed order with `<h3>` headings and an on-brand glass "More coming" empty card (match the existing card surface — `#10141C` bg, `1px solid rgba(255,255,255,0.08)` border — not a dashed placeholder). Move the existing `<article>…</article>` card JSX verbatim into `group.map`; keep the loading/error returns above unchanged:

```tsx
const TRACKS: { key: 'beginner' | 'intermediate' | 'advanced'; label: string }[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

return (
  <div style={{ padding: 16, fontFamily: 'Inter Tight', display: 'flex', flexDirection: 'column', gap: 28 }}>
    {TRACKS.map(({ key, label }) => {
      const group = rows.filter((t) => t.track === key);
      return (
        <section key={key}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', fontFamily: 'JetBrains Mono' }}>
            {label}
          </h3>
          {group.length === 0 ? (
            <div style={{ padding: 20, background: '#10141C', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
              More coming — new {label} programs are on the way.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {group.map((t) => (
                /* ... existing <article> card markup, unchanged ... */
              ))}
            </div>
          )}
        </section>
      );
    })}
  </div>
);
```

- [ ] **Step 5: Onboarding `ProgramStep.tsx` — group by track (compact)**

Replace the flat `templates.slice(0, 4)` list with track groups (Beginner first), rendering only non-empty tracks to keep onboarding short, each under a small mono `<h4>` heading (use a heading element, not a `<div>`, for a11y). Keep the existing `<Link>` row markup, the "BROWSE PROGRAMS" / "Skip for now" footer, and the loading state:

```tsx
const ORDER: Array<'beginner' | 'intermediate' | 'advanced'> = ['beginner', 'intermediate', 'advanced'];
// replace the slice(0,4) block:
<div style={{ display: 'grid', gap: 14 }}>
  {ORDER.map((track) => {
    const group = templates.filter((t) => t.track === track);
    if (group.length === 0) return null;
    return (
      <div key={track}>
        <h4 style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: TOKENS.textMute, margin: '0 0 6px', fontWeight: 600 }}>
          {track}
        </h4>
        <div style={{ display: 'grid', gap: 8 }}>
          {group.map((t) => (
            /* ... existing <Link> row markup, unchanged ... */
          ))}
        </div>
      </div>
    );
  })}
</div>
```

(`FONTS.mono` and `TOKENS.textMute` both exist in `frontend/src/tokens.ts`.)

- [ ] **Step 6: `ProgramTemplateDetail.tsx` — track badge**

The header metadata line is currently `{t.weeks}-week <Term k="mesocycle" /> · {t.days_per_week} days/wk`. Append the track unconditionally (`track` is required on the type — no guard needed):

```tsx
{t.weeks}-week <Term k="mesocycle" /> · {t.days_per_week} days/wk · {t.track.toUpperCase()}
```

- [ ] **Step 7: Update detail + onboarding test mocks**

- `frontend/src/components/programs/ProgramTemplateDetail.test.tsx`: add `track: 'intermediate'` to the mocked template object and assert the badge renders (`expect(screen.getByText(/INTERMEDIATE/)).toBeInTheDocument()`).
- `frontend/src/components/onboarding/__tests__/OnboardingOverlay.test.tsx`: add `track: 'beginner'` to each mocked template object (the step-navigation assertions — `STEP 4 / 5`, "Skip for now" — are unaffected by grouping).

- [ ] **Step 8: Grep for any other `ProgramTemplate` list mock that needs `track`**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && grep -rn "listProgramTemplates" src --include=*.test.tsx --include=*.test.ts`
For each hit that mocks a template list, ensure each object has `track`. (Known: ProgramCatalog, OnboardingOverlay; `lib/api/programs.test.ts` casts via generics — no `track` needed there. Verify exhaustively; don't assume.)

- [ ] **Step 9: Frontend validate**

Run: `cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate`
Expected: PASS (Prettier + lint + tsc + vitest + custom gates).

- [ ] **Step 10: Commit**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git add frontend/src && \
  git commit -m "feat(frontend): group program catalog + onboarding by track"
```

---

### Task 9: Final verification, independent programming review, and PR

- [ ] **Step 1: Full local gate (mirror CI)**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run migrate && npm run seed && npm run lint && npm run format:check && npx tsc --noEmit && npm test && npm run test:integration
cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm run validate
```
Expected: all green.

- [ ] **Step 2: Independent programming review of the authored template** (spec requirement)

Dispatch a fresh strength-programming reviewer over the final `full-body-2-day` seed entry (movement balance, beginner appropriateness, weekly frequency, rep/RIR/rest, equipment accessibility, schema validity). Inputs to weigh (already-known, deliberate concerns from the authoring panel): vertical-pull *pattern* covered by proxy (1-arm row; matches `full-body-3-day`); no direct arm isolation (short-session tradeoff); Day A=5 / Day B=6 blocks; `mev/mav` one notch above the 3-day sibling (relative weights only); glutes trained as a secondary mover. Fix any Critical/Important finding before merge ("ship clean"); record the verdict in the PR description.

- [ ] **Step 3: Adversarial diff review** (per PR1 process — caught 3 real bugs there)

Run a multi-dimension adversarial review over the full PR diff (correctness, migration safety, schema/contract drift, test coverage, frontend a11y/empty-states, security). Resolve all Critical + Important findings.

- [ ] **Step 4: Open the PR**

```bash
cd /Users/jasonmeyer.ict/Projects/RepOS && git push -u origin <branch> && \
gh pr create --title "feat(programs): first-class tracks + beginner 2-day template" --body "<summary + acceptance + template review verdict + the documented vertical-pull deviation>"
```

- [ ] **Step 5: Confirm CI**

Run: `gh pr checks --watch` then **re-run `gh pr checks`** to confirm (`--watch` can exit 0 with a check pending). All 8 required checks green.

- [ ] **Step 6: Merge (squash) + deploy + verify**

After merge: wait for the `docker` workflow (build `:latest`), then `ssh unraid /mnt/user/appdata/repos/repos-redeploy.sh` (backs up, recreates, migrates, seeds). Verify outside-in **from the dev mac** (not the Unraid host — macvlan):
```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://repos.jpmtech.com   # expect 302 (CF Access)
ssh unraid 'docker exec RepOS bash -c '\''s6-setuidgid postgres /usr/bin/psql -h /tmp -U postgres -d "$POSTGRES_DB" -tAc "SELECT slug, track FROM program_templates ORDER BY slug;"'\'''
```
Expected: 4 templates, `full-body-2-day|beginner` present, `track` NOT NULL.

---

## Acceptance criteria (spec Feature B)

- [ ] Catalog + onboarding group templates by track (Beginner default/first).
- [ ] A Beginner `full-body-2-day` template exists, forks, and materializes to Mon/Thu (offsets 0/3) across the 5-week block (proven by the materializer test).
- [ ] The empty Advanced track shows a "More coming" state (not a dead/empty tab).
- [ ] `GET /api/program-templates` and `/:slug` return `track`; `?track=` filters; unknown `track` → 400.
- [ ] `track` is `NOT NULL` in prod; the new template is live and seeded.

## Self-review notes

- **Spec coverage:** data model (Tasks 1,3,4,5,7), new template (Task 6), UX grouping + "More coming" (Task 8), API filter + payload (Task 3), materialization proof (Task 6). All Feature B bullets mapped.
- **Spec deviation (surfaced, not buried):** spec sketch prescribes a vertical pull on Day A; template covers lats via 1-arm row (`pull_horizontal`) to hold the dumbbells+bench floor — matches `full-body-3-day`. Approved by the authoring panel; flagged in the PR body.
- **`track` tooltip:** intentionally NOT added. Beginner/Intermediate/Advanced are plain English, not terms-of-art like RPE/MEV; adding registry entries would expand scope without user value, and `check-term-coverage.mjs` is not triggered (no new TERMS keys).
- **Cardio orthogonality:** `strength-cardio-3-2` classified by experience (`intermediate`), not a cardio "track" — matches spec.
- **Out of scope (Feature C / PR2):** duration estimation. Not in this PR.
