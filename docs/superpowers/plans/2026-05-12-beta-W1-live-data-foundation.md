# Beta W1 — Live data foundation (set_logs API + Live Logger UI + Workouts ingest) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the live workout logger end-to-end. By wave-close: a Beta user signs in, starts a mesocycle, opens the mobile logger, logs sets (offline-tolerant via IndexedDB queue), and the rows feed downstream volume + recovery-flag evaluators that W3 wires up. Also ship Apple Health Workouts ingest (mirrors the alpha weight-sync path) and the iOS Shortcut authoring runbook.

**Architecture:** Five sub-tasks. **Backend (W1.1, W1.2, W1.4)**: schema migration extends the alpha `set_logs` table; new `set_logs` CRUD route file; new `health_workouts` table + ingest route. **Frontend (W1.3)**: an offline-tolerant `<TodayLoggerMobile>` built on a Dexie-backed `idb-queue` library + an in-memory `log-buffer`; eight offline scenarios (O1–O8) ship as part of W1.3 with Playwright + IndexedDB-inspection coverage. **Glue (W1.5)**: one end-to-end Playwright case proving the W1→W3 data flow (set-log POSTs surface the W3 overreaching evaluator).

**Tech stack:** Unchanged. Fastify 5 + TypeScript + Postgres 16 (`api/`); Vite 5 + React 18 + TypeScript + Vitest + Playwright (`frontend/`). New deps: `dexie ^4.0.0` (IndexedDB wrapper) for `frontend/`; no new `api/` deps (uses existing `pg`, `zod`, `pino`).

**Master plan:** `docs/superpowers/plans/2026-05-11-repos-beta.md` — W1 task surface at lines 202–246. Appendix-A W1 nits at lines 601–606 are absorbed inline below.

---

## Phase ordering (read before starting)

```
W1.1 (schema 029)
  ↓
W1.2 (set-logs CRUD routes)        ←─ depends on W1.1
  ↓
W1.4 (workouts ingest)             ←─ parallelizable with W1.2 after W1.1
  ↓
W1.3 (TodayLoggerMobile + O1–O8)   ←─ depends on W1.2 (consumes POST /api/set-logs)
  ↓
W1.5 (e2e Playwright)              ←─ depends on W1.2 + W1.3
  ↓
EOP (CI + PR + merge)
```

**Why this order:** Backend lands first so the frontend can integrate against real endpoints. W1.4 parallelizes with W1.2 — they share no code and are independent test surfaces. W1.3 is the longest task (offline-scenario matrix); it cannot start until W1.2's POST endpoint is at least a green stub.

**Branch:** `beta/w1-live-data-foundation`. Single PR target; the wave is large enough that we may split into `beta/w1-backend` + `beta/w1-frontend` if W1.3 review velocity warrants — final call after W1.4 lands.

**Sequencing memory** (from W0): inline execution on a regular branch in the main project dir (no worktree per user preference). Memory `project_beta_no_staging.md` still applies — Beta validates in-place on prod after merge.

---

## Pre-flight

- [ ] **Pre.1 — Branch.**
  ```bash
  cd /Users/jasonmeyer.ict/Projects/RepOS
  git checkout main && git pull origin main
  git checkout -b beta/w1-live-data-foundation
  ```

- [ ] **Pre.2 — Confirm test Postgres is up.** Per memory `gotchas` block in last session-handoff, local dev uses Homebrew Postgres:
  ```bash
  PGPASSWORD=repos_dev_pw psql -h 127.0.0.1 -p 5432 -U repos -d repos_test -c '\dt' | head -5
  ```
  Expected: lists the alpha schema (users, planned_sets, set_logs, etc.). If empty, `cd api && npm run migrate`.

- [ ] **Pre.3 — Confirm baseline tests pass.**
  ```bash
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test 2>&1 | tail -10
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test 2>&1 | tail -10
  ```
  Expected: api 393+ passing, frontend 129+ passing (post-W0 baseline). Any flake gets investigated before W1.1 starts.

- [ ] **Pre.4 — Install `dexie` for the offline queue.**
  ```bash
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend
  npm install dexie@^4.0.0
  ```
  Verify `package.json` shows `"dexie": "^4.0.0"`. Commit `package.json` + `package-lock.json` in W1.3.1.

- [ ] **Pre.5 — Install + scaffold Playwright** (W1 is the first wave introducing Playwright — no prior config exists). Run from `/Users/jasonmeyer.ict/Projects/RepOS/frontend`:
  ```bash
  npm install --save-dev @playwright/test@^1.50.0
  npx playwright install --with-deps chromium
  ```
  Create `frontend/playwright.config.ts`:
  ```ts
  import { defineConfig, devices } from '@playwright/test';
  export default defineConfig({
    testDir: './',
    testMatch: ['playwright/**/*.spec.ts', 'src/components/programs/__offline__/*.spec.ts'],
    timeout: 30_000,
    use: { baseURL: 'http://127.0.0.1:5173', trace: 'on-first-retry' },
    webServer: {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  });
  ```
  Add a smoke spec at `frontend/playwright/smoke.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  test('home renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/RepOS/i);
  });
  ```
  Confirm `npx playwright test --headed=false` runs the smoke. Commit `playwright.config.ts`, smoke spec, and the new `package.json`/`package-lock.json` rows as a single commit `chore(frontend): scaffold Playwright (Pre.5)`. **Playwright is local-only in this wave**; CI integration deferred to W8.1.

- [ ] **Pre.6 — Verify W1.1.3 backfill assumption holds against test DB.** Run:
  ```bash
  cd api && PGPASSWORD=repos_dev_pw psql -h 127.0.0.1 -U repos -d repos_test -c "
    SELECT count(*) AS orphans FROM set_logs sl
    LEFT JOIN planned_sets ps ON ps.id = sl.planned_set_id
    LEFT JOIN day_workouts dw ON dw.id = ps.day_workout_id
    LEFT JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
    WHERE mr.user_id IS NULL;"
  ```
  Expect `0`. If non-zero, alpha rows reference broken FK chains — per memory `project_alpha_state.md` non-weight alpha data is throwaway; the migration's pre-emptive `DELETE FROM set_logs WHERE user_id IS NULL` (added in W1.1.3) will clear them.

---

## W1.1 — `set_logs` schema (migration 029)

Extends the alpha-era `set_logs` table (migration 022) with the columns the Beta API contract requires: `user_id`, `exercise_id`, `rpe`, `client_request_id`, `created_at`, `updated_at`. Backfills `user_id` + `exercise_id` from the planned-set chain. Adds the two unique indices the Beta API depends on for idempotency and double-tap dedupe.

**Files:**
- New: `api/src/db/migrations/029_set_logs_beta_columns.sql`
- New: `api/tests/integration/set-logs-schema.test.ts`
- Modify: `api/src/db/schema-types.ts` (if it exists — extend `SetLog` interface). If absent, schemas live alongside route file.

### Appendix A absorption
- **Idempotency index:** `UNIQUE (user_id, client_request_id)` — explicit per Backend NIT.
- **Double-tap dedupe index:** `UNIQUE (planned_set_id, date_trunc('minute', performed_at))` — per master plan W1.1.

### Steps

- [ ] **W1.1.1 — Write failing schema test.**

  Create `api/tests/integration/set-logs-schema.test.ts`:
  ```ts
  import { describe, it, expect, beforeAll } from 'vitest';
  import { db } from '../../src/db/client.js';

  describe('set_logs Beta schema (migration 029)', () => {
    it('has user_id, exercise_id, rpe, client_request_id, created_at, updated_at columns', async () => {
      const { rows } = await db.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'set_logs'
         ORDER BY ordinal_position`,
      );
      const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));
      expect(cols.user_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
      expect(cols.exercise_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
      expect(cols.rpe).toMatchObject({ data_type: 'smallint', is_nullable: 'YES' });
      expect(cols.client_request_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
      expect(cols.created_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
      expect(cols.updated_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
    });

    it('enforces UNIQUE (user_id, client_request_id)', async () => {
      const { rows } = await db.query(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'set_logs' AND indexname = 'set_logs_user_id_client_request_id_key'`,
      );
      expect(rows[0]?.indexdef).toMatch(/UNIQUE.*\(user_id, client_request_id\)/);
    });

    it('enforces UNIQUE (planned_set_id, minute-truncated performed_at)', async () => {
      const { rows } = await db.query(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'set_logs' AND indexname = 'set_logs_minute_dedupe_key'`,
      );
      expect(rows[0]?.indexdef).toMatch(/UNIQUE.*planned_set_id.*date_trunc.*minute.*performed_at/);
    });

    it('has updated_at trigger', async () => {
      const { rows } = await db.query(
        `SELECT trigger_name FROM information_schema.triggers
         WHERE event_object_table = 'set_logs' AND trigger_name = 'set_logs_updated_at'`,
      );
      expect(rows).toHaveLength(1);
    });

    it('user_id has FK to users with ON DELETE CASCADE', async () => {
      const { rows } = await db.query(`
        SELECT confdeltype FROM pg_constraint
        WHERE conname LIKE 'set_logs_user_id_fkey%'
      `);
      expect(rows[0]?.confdeltype).toBe('c'); // 'c' = CASCADE
    });
  });
  ```

- [ ] **W1.1.2 — Run test, expect FAIL.**
  ```bash
  cd /Users/jasonmeyer.ict/Projects/RepOS/api
  npm test -- set-logs-schema 2>&1 | tail -20
  ```
  Expected: all five `it` cases fail (columns don't exist yet).

- [ ] **W1.1.3 — Write migration.**

  Create `api/src/db/migrations/029_set_logs_beta_columns.sql`:
  ```sql
  -- Beta W1.1 — set_logs Beta columns.
  -- Extends migration 022 with the Beta API contract: user_id + exercise_id
  -- (FK ownership + per-user/per-exercise indices for W3 stalled-PR queries),
  -- rpe (separate from RIR — same set can have both), client_request_id
  -- (idempotency from offline queue), and standard audit columns. Backfills
  -- user_id from mesocycle_runs via day_workouts; exercise_id from
  -- planned_sets directly.

  BEGIN;

  ALTER TABLE set_logs
    ADD COLUMN IF NOT EXISTS user_id            UUID,
    ADD COLUMN IF NOT EXISTS exercise_id        UUID,
    ADD COLUMN IF NOT EXISTS rpe                SMALLINT CHECK (rpe BETWEEN 1 AND 10),
    ADD COLUMN IF NOT EXISTS client_request_id  UUID,
    ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

  -- Backfill user_id + exercise_id from the planned-set chain.
  -- set_log -> planned_set -> day_workout -> mesocycle_run -> user_id
  -- set_log -> planned_set.exercise_id
  UPDATE set_logs sl
  SET
    user_id     = mr.user_id,
    exercise_id = ps.exercise_id
  FROM planned_sets ps
  JOIN day_workouts dw ON dw.id = ps.day_workout_id
  JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
  WHERE sl.planned_set_id = ps.id
    AND (sl.user_id IS NULL OR sl.exercise_id IS NULL);

  -- Backfill client_request_id for any pre-existing rows so the NOT NULL
  -- constraint below can apply. Pre-Beta rows never had idempotency keys;
  -- minting a random one preserves uniqueness without affecting clients.
  UPDATE set_logs SET client_request_id = gen_random_uuid()
  WHERE client_request_id IS NULL;

  -- Orphan guard (per memory `project_alpha_state.md` — alpha non-weight rows
  -- are throwaway): any set_log whose planned_set chain doesn't reach a
  -- mesocycle_run gets removed BEFORE we apply NOT NULL. Without this, a
  -- cascade-in-flight or pre-existing orphan would make the ALTER fail and
  -- roll back the whole migration. Keeping this single DELETE is safer than
  -- the post-hoc Troubleshooting recipe.
  DELETE FROM set_logs WHERE user_id IS NULL OR exercise_id IS NULL;

  ALTER TABLE set_logs
    ALTER COLUMN user_id           SET NOT NULL,
    ALTER COLUMN exercise_id       SET NOT NULL,
    ALTER COLUMN client_request_id SET NOT NULL,
    ADD CONSTRAINT set_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    ADD CONSTRAINT set_logs_exercise_id_fkey
      FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT;

  -- Idempotency: per-user client_request_id is globally unique.
  -- W1.2 POST /api/set-logs uses this for "same client_request_id returns prior row".
  CREATE UNIQUE INDEX IF NOT EXISTS set_logs_user_id_client_request_id_key
    ON set_logs (user_id, client_request_id);

  -- Double-tap dedupe (per master plan): same planned_set within same minute
  -- = single row even if client_request_id differs (offline retry edge).
  CREATE UNIQUE INDEX IF NOT EXISTS set_logs_minute_dedupe_key
    ON set_logs (planned_set_id, date_trunc('minute', performed_at));

  -- Compound indices for W3 stalled-PR and overreaching queries
  -- (recent set_logs for a (user, exercise) ordered by performed_at).
  CREATE INDEX IF NOT EXISTS idx_set_logs_user_exercise_performed
    ON set_logs (user_id, exercise_id, performed_at DESC);

  -- updated_at trigger (mirrors the pattern used in 003_health_weight_samples).
  CREATE OR REPLACE FUNCTION set_logs_set_updated_at() RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS set_logs_updated_at ON set_logs;
  CREATE TRIGGER set_logs_updated_at
    BEFORE UPDATE ON set_logs
    FOR EACH ROW
    EXECUTE FUNCTION set_logs_set_updated_at();

  COMMIT;
  ```

- [ ] **W1.1.4 — Apply migration to test DB.**
  ```bash
  cd /Users/jasonmeyer.ict/Projects/RepOS/api
  npm run migrate 2>&1 | tail -10
  ```
  Expected: `✓ 029_set_logs_beta_columns.sql` printed; no errors.

- [ ] **W1.1.5 — Re-run test, expect PASS.**
  ```bash
  npm test -- set-logs-schema 2>&1 | tail -10
  ```
  Expected: all 5 cases pass.

- [ ] **W1.1.6 — Commit.**
  ```bash
  git add api/src/db/migrations/029_set_logs_beta_columns.sql \
          api/tests/integration/set-logs-schema.test.ts
  git commit -m "$(cat <<'EOF'
  feat(db): set_logs Beta columns + idempotency indices (migration 029)

  W1.1 of the Beta plan. Extends the alpha-era set_logs table with the
  columns the Beta API contract requires: user_id + exercise_id (denormalised
  for ownership checks and per-user/per-exercise query indices), rpe
  (separate from RIR — both can coexist on the same set), client_request_id
  (idempotency key from the offline queue), and standard created_at /
  updated_at audit columns. Backfills user_id + exercise_id from the
  planned_set → day_workout → mesocycle_run chain so the migration is
  safe to apply to alpha rows. Adds two unique indices: idempotency
  (user_id, client_request_id) and double-tap dedupe (planned_set_id,
  date_trunc('minute', performed_at)).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## W1.2 — `set_logs` CRUD routes

Four endpoints. All require Bearer-or-CF-Access auth. Ownership is enforced server-side via a `planned_set_id → day_workout → mesocycle_run.user_id = req.userId` JOIN; the client cannot spoof `user_id`. Idempotency contract per master plan + Appendix A.

**Files:**
- New: `api/src/routes/setLogs.ts`
- New: `api/src/schemas/setLogs.ts` (Zod schemas + types)
- New: `api/tests/unit/set-logs-routes.test.ts`
- New: `api/tests/integration/set-logs-flow.test.ts`
- Modify: `api/src/index.ts` (mount the new route file)

### Auth contract
Existing middleware: `requireBearerOrCfAccess` (from `../middleware/cfAccess.js`). It populates `req.userId`. Mirror the `weight.ts` pattern exactly — do not invent a new auth layer.

### IDOR contract (cross-cuts POST/PATCH/DELETE/GET)
- **POST/PATCH/DELETE** return `404` when the referenced resource does not exist OR belongs to another user. We do not distinguish "not found" from "not yours" — that distinction is itself an oracle. A legit user mistyping their own UUID gets the same surface either way; cost is acceptable in a single-tenant-per-user surface.
- **GET (list endpoints)** return `200` with an empty array on cross-user query — does not confirm existence of someone else's row.
- The asymmetry is deliberate: POST/PATCH/DELETE address a specific resource (the client supplied the ID), so 404 is the natural shape. GET is a query — leaking existence via 404-vs-200 is the canonical IDOR oracle, so we use 200+empty.

### Scope enforcement (Pre-W1 backport — see W1.4.0)
Current alpha state: `api/src/routes/weight.ts` doesn't check `device_tokens.scopes`. Any valid bearer works for any route. W1.4.0 below ships a `requireScope()` preHandler and back-applies it to `/api/health/weight` + `/api/health/weight/backfill` (with `health:weight:write`) before W1.4's `health:workouts:write` ships. Without this backport, W1.4.5's inverse-scope test would silently pass against unenforced code.

### Idempotency contract
1. `POST /api/set-logs` with a `client_request_id` UUID:
   - First write → `201 {set_log: {...}, deduped: false}`.
   - Subsequent writes with same `client_request_id` (and same user_id) → `200 {set_log: {prior row, unchanged}, deduped: true}`.
2. Same minute, same `planned_set_id`, DIFFERENT `client_request_id` (double-tap with fresh idempotency key per tap) → `200 {set_log: <existing>, deduped: true}` (per master plan W1.1).
3. Different minute, same `planned_set_id` (legitimate second set within rounding) → `201` (new row).

### Steps

- [ ] **W1.2.1 — Write Zod schema + types.**

  Create `api/src/schemas/setLogs.ts`:
  ```ts
  import { z } from 'zod';

  // POST /api/set-logs request body
  export const SetLogPostSchema = z.object({
    client_request_id: z.string().uuid(),
    planned_set_id: z.string().uuid(),
    weight_lbs: z.number().min(0).max(2000).optional(),
    reps: z.number().int().min(0).max(100).optional(),
    rir: z.number().int().min(0).max(5).optional(),
    rpe: z.number().int().min(1).max(10).optional(),
    performed_at: z.string().datetime({ offset: true }),
    notes: z.string().max(500).optional(),
  });
  export type SetLogPost = z.infer<typeof SetLogPostSchema>;

  // PATCH body — every field optional except no client_request_id (immutable)
  export const SetLogPatchSchema = z.object({
    weight_lbs: z.number().min(0).max(2000).optional(),
    reps: z.number().int().min(0).max(100).optional(),
    rir: z.number().int().min(0).max(5).optional(),
    rpe: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(500).optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });

  // GET query
  export const SetLogListQuerySchema = z.object({
    planned_set_id: z.string().uuid(),
  });

  export interface SetLogRow {
    id: string;
    user_id: string;
    exercise_id: string;
    planned_set_id: string;
    client_request_id: string;
    weight_lbs: number | null;
    reps: number | null;
    rir: number | null;
    rpe: number | null;
    performed_at: string;
    notes: string | null;
    created_at: string;
    updated_at: string;
  }
  ```

- [ ] **W1.2.2 — Write failing POST integration test (happy path).**

  Create `api/tests/integration/set-logs-flow.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { build } from '../helpers/build-test-app.js';
  import { seedUserWithMesocycle } from '../helpers/seed-fixtures.js';

  describe('POST /api/set-logs — happy path', () => {
    it('inserts a row with derived user_id + exercise_id, returns 201', async () => {
      const app = await build();
      const { userId, bearer, plannedSetId, exerciseId } = await seedUserWithMesocycle();

      const resp = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${bearer}` },
        payload: {
          client_request_id: '11111111-1111-1111-1111-111111111111',
          planned_set_id: plannedSetId,
          weight_lbs: 225.0,
          reps: 5,
          rir: 2,
          performed_at: new Date().toISOString(),
        },
      });

      expect(resp.statusCode).toBe(201);
      const body = resp.json();
      expect(body.deduped).toBe(false);
      expect(body.set_log).toMatchObject({
        user_id: userId,
        exercise_id: exerciseId,
        planned_set_id: plannedSetId,
        weight_lbs: 225.0,
        reps: 5,
        rir: 2,
      });
    });
  });
  ```

  Helpers needed: if `api/tests/helpers/build-test-app.ts` and `api/tests/helpers/seed-fixtures.ts` don't exist, create them. `build-test-app.ts` should mirror the pattern used by existing integration tests (look at `api/tests/integration/startup-placeholder-guard.test.ts` for the reference shape).

- [ ] **W1.2.3 — Run test, expect FAIL.**
  ```bash
  cd /Users/jasonmeyer.ict/Projects/RepOS/api
  npm test -- set-logs-flow 2>&1 | tail -10
  ```
  Expected: 404 (route not mounted yet).

- [ ] **W1.2.4 — Write minimal POST handler (happy path only).**

  Create `api/src/routes/setLogs.ts`:
  ```ts
  import type { FastifyInstance } from 'fastify';
  import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
  import { db } from '../db/client.js';
  import { SetLogPostSchema, type SetLogRow } from '../schemas/setLogs.js';

  export default async function setLogsRoutes(fastify: FastifyInstance) {
    fastify.post('/api/set-logs', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
      const parse = SetLogPostSchema.safeParse(req.body);
      if (!parse.success) {
        const issue = parse.error.issues[0];
        return reply.code(400).send({ error: issue.message, field: issue.path[0] });
      }
      const body = parse.data;

      // Derive user_id + exercise_id from planned_set_id; enforce ownership.
      const { rows: psRows } = await db.query<{
        exercise_id: string; user_id: string;
      }>(`
        SELECT ps.exercise_id, mr.user_id
        FROM planned_sets ps
        JOIN day_workouts dw ON dw.id = ps.day_workout_id
        JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
        WHERE ps.id = $1`, [body.planned_set_id]);

      // IDOR contract: collapse "not found" and "not owned" into a single 404
      // to avoid an existence oracle (see "IDOR contract" section above).
      if (psRows.length === 0 || psRows[0].user_id !== req.userId) {
        return reply.code(404).send({ error: 'planned_set not found' });
      }
      const exerciseId = psRows[0].exercise_id;

      // Idempotency: atomic INSERT ... ON CONFLICT DO NOTHING handles both
      // probes (user_id,client_request_id) and (planned_set,minute-bucket)
      // without TOCTOU. Result: empty rows on conflict → look up the existing
      // row + return 200 deduped:true; non-empty rows → 201 new.
      const insert = await db.query<SetLogRow>(`
        INSERT INTO set_logs (
          user_id, exercise_id, planned_set_id, client_request_id,
          performed_load_lbs, performed_reps, performed_rir, rpe,
          performed_at, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT DO NOTHING
        RETURNING
          id, user_id, exercise_id, planned_set_id, client_request_id,
          performed_load_lbs AS weight_lbs,
          performed_reps     AS reps,
          performed_rir      AS rir,
          rpe, performed_at, notes, created_at, updated_at`, [
        req.userId, exerciseId, body.planned_set_id, body.client_request_id,
        body.weight_lbs ?? null, body.reps ?? null, body.rir ?? null, body.rpe ?? null,
        body.performed_at, body.notes ?? null,
      ]);

      if (insert.rows.length === 1) {
        return reply.code(201).send({ deduped: false, set_log: insert.rows[0] });
      }

      // Conflict path — find which constraint matched and return existing row.
      const existing = await db.query<SetLogRow>(`
        SELECT
          id, user_id, exercise_id, planned_set_id, client_request_id,
          performed_load_lbs AS weight_lbs,
          performed_reps     AS reps,
          performed_rir      AS rir,
          rpe, performed_at, notes, created_at, updated_at
        FROM set_logs
        WHERE (user_id = $1 AND client_request_id = $2)
           OR (planned_set_id = $3 AND date_trunc('minute', performed_at) = date_trunc('minute', $4::timestamptz))
        LIMIT 1`,
        [req.userId, body.client_request_id, body.planned_set_id, body.performed_at]);
      return reply.code(200).send({ deduped: true, set_log: existing.rows[0] });
    });
  }
  ```

  **Column-aliasing note:** API contract uses `weight_lbs`/`reps`/`rir` (Beta shape). DB columns are `performed_load_lbs`/`performed_reps`/`performed_rir` (alpha shape, kept for migration simplicity). Every SELECT/RETURNING in this route aliases the columns at the SQL layer so handlers never see the alpha names — drops the prior `mapRow` cast helper. The PATCH SET clause does the inverse (W1.2.12).

  Mount in `api/src/index.ts` — find the existing `fastify.register(weightRoutes)` line and add `await fastify.register(setLogsRoutes);` directly after it.

- [ ] **W1.2.5 — Run test, expect PASS.**
  ```bash
  npm test -- set-logs-flow 2>&1 | tail -10
  ```

- [ ] **W1.2.6 — Commit happy path.**
  ```bash
  git add api/src/routes/setLogs.ts api/src/schemas/setLogs.ts \
          api/tests/integration/set-logs-flow.test.ts \
          api/tests/helpers/build-test-app.ts api/tests/helpers/seed-fixtures.ts \
          api/src/index.ts
  git commit -m "feat(api): POST /api/set-logs happy path + ownership check (W1.2)"
  ```

- [ ] **W1.2.7 — Write failing idempotency test (same client_request_id returns prior row).**

  Append to `api/tests/integration/set-logs-flow.test.ts`:
  ```ts
  describe('POST /api/set-logs — idempotency', () => {
    it('returns prior row + deduped:true on identical client_request_id', async () => {
      const app = await build();
      const { bearer, plannedSetId } = await seedUserWithMesocycle();
      const payload = {
        client_request_id: '22222222-2222-2222-2222-222222222222',
        planned_set_id: plannedSetId,
        weight_lbs: 200.0, reps: 5, rir: 1,
        performed_at: new Date().toISOString(),
      };
      const first  = await app.inject({ method: 'POST', url: '/api/set-logs',
        headers: { authorization: `Bearer ${bearer}` }, payload });
      const second = await app.inject({ method: 'POST', url: '/api/set-logs',
        headers: { authorization: `Bearer ${bearer}` }, payload: { ...payload, weight_lbs: 999 } });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().deduped).toBe(true);
      expect(second.json().set_log.weight_lbs).toBe(200.0); // ignores new value
      expect(second.json().set_log.id).toBe(first.json().set_log.id);
    });

    it('double-tap (same minute, same planned_set, different client_request_id) returns 200 deduped:true', async () => {
      const app = await build();
      const { bearer, plannedSetId } = await seedUserWithMesocycle();
      const ts = new Date().toISOString();
      const first  = await app.inject({ method: 'POST', url: '/api/set-logs',
        headers: { authorization: `Bearer ${bearer}` }, payload: {
          client_request_id: '33333333-3333-3333-3333-333333333333',
          planned_set_id: plannedSetId, weight_lbs: 200, reps: 5, performed_at: ts }});
      const second = await app.inject({ method: 'POST', url: '/api/set-logs',
        headers: { authorization: `Bearer ${bearer}` }, payload: {
          client_request_id: '44444444-4444-4444-4444-444444444444',
          planned_set_id: plannedSetId, weight_lbs: 200, reps: 5, performed_at: ts }});
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().deduped).toBe(true);
      expect(second.json().set_log.id).toBe(first.json().set_log.id);
    });
  });
  ```

- [ ] **W1.2.8 — Run, expect PASS.** The atomic `INSERT ... ON CONFLICT DO NOTHING` block from W1.2.4 already implements both idempotency probes (per-user `client_request_id` AND minute-bucket). The test validates existing behaviour — no new code needed. **Commit the idempotency test as `test(api): set-logs POST idempotency contract`**.

- [ ] **W1.2.11 — Write failing PATCH test (24h audit window).**

  Append:
  ```ts
  describe('PATCH /api/set-logs/:id — 24h audit window', () => {
    it('200 when performed_at is within 24h', async () => {
      const app = await build();
      const { bearer, setLogId } = await seedUserWithLoggedSet({ minutesAgo: 60 });
      const resp = await app.inject({ method: 'PATCH', url: `/api/set-logs/${setLogId}`,
        headers: { authorization: `Bearer ${bearer}` }, payload: { weight_lbs: 230 } });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().set_log.weight_lbs).toBe(230);
    });

    it('409 audit_window_expired when performed_at > 24h ago', async () => {
      const app = await build();
      const { bearer, setLogId } = await seedUserWithLoggedSet({ minutesAgo: 25 * 60 });
      const resp = await app.inject({ method: 'PATCH', url: `/api/set-logs/${setLogId}`,
        headers: { authorization: `Bearer ${bearer}` }, payload: { weight_lbs: 230 } });
      expect(resp.statusCode).toBe(409);
      expect(resp.json().error).toBe('audit_window_expired');
      expect(resp.json()).toHaveProperty('performed_at');
      expect(resp.json()).toHaveProperty('max_edit_at');
    });

    it('404 when set_log belongs to another user (IDOR — collapsed with not-found)', async () => {
      const app = await build();
      const userA = await seedUserWithLoggedSet({ minutesAgo: 10 });
      const userB = await seedUserWithMesocycle();
      const resp = await app.inject({ method: 'PATCH', url: `/api/set-logs/${userA.setLogId}`,
        headers: { authorization: `Bearer ${userB.bearer}` }, payload: { weight_lbs: 9 } });
      expect(resp.statusCode).toBe(404);
    });
  });
  ```

- [ ] **W1.2.12 — Run, expect FAIL.** Then add PATCH handler:
  ```ts
  fastify.patch('/api/set-logs/:id', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parse = SetLogPatchSchema.safeParse(req.body);
    if (!parse.success) {
      const issue = parse.error.issues[0];
      return reply.code(400).send({ error: issue.message, field: issue.path[0] });
    }

    // Atomic load + ownership + audit-window check in one SQL pass.
    // SQL is the source of truth for time — sidesteps API/DB clock-skew.
    const { rows: existing } = await db.query<{
      id: string; user_id: string; performed_at: string;
      audit_window_ok: boolean; max_edit_at: string;
    }>(`
      SELECT id, user_id, performed_at,
        performed_at > now() - INTERVAL '24 hours' AS audit_window_ok,
        (performed_at + INTERVAL '24 hours')::text   AS max_edit_at
      FROM set_logs WHERE id = $1`, [id]);

    // IDOR: collapse "not found" and "not owned" into a single 404.
    if (existing.length === 0 || existing[0].user_id !== req.userId) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (!existing[0].audit_window_ok) {
      return reply.code(409).send({
        error: 'audit_window_expired',
        performed_at: existing[0].performed_at,
        max_edit_at:  existing[0].max_edit_at,
      });
    }

    // Build SET clause dynamically (API names → DB names).
    const fields = parse.data;
    const setParts: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    const map = { weight_lbs: 'performed_load_lbs', reps: 'performed_reps', rir: 'performed_rir', rpe: 'rpe', notes: 'notes' } as const;
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      setParts.push(`${map[k as keyof typeof map]} = $${p++}`);
      params.push(v);
    }
    params.push(id);
    const { rows } = await db.query<SetLogRow>(`
      UPDATE set_logs SET ${setParts.join(', ')} WHERE id = $${p}
      RETURNING
        id, user_id, exercise_id, planned_set_id, client_request_id,
        performed_load_lbs AS weight_lbs,
        performed_reps     AS reps,
        performed_rir      AS rir,
        rpe, performed_at, notes, created_at, updated_at`,
      params,
    );
    return reply.code(200).send({ set_log: rows[0] });
  });
  ```

- [ ] **W1.2.13 — Run PATCH tests, expect PASS. Commit.**

- [ ] **W1.2.14 — Write failing DELETE test.** Same 24h window; same 404-on-IDOR collapse; 200 + `{deleted: true}` on success.

  ```ts
  describe('DELETE /api/set-logs/:id — 24h audit window', () => {
    it('200 deleted within 24h', async () => {
      const app = await build();
      const { bearer, setLogId } = await seedUserWithLoggedSet({ minutesAgo: 30 });
      const resp = await app.inject({ method: 'DELETE', url: `/api/set-logs/${setLogId}`,
        headers: { authorization: `Bearer ${bearer}` } });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().deleted).toBe(true);
    });
    it('409 audit_window_expired past 24h', async () => {
      const app = await build();
      const { bearer, setLogId } = await seedUserWithLoggedSet({ minutesAgo: 25 * 60 });
      const resp = await app.inject({ method: 'DELETE', url: `/api/set-logs/${setLogId}`,
        headers: { authorization: `Bearer ${bearer}` } });
      expect(resp.statusCode).toBe(409);
      expect(resp.json().error).toBe('audit_window_expired');
    });
    it('404 when set_log belongs to another user (IDOR)', async () => {
      const app = await build();
      const userA = await seedUserWithLoggedSet({ minutesAgo: 30 });
      const userB = await seedUserWithMesocycle();
      const resp = await app.inject({ method: 'DELETE', url: `/api/set-logs/${userA.setLogId}`,
        headers: { authorization: `Bearer ${userB.bearer}` } });
      expect(resp.statusCode).toBe(404);
    });
  });
  ```

- [ ] **W1.2.15 — Add DELETE handler.**

  ```ts
  fastify.delete('/api/set-logs/:id', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const { rows: existing } = await db.query<{
      user_id: string; performed_at: string;
      audit_window_ok: boolean; max_edit_at: string;
    }>(`
      SELECT user_id, performed_at,
        performed_at > now() - INTERVAL '24 hours' AS audit_window_ok,
        (performed_at + INTERVAL '24 hours')::text   AS max_edit_at
      FROM set_logs WHERE id = $1`, [id]);

    if (existing.length === 0 || existing[0].user_id !== req.userId) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (!existing[0].audit_window_ok) {
      return reply.code(409).send({
        error: 'audit_window_expired',
        performed_at: existing[0].performed_at,
        max_edit_at:  existing[0].max_edit_at,
      });
    }

    await db.query(`DELETE FROM set_logs WHERE id = $1`, [id]);
    return reply.code(200).send({ deleted: true });
  });
  ```

  **Run, expect PASS. Commit.**

- [ ] **W1.2.16 — Write failing GET test.**

  ```ts
  describe('GET /api/set-logs?planned_set_id=', () => {
    it('returns this user’s set_logs for the given planned_set in performed_at DESC order', async () => {
      const app = await build();
      const { bearer, plannedSetId } = await seedThreeLogsOnSamePlannedSet();
      const resp = await app.inject({ method: 'GET',
        url: `/api/set-logs?planned_set_id=${plannedSetId}`,
        headers: { authorization: `Bearer ${bearer}` } });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().set_logs).toHaveLength(3);
      const ts = resp.json().set_logs.map((s: any) => s.performed_at);
      expect(ts).toEqual([...ts].sort().reverse());
    });

    it('returns 200 + empty array when another user owns the planned_set (IDOR safety)', async () => {
      const app = await build();
      const userA = await seedThreeLogsOnSamePlannedSet();
      const userB = await seedUserWithMesocycle();
      const resp = await app.inject({ method: 'GET',
        url: `/api/set-logs?planned_set_id=${userA.plannedSetId}`,
        headers: { authorization: `Bearer ${userB.bearer}` } });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().set_logs).toHaveLength(0);
    });
  });
  ```

  IDOR contract: returning empty array (not 404) is intentional — doesn't leak existence of other users' planned sets.

- [ ] **W1.2.17 — Add GET handler.**

  ```ts
  fastify.get('/api/set-logs', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const parse = SetLogListQuerySchema.safeParse(req.query);
    if (!parse.success) return reply.code(400).send({ error: 'planned_set_id required' });
    const { rows } = await db.query<SetLogRow>(`
      SELECT
        sl.id, sl.user_id, sl.exercise_id, sl.planned_set_id, sl.client_request_id,
        sl.performed_load_lbs AS weight_lbs,
        sl.performed_reps     AS reps,
        sl.performed_rir      AS rir,
        sl.rpe, sl.performed_at, sl.notes, sl.created_at, sl.updated_at
      FROM set_logs sl
      JOIN planned_sets ps ON ps.id = sl.planned_set_id
      JOIN day_workouts dw ON dw.id = ps.day_workout_id
      JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
      WHERE sl.planned_set_id = $1
        AND mr.user_id = $2
      ORDER BY sl.performed_at DESC`, [parse.data.planned_set_id, req.userId]);
    return reply.code(200).send({ set_logs: rows });
  });
  ```

- [ ] **W1.2.18 — Run, expect PASS. Commit.**

- [ ] **W1.2.19 — Type-check + lint.**
  ```bash
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm run typecheck
  ```
  Expected: 0 errors.

---

## W1.4 — Apple Health Workouts ingest endpoint

New table `health_workouts`; new ingest endpoint `POST /api/health/workouts` mirroring the alpha weight-sync shape (dedupe key, 5-writes-per-day limit, idempotent on dup). New bearer scope `health:workouts:write`. iOS Shortcut runbook lives in the repo (Appendix-A item).

**Appendix A absorption:**
- `health_workouts` columns + indices spec — verbatim from Appendix A.
- RHR ingest **cut** per recommendation (no resting-heart-rate column or endpoint in this wave).

**Files:**
- New: `api/src/db/migrations/030_health_workouts.sql`
- New: `api/src/routes/workouts.ts`
- New: `api/src/schemas/healthWorkouts.ts`
- New: `api/tests/integration/health-workouts-flow.test.ts`
- Modify: `api/src/index.ts` — register `workoutsRoutes`
- Modify: `api/src/schemas/tokens.ts` (or wherever token scopes are enumerated) — add `health:workouts:write` to the scope enum
- New: `docs/runbooks/ios-shortcuts.md`

### Steps

- [ ] **W1.4.0 — Scope-enforcement middleware (Pre-W1 backport).** Per Security review Critical #1: `api/src/routes/weight.ts` currently does not check `device_tokens.scopes`. Any valid bearer works for any route. We add the enforcement layer now so W1.4.5's inverse-scope test ("workouts-only token → 403 on /weight") is meaningful.

  **W1.4.0.1 — Write failing test** at `api/tests/integration/scope-enforcement.test.ts`:
  ```ts
  describe('scope enforcement', () => {
    it('weight-only bearer is rejected on POST /api/health/workouts', async () => {
      const app = await build();
      const { bearer } = await mintBearer({ scopes: ['health:weight:write'] });
      const resp = await app.inject({ method: 'POST', url: '/api/health/workouts',
        headers: { authorization: `Bearer ${bearer}` },
        payload: validWorkoutPayload() });
      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope/i);
    });
    it('workouts-only bearer is rejected on POST /api/health/weight', async () => {
      const app = await build();
      const { bearer } = await mintBearer({ scopes: ['health:workouts:write'] });
      const resp = await app.inject({ method: 'POST', url: '/api/health/weight',
        headers: { authorization: `Bearer ${bearer}` },
        payload: validWeightPayload() });
      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope/i);
    });
    it('CF Access JWT bypasses scope check (whole-host auth covers it)', async () => {
      const app = await build();
      const resp = await app.inject({ method: 'POST', url: '/api/health/weight',
        headers: { 'cf-access-jwt-assertion': mintCfAccessJwt('jason@jpmtech.com') },
        payload: validWeightPayload() });
      expect(resp.statusCode).toBe(201);
    });
  });
  ```

  **W1.4.0.2 — Extend `api/src/middleware/auth.ts`.** Find the existing `requireAuth` (the bearer-token verifier). Update it to also SELECT `scopes` (which is `TEXT[]` per migration 025) and stash on `req`:
  ```ts
  // before: SELECT id, user_id, token_hash FROM device_tokens WHERE ...
  // after:
  const { rows } = await db.query<{ id: string; user_id: string; token_hash: string; scopes: string[] }>(`
    SELECT id, user_id, token_hash, scopes FROM device_tokens WHERE ...`);
  // ...
  req.userId = rows[0].user_id;
  (req as any).tokenScopes = rows[0].scopes ?? [];
  ```
  Augment the `FastifyRequest` type in `api/src/types/fastify.d.ts` (create if absent):
  ```ts
  declare module 'fastify' {
    interface FastifyRequest {
      userId?: string;
      tokenScopes?: string[];   // empty when authn was via CF Access JWT
    }
  }
  ```

  **W1.4.0.3 — Add `requireScope` preHandler** at `api/src/middleware/scope.ts`:
  ```ts
  import type { FastifyReply, FastifyRequest } from 'fastify';
  export type Scope = 'health:weight:write' | 'health:workouts:write';

  /** Bypass: CF Access JWT (no tokenScopes set) — whole-host auth covers it.
   *  Enforce: bearer token MUST have the named scope. */
  export function requireScope(scope: Scope) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.tokenScopes) return;                           // CF Access path
      if (req.tokenScopes.includes(scope)) return;            // OK
      return reply.code(403).send({ error: `scope_required:${scope}` });
    };
  }
  ```

  **W1.4.0.4 — Wire `requireScope('health:weight:write')` onto existing weight routes.** In `api/src/routes/weight.ts`, find the `fastify.post('/api/health/weight', ...)` and `fastify.post('/api/health/weight/backfill', ...)` declarations. Update the preHandler to a chain:
  ```ts
  { preHandler: [requireBearerOrCfAccess, requireScope('health:weight:write')] }
  ```

  **W1.4.0.5 — Run scope tests; PASS; commit:**
  ```bash
  git add api/src/middleware/scope.ts api/src/middleware/auth.ts api/src/routes/weight.ts \
          api/src/types/fastify.d.ts api/tests/integration/scope-enforcement.test.ts
  git commit -m "feat(api): bearer-token scope enforcement (W1.4.0 backport)"
  ```

- [ ] **W1.4.1 — Write failing schema test** (mirrors W1.1.1 shape) asserting `health_workouts` table exists with columns `(id BIGSERIAL, user_id UUID, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, modality TEXT, distance_m INT NULL, duration_sec INT, source TEXT, created_at, updated_at)` plus `UNIQUE (user_id, started_at, source)` and ON DELETE CASCADE FK to users.

- [ ] **W1.4.2 — Write migration 030.**
  ```sql
  -- Beta W1.4 — health_workouts ingest table.
  -- Mirrors health_weight_samples: per-user dedupe via (user_id, started_at, source);
  -- ON DELETE CASCADE FK so user-deletion removes workout history (G6).
  -- Note: `modality` is TEXT NOT NULL with no CHECK constraint; the application-side
  -- Zod schema in api/src/schemas/healthWorkouts.ts owns the allowlist
  -- (walk|run|cycle|row|swim|elliptical|strength|other) so expanding the catalog
  -- (e.g. adding HIIT/hike) does not require a Postgres migration.

  BEGIN;

  CREATE TABLE IF NOT EXISTS health_workouts (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at   TIMESTAMPTZ  NOT NULL,
    ended_at     TIMESTAMPTZ  NOT NULL,
    modality     TEXT         NOT NULL,
    distance_m   INTEGER      NULL CHECK (distance_m IS NULL OR distance_m >= 0),
    duration_sec INTEGER      NOT NULL CHECK (duration_sec > 0),
    source       TEXT         NOT NULL CHECK (source IN ('Apple Health','Manual')),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (user_id, started_at, source),
    CHECK (ended_at > started_at)
  );

  CREATE INDEX IF NOT EXISTS idx_health_workouts_user_started
    ON health_workouts (user_id, started_at DESC);

  CREATE OR REPLACE FUNCTION health_workouts_set_updated_at() RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS health_workouts_updated_at ON health_workouts;
  CREATE TRIGGER health_workouts_updated_at
    BEFORE UPDATE ON health_workouts
    FOR EACH ROW EXECUTE FUNCTION health_workouts_set_updated_at();

  COMMIT;
  ```

- [ ] **W1.4.3 — Apply migration; schema test passes; commit migration.**

- [ ] **W1.4.4 — Extend bearer-token scope enum.** Grep for the current weight-write scope:
  ```bash
  grep -rn "health:weight:write" /Users/jasonmeyer.ict/Projects/RepOS/api/src/
  ```
  Add `'health:workouts:write'` to the same union/enum. **Write a failing token-mint test** that confirms a token can be minted with `scopes: ['health:workouts:write']`. **Implement; pass; commit.**

- [ ] **W1.4.5 — Write failing POST /api/health/workouts test (happy path + scope contamination).**

  ```ts
  describe('POST /api/health/workouts', () => {
    it('201 on first ingest with health:workouts:write scope', async () => {
      const app = await build();
      const { bearer } = await mintBearer({ scopes: ['health:workouts:write'] });
      const resp = await app.inject({ method: 'POST', url: '/api/health/workouts',
        headers: { authorization: `Bearer ${bearer}` }, payload: {
          started_at: '2026-05-12T10:00:00-04:00',
          ended_at:   '2026-05-12T10:32:15-04:00',
          modality: 'run',
          distance_m: 5200,
          duration_sec: 1935,
          source: 'Apple Health',
        }});
      expect(resp.statusCode).toBe(201);
      expect(resp.json().workout).toMatchObject({ modality: 'run', distance_m: 5200 });
    });

    it('200 deduped:true on identical (user, started_at, source)', async () => { /* dup */ });

    it('403 when bearer has only health:weight:write scope', async () => {
      const app = await build();
      const { bearer } = await mintBearer({ scopes: ['health:weight:write'] });
      const resp = await app.inject({ method: 'POST', url: '/api/health/workouts',
        headers: { authorization: `Bearer ${bearer}` }, payload: validWorkoutPayload() });
      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope/i);
    });

    it('409 on 11th write within calendar day per user (10/day rate limit)', async () => {
      const app = await build();
      const { bearer } = await mintBearer({ scopes: ['health:workouts:write'] });
      // 10 successful POSTs with distinct started_at (1 minute apart)
      const responses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const t = new Date(Date.UTC(2026, 4, 12, 10, i)).toISOString();
        const r = await app.inject({ method: 'POST', url: '/api/health/workouts',
          headers: { authorization: `Bearer ${bearer}` },
          payload: { ...validWorkoutPayload(), started_at: t,
            ended_at: new Date(Date.parse(t) + 30 * 60_000).toISOString() }});
        responses.push(r.statusCode);
      }
      expect(responses.slice(0, 10).every((s) => s === 201)).toBe(true);
      expect(responses[10]).toBe(409);
    });
  });
  ```

- [ ] **W1.4.6 — Implement `POST /api/health/workouts` handler.** Mirror `api/src/routes/weight.ts` structure: Zod validation → `requireScope('health:workouts:write')` preHandler (from W1.4.0) → rate-limit row in a per-day log table (`workout_write_log` — new table; keep rate windows independent per scope so a chatty weight Shortcut can't starve workout writes) → 10 writes/day, 11th returns 409 with `error: 'rate_limit_exceeded'`. Dedupe via `INSERT ... ON CONFLICT (user_id, started_at, source) DO UPDATE` returning the existing row + `deduped: true`.

- [ ] **W1.4.7 — Run tests; pass; commit.**

- [ ] **W1.4.8 — Author `docs/runbooks/ios-shortcuts.md`** (per Appendix A — must be repo-committed, not Notion). Sections:
  1. **Prerequisites** — Bearer token mint URL (`https://repos.jpmtech.com/api/tokens` behind CF Access); scope (`health:workouts:write`); jq + Shortcut versions tested.
     - **Token hygiene (must be explicit):**
       - Mint tokens via the CF Access-protected RepOS UI; never via a public form.
       - Paste the secret into the Shortcut's `Text` action **once**, then delete it from any clipboard manager (1Password, Clipy, Paste, etc.).
       - **NEVER paste tokens into a Shortcut import URL** (`https://www.icloud.com/shortcuts/...`) — that exposes the secret to Apple's CDN cache.
       - Tokens are not recoverable post-mint — RepOS stores only the argon2id hash. If you suspect leak, revoke immediately via `DELETE /api/tokens/:id` and mint a fresh one.
  2. **Authoring the weight Shortcut** — already exists; reference link only.
  3. **Authoring the workouts Shortcut** — Steps 1–10 with screenshots. Trigger: end of an Apple Workout. Body shape:
     ```json
     {"started_at":"<Workout.StartDate>","ended_at":"<Workout.EndDate>",
      "modality":"run","distance_m":<Workout.TotalDistance>,
      "duration_sec":<Workout.Duration>,"source":"Apple Health"}
     ```
  4. **Personal Automation gotchas** — iOS 17+ skip-confirmation requires per-shortcut "Run Without Confirmation"; the 36-hour stale threshold absorbs Personal Automation drift.
  5. **Troubleshooting** — 401 (token expired/revoked, mint a new one), 403 (wrong scope), 409 (dedupe — check the chart, or rate-limit hit — 10 workouts/day), CF Access challenge in Shortcut (Bypass policy on `/api/health/*` must be live).
  6. **Smoke test** — `curl -H "Authorization: Bearer $TOK" -d '...' https://repos.jpmtech.com/api/health/workouts`.

  Acceptance: a user who has never seen the existing weight Shortcut can produce a working workouts Shortcut from this runbook alone. Commit.

---

## W1.3 — `<TodayLoggerMobile>` with offline contract (the longest task)

Mobile-primary live workout logger. Per-set UI: weight + reps + RIR slider (0–5) + auto-rest-timer + skip + swap. State accumulates in component, flushes on each log. **IndexedDB queue keyed by `client_request_id` UUID** — the queue is the durability surface; component state is a view of the queue.

**Master plan + Appendix A absorption:**
- File paths: `frontend/src/components/programs/TodayLoggerMobile.tsx`, `<LogBufferRecovery>`, `<SessionExpiredBanner>` (per Appendix A).
- All 8 offline scenarios O1–O8 ship as part of this task (per master plan W1.3).
- CF Access expiry mid-set-log path; Safari-private-mode blocking modal (per master plan W1.3).
- Data-loss budget: zero sets silently dropped (per master plan W1.3).

### File structure

```
frontend/src/
  components/programs/
    TodayLoggerMobile.tsx           — the live logger UI
    TodayLoggerMobile.test.tsx      — unit tests + online happy path
    LogBufferRecovery.tsx           — banner: "N sets queued"; tap-to-flush; tap-to-review-rejected
    LogBufferRecovery.test.tsx
    SessionExpiredBanner.tsx        — CF Access expiry mid-set modal
    SessionExpiredBanner.test.tsx
    __offline__/                    — Playwright offline-scenario spec dir (O1–O8)
      O1-server-409.spec.ts
      O2-page-reload.spec.ts
      O3-device-switch.spec.ts      — describes-pending; full implementation deferred to staging-after-W6
      O4-network-drop.spec.ts
      O5-double-tap.spec.ts
      O6-quota-exceeded.spec.ts
      O7-7day-abandon.spec.ts
      O8-orphan-planned-set.spec.ts
  lib/
    idbQueue.ts                     — Dexie-backed queue: enqueue, peek, markPending, markSynced, markRejected
    idbQueue.test.ts                — unit tests using `fake-indexeddb`
    logBuffer.ts                    — bridge between queue + flusher; exponential backoff; replay-on-reconnect
    logBuffer.test.ts
  hooks/
    useNetworkState.ts              — online/offline + transition events
    useNetworkState.test.ts
    useRestTimer.ts                 — auto rest timer based on last log timestamp
    useRestTimer.test.ts
```

**Dexie schema (idbQueue.ts):**
```ts
// Single table: pendingSetLogs
// Primary key: client_request_id (uuid string)
// Indices: byStatus ('pending' | 'syncing' | 'synced' | 'rejected')
//          byCreatedAt (ms epoch — for FIFO replay)

export interface PendingSetLog {
  client_request_id: string;     // uuid; primary key
  queue_owner_user_id: string;   // who enqueued; checked at boot for auth-state-change purge
  planned_set_id: string;        // uuid
  performed_at: string;          // ISO with offset
  weight_lbs: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  notes: string | null;
  status: 'pending' | 'syncing' | 'synced' | 'rejected';
  rejection_reason?: 'audit_window_expired' | 'planned_set_deleted' | 'other';
  attempt_count: number;         // monotonic, incremented on each flush attempt
  next_attempt_at: number;       // ms epoch; for exponential backoff
  created_at: number;            // ms epoch; FIFO key
  updated_at: number;            // ms epoch
}
```

**Status state machine:**
```
queued ──flush attempt──> syncing ──200/201──> synced
                                ──409──> rejected (user reviews)
                                ──5xx──> queued (retry w/ backoff)
                                ──404──> rejected (planned_set deleted, O8)
                                ──(app killed)──> "syncing" persists,
                                                  reconciled to "pending" on next boot
```

**Startup reconciliation (Frontend reviewer Critical #1):** on `idbQueue.init()`, any row with `status='syncing'` is reverted to `'pending'` with `attempt_count++`. This recovers the O4-with-app-kill edge case: if the tab is force-quit between `markSyncing(id)` and the POST resolving, the row would be immortal under naive code because `peekPending()` only returns `status='pending'`. The reconciliation step makes the queue self-healing.

**Auth-state-change purge (Security reviewer Critical #2):** the queue stamps a `queueOwnerUserId` at first enqueue. On every app boot, compare the stamp to the freshly-resolved `req.userId` (via `/api/me`); mismatch → `idbQueue.purgeAll()` before render. Prevents user-A's draft set_logs from being visible to user-B if a device is borrowed mid-session.

### Steps

#### W1.3.1 — Dexie-backed `idbQueue` library

- [ ] **W1.3.1.1 — Install `fake-indexeddb` as devDep** for unit tests:
  ```bash
  cd frontend && npm install --save-dev fake-indexeddb@^6.0.0
  ```

- [ ] **W1.3.1.2 — Write failing `idbQueue.test.ts`:**
  ```ts
  import 'fake-indexeddb/auto';
  import { describe, it, expect, beforeEach } from 'vitest';
  import { idbQueue } from './idbQueue';

  describe('idbQueue', () => {
    beforeEach(async () => { await idbQueue.clear(); });

    it('enqueue + peek round-trips a single item', async () => {
      const item = mkItem({ client_request_id: 'aaa' });
      await idbQueue.enqueue(item);
      expect(await idbQueue.peekPending()).toHaveLength(1);
      expect((await idbQueue.peekPending())[0].client_request_id).toBe('aaa');
    });

    it('markSynced removes from pending', async () => {
      await idbQueue.enqueue(mkItem({ client_request_id: 'aaa' }));
      await idbQueue.markSynced('aaa');
      expect(await idbQueue.peekPending()).toHaveLength(0);
    });

    it('markRejected keeps row, status=rejected', async () => {
      await idbQueue.enqueue(mkItem({ client_request_id: 'aaa' }));
      await idbQueue.markRejected('aaa', 'audit_window_expired');
      expect(await idbQueue.peekRejected()).toHaveLength(1);
      expect((await idbQueue.peekRejected())[0].rejection_reason).toBe('audit_window_expired');
    });

    it('peekPending returns FIFO order', async () => {
      await idbQueue.enqueue(mkItem({ client_request_id: 'b', created_at: 2 }));
      await idbQueue.enqueue(mkItem({ client_request_id: 'a', created_at: 1 }));
      const out = await idbQueue.peekPending();
      expect(out.map(i => i.client_request_id)).toEqual(['a','b']);
    });

    it('QuotaExceededError throws QueueFullError to caller', async () => {
      // Mocked via fake-indexeddb's quota knob; assert custom error type
    });

    it('survives across DB reopens', async () => {
      await idbQueue.enqueue(mkItem({ client_request_id: 'p' }));
      await idbQueue.close();
      const fresh = await import('./idbQueue').then(m => m.idbQueue);
      expect(await fresh.peekPending()).toHaveLength(1);
    });

    it('reconciles stuck-in-syncing rows back to pending at init', async () => {
      // Simulate app kill mid-flush: directly write a row with status='syncing'
      await idbQueue.enqueue(mkItem({ client_request_id: 'stuck' }));
      await idbQueue.markSyncing('stuck');
      await idbQueue.close();

      // Re-init via fresh import — reconciliation runs as part of init().
      const fresh = await import('./idbQueue').then(m => m.idbQueue);
      await fresh.init();

      const pending = await fresh.peekPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].client_request_id).toBe('stuck');
      expect(pending[0].attempt_count).toBeGreaterThanOrEqual(1);
    });

    it('purgeAll wipes everything (auth-state-change support)', async () => {
      await idbQueue.enqueue(mkItem({ client_request_id: 'a' }));
      await idbQueue.enqueue(mkItem({ client_request_id: 'b' }));
      await idbQueue.purgeAll();
      expect(await idbQueue.peekPending()).toHaveLength(0);
      expect(await idbQueue.peekRejected()).toHaveLength(0);
    });
  });

  function mkItem(over: Partial<PendingSetLog> = {}): PendingSetLog {
    return {
      client_request_id: 'x', planned_set_id: 'p', performed_at: new Date().toISOString(),
      weight_lbs: 100, reps: 5, rir: 2, status: 'pending', created_at: Date.now(),
      ...over,
    };
  }
  ```

- [ ] **W1.3.1.3 — Implement `idbQueue.ts`.** Single Dexie DB `RepOSLogQueue`, version 1, table `pendingSetLogs` keyed by `client_request_id` with secondary index on `status` and `created_at`. Custom `QueueFullError` extending `Error`. **Run; pass; commit.**

#### W1.3.2 — `logBuffer` flusher

- [ ] **W1.3.2.1 — Write failing `logBuffer.test.ts`** covering:
  1. `enqueue(set)` writes to queue + triggers immediate flush attempt if online
  2. `flush()` posts each pending item; on `201`/`200` markSynced; on `409 audit_window_expired` markRejected; on `5xx` keeps as pending with `attempt_count++`; exponential backoff cap at 5 attempts
  3. `flush()` is a no-op while offline
  4. `onReconnect()` triggers flush
  5. Stable identity contract: `enqueue` accepts `(plannedSetId, fields)` and *generates* a fresh client_request_id; the same call twice creates two entries (caller's responsibility to dedupe). The dedupe-on-server is downstream.

- [ ] **W1.3.2.2 — Implement `logBuffer.ts`.** Wraps `idbQueue`. Exponential backoff: `Math.min(2^attempt, 30) * 1000` ms with jitter. On `404` → markRejected with reason `'planned_set_deleted'` (O8). On `QueueFullError` from enqueue → throw to caller (O6 surface). **Pass; commit.**

#### W1.3.3 — Hooks: `useNetworkState`, `useRestTimer`

- [ ] **W1.3.3.1 — Write failing tests for both hooks.** `useNetworkState`: returns `{online: boolean, transitionedAt: number}`; fires custom `'reconnect'` event on offline→online. `useRestTimer`: takes `{lastLoggedAt, targetRestSec}`, returns `{elapsedSec, remainingSec, isOvertime}`; updates every 1s via `setInterval`; cleans up on unmount.

- [ ] **W1.3.3.2 — Implement both hooks. Pass; commit.**

#### W1.3.4 — `<TodayLoggerMobile>` online happy path

- [ ] **W1.3.4.1 — Write failing `TodayLoggerMobile.test.tsx`** covering rendering a planned set + tapping "Log" + asserting `logBuffer.enqueue` called with the right shape + UI shows "✓ logged" affordance.

- [ ] **W1.3.4.2 — Build the component.** Mobile-first layout. Props: `{ dayWorkout: DayWorkout, mesocycleRunId: string }`. Internal state machine (per planned set): `idle → input → logging → logged → resting`. On "Log" tap: call `logBuffer.enqueue(plannedSetId, {weight_lbs, reps, rir, performed_at: now})` → optimistic UI flip. Rest timer auto-starts. Component listens to queue status changes via a `useIdbQueueStatus(clientRequestId)` hook so the affordance reflects server response.

  **Client-side debounce on Log button (resolves O5 contradiction):** the Log button has a 500ms `disabled` window after press to prevent fast double-taps from creating two queue rows. This makes the UI explicit ("Set queued · Log disabled 500ms") and avoids ever needing to flash "2 sets queued". The server-side dedupe (W1.2.4 minute-bucket) remains the source of truth — debounce is purely a UX layer.

  **A11y requirements (Frontend Important #3):**
  - **Focus management:** after Log success, `useEffect` moves focus to the *next planned set's* weight input. End-of-day-workout focuses the "Workout complete" CTA. Use a `useFocusOnEvent('set-logged')` hook.
  - **RIR slider:** `role="slider"`, `aria-valuemin={0}`, `aria-valuemax={5}`, `aria-valuenow={rir}`, `aria-label="RIR — reps in reserve"`, keyboard arrow keys (`ArrowLeft/Right` ±1) and Home/End (0/5).
  - **Status announcements:** wrap each set's affordance in `<div role="status" aria-live="polite">`. Status transitions ("Set queued offline", "Set logged", "Set rejected — review") announce automatically.
  - **`aria-busy`:** Log CTA gets `aria-busy={status === 'syncing'}` so SR users hear "logging…" instead of an idle button.

  Visual conformance per design tokens: JetBrains Mono for weight/reps/RIR; Inter Tight for labels. Accent `#4D8DFF` for the Log CTA. Color tokens from `CLAUDE.md` "Design System".

- [ ] **W1.3.4.3 — Mount `<TodayLoggerMobile>` at a NEW route `/today/:mesocycleRunId/log`.** **Do not fork the existing `TodayWorkoutMobile.tsx`** (Frontend Important #6 — it's a read-only pre-workout summary, not a logger placeholder). Instead:
  1. Add `<Route path="/today/:mesocycleRunId/log" element={<TodayLoggerMobile />} />` to the router (locate the existing route table — likely `frontend/src/App.tsx` or `frontend/src/routes/`).
  2. In `TodayWorkoutMobile.tsx`, wire the existing "Start Workout" CTA's `onStart` callback to `navigate('/today/${runId}/log')` instead of (or in addition to) the current implementation.
  3. **Add a frontend smoke test** asserting the logger appears when route is `/today/:mesocycleRunId/log` on viewport <768px.

- [ ] **W1.3.4.4 — Commit happy-path logger.**

#### W1.3.5 — `<LogBufferRecovery>` banner

- [ ] **W1.3.5.1 — Write failing test.** Renders nothing when queue is empty. Renders `"OFFLINE · N sets queued"` when `online=false && pendingCount>0`. Renders `"N sets syncing..."` during a flush. Renders `"⚠ N sets rejected — review"` when `rejectedCount>0`; tap navigates to a review sheet.

- [ ] **W1.3.5.2 — Implement.** Subscribes to `useIdbQueueCounts()` (`pending`, `syncing`, `rejected`). Render as a top-banner under the AppShell header, fixed-position, only when counts > 0. **Refinements per Frontend reviewer Important #4:**
  - **Safe-area inset:** `top: calc(72px + env(safe-area-inset-top))` so the banner doesn't tuck under iOS notch / Dynamic Island when installed as PWA.
  - **Route-aware suppression:** use `useLocation()` to render only on `/today/*`, `/programs/*`, `/` routes (where the user is mid- or pre-workout). Suppress on `/settings/*` (the user is already resolving the issue), `/login`, CF Access redirect surfaces.
  - **Banner copy:**
    - `pendingCount > 0 && !online`: `OFFLINE · ${pendingCount} sets queued`
    - `syncingCount > 0`: `${syncingCount} sets syncing…`
    - `rejectedCount > 0`: `⚠ ${rejectedCount} sets rejected — review` (tap → `/settings/storage`)

  **Pass; commit.**

#### W1.3.6 — Offline scenarios O1–O8

Each O# ships as its own Playwright spec at `frontend/src/components/programs/__offline__/O{N}-...spec.ts`. Each spec:
1. Starts a Playwright session
2. Seeds a known mesocycle via the API (or via test fixtures)
3. Simulates the relevant condition (offline mode, server 409, etc.)
4. Asserts user-visible state matches the master-plan row + IndexedDB state matches expected

**Shared helpers**: `frontend/src/components/programs/__offline__/_helpers.ts` (sets up Playwright network conditions, exposes `goOffline()/goOnline()`, inspects IDB via `evaluate`).

- [ ] **W1.3.6.1 — Write `_helpers.ts`** with `goOffline()`, `goOnline()`, `inspectQueue()`, `seedMesocycle(page, opts)`.

  **Critical:** at the top of `_helpers.ts`, include the comment **`// DO NOT import 'fake-indexeddb' here — Playwright runs against real chromium IDB`** (per Frontend reviewer Critical #3). The split is: `fake-indexeddb` is for Vitest only (`idbQueue.test.ts`, `logBuffer.test.ts`); Playwright specs always run against chromium's real IDB. An engineer who naively imports the fake in a `.spec.ts` would silently pass tests against the wrong store.

  `inspectQueue()` implementation:
  ```ts
  export async function inspectQueue(page: Page): Promise<PendingSetLog[]> {
    return page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('RepOSLogQueue');
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      });
      const tx = db.transaction('pendingSetLogs', 'readonly');
      const store = tx.objectStore('pendingSetLogs');
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      });
    });
  }
  ```
  Use this in every O# spec's IDB-state assertions — never rely on UI-only inspection.

- [ ] **W1.3.6.2 — O1: Server returns 409 on queued set.**
  - Setup: seed user; queue a set whose performed_at is >24h ago (server will reject as audit_window_expired).
  - Act: trigger flush.
  - Assert: banner shows `"1 set rejected — tap to review"`; IDB row status = `rejected`; reason = `audit_window_expired`; row does NOT silently disappear.

- [ ] **W1.3.6.3 — O2: Page reload mid-queue.**
  - Setup: 3 sets queued, offline.
  - Act: reload page, then go online.
  - Assert: on reload, banner shows `"3 sets queued"`; after reconnect, all 3 flush; no double-submit (server-side dedupe verified via GET /api/set-logs returning exactly 3 rows).

- [ ] **W1.3.6.4 — O3: Device switch mid-workout / site-data cleared.**
  - **Two parts** (per Frontend reviewer Important #5 — naive scope reduction undersold the real risk):
    1. **Unit test** (in `logBuffer.test.ts`) asserting the idempotency contract: `client_request_id` generated on Device A + same UUID from Device B → server returns 200 deduped. Acts as a unit-level proxy for the cross-device case until W5.5 DR infrastructure exists.
    2. **Playwright spec** simulating the realistic single-device case: user reinstalls the PWA or clears site data mid-workout. Steps:
       a. Seed user; log 3 sets online (synced).
       b. `await context.clearCookies()` + delete the `RepOSLogQueue` IDB via `page.evaluate(() => indexedDB.deleteDatabase('RepOSLogQueue'))`.
       c. Reload page; log a 4th set on the same planned_set with a *new* client_request_id but same minute bucket.
       d. **Assert:** server's `GET /api/set-logs?planned_set_id=...` returns 3 rows (not 4) — the minute-bucket dedupe prevents the 4th from creating a duplicate.

- [ ] **W1.3.6.5 — O4: Network drop mid-flush.**
  - Setup: 5 sets queued; online.
  - Act: while flush is in-flight, `goOffline()` after 2 sets posted.
  - Assert (via `inspectQueue()`, NOT just UI):
    - 3 remaining sets have `status === 'pending'`.
    - `attempt_count > 0` on at least one of them.
    - **Backoff curve assertion** (QA reviewer Important #3): the `next_attempt_at` field grows roughly geometrically across retries. Specifically: capture two snapshots ~3s apart while still offline; assert `(snapshot2.next_attempt_at - snapshot1.next_attempt_at) > 1000ms`. **Plus** a parallel unit test in `logBuffer.test.ts` asserting the exact delay sequence `[1s, 2s, 4s, 8s, 16s, 30s]` (cap at 30s, jitter ±10%).
    - After `goOnline()`, all flush within 30s.
    - Final `inspectQueue()` returns zero rows with `status='pending'` or `'syncing'`.

- [ ] **W1.3.6.6 — O5: Double-tap.**
  - Setup: online. Attempt to tap "Log" twice within 500ms.
  - Assert (consistent with the W1.3.4.2 client-side debounce decision):
    - **Only one IDB row** (`inspectQueue().length === 1`) — the second tap is dismissed by the 500ms `aria-busy` window.
    - Server returns 201 on the first POST; no second POST is issued.
    - UI does not flash "2 sets queued" at any point during the interaction.
  - **Counterpart test for `client_request_id` regenerated case** (e.g. user releases finger, taps again at 600ms): server returns 200 deduped:true via minute-bucket dedupe; IDB has 2 rows (one synced, one minute-bucket-deduped marked synced via fallback SELECT).

- [ ] **W1.3.6.7 — O6: IndexedDB quota exceeded.**
  - Setup: simulate quota via Playwright `context.addInitScript` overriding Dexie's underlying IDB to throw `QuotaExceededError` after N rows.
  - Act: try to log a set when at quota.
  - Assert: blocking banner `"Storage full — clear older offline sessions in Settings"`; "Clear" CTA visible; app does not crash; clearing removes synced rows and unblocks.

- [ ] **W1.3.6.8 — O7: Queue abandoned 7 days.**
  - Setup: pre-seed IDB with a row whose `created_at` is 7+ days old + status `pending`.
  - Act: open app.
  - Assert: banner shows `"1 set queued · 7 days old · flush or clear?"`; user can choose; staleness is surfaced.

- [ ] **W1.3.6.9 — O8: Orphan planned_set.**
  - Setup: queue a set whose `planned_set_id` no longer exists server-side.
  - Act: flush.
  - Assert: server returns 404; banner `"1 set could not sync — original workout no longer exists"`; status = `rejected`, reason `planned_set_deleted`.

- [ ] **W1.3.6.10 — Run all 8 specs headless.**
  ```bash
  cd frontend && npx playwright test src/components/programs/__offline__/
  ```
  All green.

- [ ] **W1.3.6.11 — Commit O1–O8.**

#### W1.3.7 — CF Access expiry handling

- [ ] **W1.3.7.1 — Write failing test for `<SessionExpiredBanner>`** — appears when a set-log POST returns 401 with `WWW-Authenticate: CFAccess`. Stashes the unflushed buffer to BOTH localStorage AND IDB queue; redirects to `https://repos.jpmtech.com/cdn-cgi/access/login` with `redirect_url` back to `/today/:id`.

  **Why both localStorage AND IDB (Frontend reviewer Important #1):** localStorage is the **synchronous** signal "we have unflushed work" available before IDB opens on next page load — IDB open is async and racey with the redirect. IDB is the durable store. They're not redundant: localStorage prevents the post-login flash of "nothing queued" before IDB reopens. Code comment must capture this rationale so future engineers don't simplify it out.

- [ ] **W1.3.7.2 — Safari-private-mode case** — when `localStorage.setItem` throws (Safari private blocks it), show a blocking modal `"Your session expired. Sign in to save N unlogged sets."` with a single "Sign in" CTA. Test via `vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); })`.

- [ ] **W1.3.7.2.5 — Auth-state-change purge (Security reviewer Critical #2).** On app bootstrap, after `/api/me` resolves:
  ```ts
  const me = await fetch('/api/me').then((r) => (r.ok ? r.json() : null));
  if (me && me.id !== (await idbQueue.getQueueOwnerUserId())) {
    await idbQueue.purgeAll();
  }
  await idbQueue.setQueueOwnerUserId(me?.id);
  ```
  Add `getQueueOwnerUserId()` / `setQueueOwnerUserId()` to `idbQueue.ts` (stored in a single-row `metadata` Dexie table, key = `'queueOwnerUserId'`). **Write a Vitest case** covering: enqueue as user-A → swap `/api/me` mock to user-B → re-init bootstrap → assert `peekPending().length === 0`. **Pass; commit.**

- [ ] **W1.3.7.3 — Wire `<SessionExpiredBanner>` into AppShell.** **Implement; pass; commit.**

#### W1.3.8 — Settings: "Clear offline sessions" affordance

- [ ] **W1.3.8.1 — Add a "Storage" section to `SettingsAccount.tsx`** (or a new `SettingsStorage.tsx`) listing: synced rows count (clearable), rejected rows count (clearable with confirm), pending count (NOT clearable — would lose data). **Test; implement; commit.**

#### W1.3.9 — Type-check + frontend test run

- [ ] **W1.3.9.1 — `cd frontend && npm run typecheck && npm test 2>&1 | tail -5`** — both green.

---

## W1.5 — End-to-end integration (W1 ↔ W3 data flow + volume rollup)

Per master plan: "Logging 3 RIR-0 sessions on a compound exercise via `POST /api/set-logs` surfaces the overreaching toast on the next `/api/recovery-flags` poll." Plus the W1 acceptance bullet "desktop MyProgramPage shows volume rollup updated."

**Scope caveat:** the W3 evaluator hasn't shipped. This wave's W1.5 ships TWO assertions:
1. **A direct W3-query structural assertion** (QA reviewer Important #4) — the data shape W3 will consume, exercised against the real DB. If this passes, the W3 evaluator is reduced to wiring the query.
2. **A volume rollup assertion** (QA reviewer Critical #2) — verifies that after `POST /api/set-logs`, the existing `GET /mesocycles/:id/volume-rollup` endpoint reflects the new set. This closes the otherwise-unasserted "MyProgramPage shows volume rollup updated" acceptance bullet.

The W3 UI assertion (overreaching toast) is `test.fixme`-gated until W3 ships.

**Files:**
- New: `frontend/playwright/set-logs-to-recovery-flags.spec.ts`
- New: `api/tests/integration/set-logs-volume-rollup.test.ts`

### Steps

- [ ] **W1.5.1 — Write the W3-shape Playwright spec.**
  ```ts
  import { test, expect } from '@playwright/test';
  import { db } from '../../api/src/db/client'; // use the same pool

  test('three RIR-0 set_logs on a compound exercise produce the W3-eligible signal shape', async ({ page, request }) => {
    const { bearer, plannedSetIds, exerciseId, userId } = await test.step('seed', async () =>
      seedCompoundMesocycle(request));

    for (let i = 0; i < 3; i++) {
      await request.post('/api/set-logs', {
        headers: { authorization: `Bearer ${bearer}` },
        data: {
          client_request_id: crypto.randomUUID(),
          planned_set_id: plannedSetIds[i],
          weight_lbs: 225, reps: 5, rir: 0,
          performed_at: new Date(Date.now() - (i * 24 * 60 * 60 * 1000)).toISOString(),
        },
      });
    }

    // Direct query of what the W3 evaluator will consume — if this returns the
    // seeded compound exercise with count >= 3, W3 is reduced to wiring.
    const { rows } = await db.query(`
      SELECT exercise_id, COUNT(*)::int AS count
      FROM set_logs
      WHERE user_id = $1
        AND rir = 0
        AND performed_at > now() - INTERVAL '7 days'
      GROUP BY exercise_id
      HAVING COUNT(*) >= 3`, [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exercise_id: exerciseId, count: 3 });

    // W3 UI assertion — `test.fixme` until /api/recovery-flags ships.
    test.fixme(true, 'W3 evaluator not yet shipped — re-enable when W3.1 lands');
    await page.goto('/today');
    await expect(page.locator('[role="status"]')).toContainText(/overreaching/i);
  });
  ```

- [ ] **W1.5.2 — Write the volume-rollup integration test.**
  Create `api/tests/integration/set-logs-volume-rollup.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { build } from '../helpers/build-test-app';
  import { seedUserWithMesocycle } from '../helpers/seed-fixtures';

  describe('set_logs → volume rollup', () => {
    it('POST /api/set-logs increments the mesocycle volume rollup for that exercise', async () => {
      const app = await build();
      const { bearer, plannedSetId, mesocycleRunId, exerciseId } = await seedUserWithMesocycle();

      const before = await app.inject({ method: 'GET', url: `/api/mesocycles/${mesocycleRunId}/volume-rollup`,
        headers: { authorization: `Bearer ${bearer}` } });
      const beforeCount = before.json().rollup.find((r: any) => r.exercise_id === exerciseId)?.set_count ?? 0;

      await app.inject({ method: 'POST', url: '/api/set-logs',
        headers: { authorization: `Bearer ${bearer}` },
        payload: {
          client_request_id: crypto.randomUUID(),
          planned_set_id: plannedSetId,
          weight_lbs: 200, reps: 5, rir: 1,
          performed_at: new Date().toISOString(),
        },
      });

      const after = await app.inject({ method: 'GET', url: `/api/mesocycles/${mesocycleRunId}/volume-rollup`,
        headers: { authorization: `Bearer ${bearer}` } });
      const afterCount = after.json().rollup.find((r: any) => r.exercise_id === exerciseId)?.set_count ?? 0;

      expect(afterCount).toBe(beforeCount + 1);
    });
  });
  ```
  **Read `api/src/services/volumeRollup.ts` first** to confirm the actual endpoint path + response shape. If the endpoint mounts at a different path (e.g. `/api/programs/...` or via `mesocycles.ts`), adjust the test URLs. The rollup is a computed view — no rollup-side code change should be needed for W1; this test verifies that.

- [ ] **W1.5.3 — Run both tests; first two assertions pass; the `test.fixme` block is skipped. Commit.**

---

## EOP — End of plan

- [ ] **EOP.1 — Full local test run.**
  ```bash
  cd /Users/jasonmeyer.ict/Projects/RepOS/api && npm test && npm run typecheck && npm run build
  cd /Users/jasonmeyer.ict/Projects/RepOS/frontend && npm test && npm run typecheck && npm run build
  ```
  Expected: api 393 + ~40 new = 430+; frontend 129 + ~30 new = 160+; typecheck + build clean both sides.

- [ ] **EOP.2 — Playwright run headless.**
  ```bash
  cd frontend && npx playwright install --with-deps && npx playwright test
  ```
  Expected: all O1–O8 + W1.5 green; `test.fixme` shown as expected.

- [ ] **EOP.3 — Push branch.**
  ```bash
  git push -u origin beta/w1-live-data-foundation
  ```

- [ ] **EOP.4 — Post-execution specialist review.** Per memory `feedback_get_plan_reviewed.md`, the **pre-execution** plan review already happened (see "Re-review absorption" section at end). This EOP.4 is the **post-execution** review of the actual code, dispatched after EOP.3 push:
  1. **Backend reviewer** — Verify migration 029 + 030 ran clean against a freshly seeded DB; idempotency probe under concurrent load; ownership-check correctness.
  2. **Frontend reviewer** — Verify offline state machine in browser (use the running Playwright suite as observation, plus a real-device test); a11y pass on the logger (axe-core).
  3. **QA reviewer** — Re-walk master plan W1 acceptance bullets against the merged code; confirm O1–O8 specs assert what the master matrix requires.
  4. **Security reviewer** — Probe the deployed routes from outside CF Access; verify `/api/health/weight` rejects workouts-scope bearer (the alpha backport from W1.4.0 is the new attack surface).

  **Absorb non-blocking nits inline; block on anything Critical/Important per memory `feedback_ship_clean.md`.**

- [ ] **EOP.5 — Open PR.**
  ```bash
  gh pr create --title "Beta W1: live data foundation (set_logs API + offline-tolerant logger + workouts ingest)" --body "$(cat <<'EOF'
  ## Summary
  - W1.1: `set_logs` Beta columns (migration 029)
  - W1.2: `POST/PATCH/DELETE/GET /api/set-logs` with idempotency + 24h audit window
  - W1.3: `<TodayLoggerMobile>` with offline IDB queue + all 8 O# scenarios + CF Access expiry handling
  - W1.4: `health_workouts` table + `POST /api/health/workouts` + `health:workouts:write` scope + iOS Shortcut runbook
  - W1.5: end-to-end Playwright structural test for W1→W3 data flow (W3-dependent assertion fixme-gated)

  ## Test plan
  - [x] API unit + integration tests green
  - [x] Frontend Vitest green
  - [x] Playwright O1–O8 green
  - [x] Typecheck + build clean both sides
  - [ ] Specialist review (4 parallel agents)
  - [ ] User merge

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **EOP.6 — Wait for CI; absorb review; merge.** **Phase B** (operational): none — W1 has no operational cutover, the new code is live on next image rebuild.

---

## Troubleshooting

| Symptom | Likely cause | Recovery |
|---------|--------------|----------|
| `relation "exercises" does not exist` in migration 029 | Test DB out of date | `npm run migrate` to apply 008–028 first |
| `null value in column "user_id" violates not-null` in migration 029 | Backfill UPDATE missed rows (e.g. set_log with deleted planned_set) | Add `DELETE FROM set_logs WHERE planned_set_id NOT IN (SELECT id FROM planned_sets)` before the NOT NULL alter, OR drop the orphan check — alpha data is throwaway for non-weight tables per memory `project_alpha_state.md` |
| `409 audit_window_expired` in O1 test setup | Test seeded `performed_at` is real time, not mocked | Use `vi.setSystemTime()` to freeze clock; seed at frozen-now-minus-25h |
| Playwright IDB inspection returns empty | `page.evaluate` runs in browser context but `'fake-indexeddb/auto'` import is node-only | Use real IDB in Playwright (chromium has one); only use `fake-indexeddb` for Vitest |
| Dexie `DatabaseClosedError` on hot reload | Module-level singleton survives reload but underlying DB doesn't | Add a `idbQueue.reopen()` and call in test `beforeEach` |
| iOS Shortcut returns 401 after CF Access flip | Bypass policy for `/api/health/*` not in effect | Verify with `curl -I https://repos.jpmtech.com/api/health/workouts` — should be 401 from the api (not 302 to CF) |
| `health:workouts:write` not recognised | Scope enum not updated in token-mint route | Grep `health:weight:write` in `api/src/`, add the new scope to every union/check |

---

## Appendix — Reference patterns

### Auth middleware usage

```ts
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';

fastify.post('/api/your-route', {
  preHandler: [requireBearerOrCfAccess, requireScope('health:weight:write')],
}, async (req, reply) => {
  // Defensive assertion (Security reviewer Important #5): if `req.userId` is
  // ever undefined here, a future middleware regression has silently broken
  // auth. Cheap to add; makes the failure loud.
  if (!req.userId) return reply.code(500).send({ error: 'auth_state_missing' });

  const userId = req.userId; // never trust client-supplied user_id
  // ... handler
});
```

### Test app builder (helper to create)

```ts
// api/tests/helpers/build-test-app.ts
import Fastify from 'fastify';
import setLogsRoutes from '../../src/routes/setLogs.js';
import workoutsRoutes from '../../src/routes/workouts.js';
import weightRoutes from '../../src/routes/weight.js';
// ... etc.

export async function build() {
  const app = Fastify();
  await app.register(setLogsRoutes);
  await app.register(workoutsRoutes);
  await app.register(weightRoutes);
  await app.ready();
  return app;
}
```

### Fixture seeder shape

```ts
// api/tests/helpers/seed-fixtures.ts
//
// CONCURRENCY CONTRACT (QA reviewer Critical #3):
//   - Every helper mints a FRESH `crypto.randomUUID()` for users / mesocycles /
//     planned_sets so parallel Vitest workers don't collide on FK chains.
//   - Helpers return all minted IDs so caller can pass them to `cleanupSeeded(ids)`
//     in an afterEach hook.
//   - Do NOT hardcode user IDs anywhere in this file.

export interface SeedHandle {
  userId: string;
  bearer: string;
  mesocycleRunId: string;
  dayWorkoutId: string;
  plannedSetId: string;
  exerciseId: string;
}

export async function seedUserWithMesocycle(): Promise<SeedHandle> {
  const userId = crypto.randomUUID();
  // 1. INSERT users (id=$userId, email=`${userId}@test.local`)
  // 2. mintBearer({userId, scopes: ['health:weight:write']})
  // 3. INSERT program_template, user_program (using a fixed seed exercise from migration 009)
  // 4. INSERT mesocycle_run, day_workout, planned_set (all with fresh UUIDs)
  // 5. Return SeedHandle
}

export async function seedUserWithLoggedSet(opts: { minutesAgo: number }): Promise<SeedHandle & { setLogId: string }> {
  const base = await seedUserWithMesocycle();
  // INSERT set_log with performed_at = NOW() - opts.minutesAgo * INTERVAL '1 minute'
  return { ...base, setLogId: '<inserted-id>' };
}

export async function seedThreeLogsOnSamePlannedSet(): Promise<SeedHandle & { setLogIds: string[] }> {
  // Three set_logs on the same planned_set, 1min/2min/3min performed_at offsets
}

export async function mintBearer(opts: { userId?: string; scopes: string[] }): Promise<{ bearer: string; userId: string }> {
  // If userId omitted, mint a fresh user first.
  // Use the existing /api/tokens flow OR call the underlying minter directly.
}

export async function cleanupSeeded(handle: SeedHandle | SeedHandle[]): Promise<void> {
  // DELETE FROM users WHERE id = ANY($1) — cascades to all owned rows via FK CASCADE.
  // Idempotent; safe to call in afterEach even on test failure.
}
```

**Vitest setup (use in any file calling these helpers):**
```ts
// api/tests/helpers/seed-fixtures.test-setup.ts
import { afterEach } from 'vitest';
import { cleanupSeeded } from './seed-fixtures';

const seededHandles: SeedHandle[] = [];
afterEach(async () => {
  if (seededHandles.length) {
    await cleanupSeeded(seededHandles.splice(0));
  }
});
// Pattern: each `seedX()` helper pushes its return value into `seededHandles`.
```

### Conventional Commit examples for this wave

- `feat(db): set_logs Beta columns + idempotency indices (migration 029)` — W1.1
- `feat(api): POST /api/set-logs with idempotency + ownership check (W1.2)` — W1.2.1–10
- `feat(api): PATCH /api/set-logs/:id with 24h audit window (W1.2)` — W1.2.11–13
- `feat(api): DELETE /api/set-logs/:id with 24h audit window (W1.2)` — W1.2.14–15
- `feat(api): GET /api/set-logs?planned_set_id= with IDOR-safe filtering (W1.2)` — W1.2.16–18
- `feat(db): health_workouts table (migration 030)` — W1.4.1–3
- `feat(api): health:workouts:write scope (W1.4)` — W1.4.4
- `feat(api): POST /api/health/workouts ingest (W1.4)` — W1.4.5–7
- `docs(runbooks): iOS Shortcuts authoring guide (W1.4)` — W1.4.8
- `feat(frontend): idbQueue + logBuffer offline foundation (W1.3)` — W1.3.1–2
- `feat(frontend): useNetworkState + useRestTimer hooks (W1.3)` — W1.3.3
- `feat(frontend): TodayLoggerMobile online happy path (W1.3)` — W1.3.4
- `feat(frontend): LogBufferRecovery banner (W1.3)` — W1.3.5
- `test(frontend): offline scenarios O1–O4 (W1.3)` — W1.3.6.1–5
- `test(frontend): offline scenarios O5–O8 (W1.3)` — W1.3.6.6–9
- `feat(frontend): SessionExpiredBanner + Safari private-mode handling (W1.3)` — W1.3.7
- `feat(frontend): Settings storage management (W1.3)` — W1.3.8
- `test(e2e): set_logs → recovery_flags structural integration (W1.5)`

---

---

## Re-review absorption (2026-05-12)

Per memory `feedback_get_plan_reviewed.md`, the initial synthesis of this plan was dispatched to 4 parallel reviewers (Backend, Frontend, QA, Security) for a pre-execution sign-off pass. All 4 returned **APPROVED WITH CHANGES**. Findings absorbed in-place:

**Critical (all 10 absorbed):**
1. **Backend C1 — Migration 029 backfill orphans.** Added `DELETE FROM set_logs WHERE user_id IS NULL OR exercise_id IS NULL` before `SET NOT NULL` (W1.1.3).
2. **Backend C2 — Idempotency TOCTOU race.** Replaced probe-then-INSERT with atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING *` + fallback SELECT (W1.2.4); collapsed W1.2.7–10 into W1.2.7–8.
3. **Frontend C1 — Stuck-in-syncing recovery.** Added init-time reconciliation: `status='syncing'` → `'pending'` with `attempt_count++` on `idbQueue.init()`. New Vitest case in W1.3.1.2.
4. **Frontend C2 — Column-mapping coherence.** Dropped the `(r as any)` `mapRow` cast helper; every SELECT/RETURNING in `setLogs.ts` aliases the alpha column names to the API contract names at the SQL layer.
5. **Frontend C3 — Playwright IDB inspection split.** Added explicit `// DO NOT import 'fake-indexeddb' here` comment requirement to `_helpers.ts` skeleton; `inspectQueue()` implementation shown in W1.3.6.1.
6. **QA C1 — Playwright infra missing.** Added Pre.5 task installing `@playwright/test`, scaffolding `playwright.config.ts` with both spec roots, smoke spec, and `npx playwright install`.
7. **QA C2 — Volume rollup unasserted.** Added `api/tests/integration/set-logs-volume-rollup.test.ts` (W1.5.2) verifying that POST `/api/set-logs` reflects in the existing `GET /mesocycles/:id/volume-rollup`.
8. **QA C3 — Fixture concurrency.** Updated Appendix seed-fixture shape: every helper mints fresh UUIDs; `cleanupSeeded()` for afterEach; no hardcoded IDs.
9. **Security C1 — Scope enforcement stub.** Added W1.4.0 Pre-W1.4 backport step: extend `requireAuth` to load `device_tokens.scopes`, add `requireScope()` preHandler, wire onto existing `/api/health/weight` routes with `health:weight:write`. Inverse-scope regression test ships before W1.4 does.
10. **Security C2 — Auth-state-change purge.** Added `queueOwnerUserId` stamp to `PendingSetLog` + W1.3.7.2.5 bootstrap purge step + Vitest case.

**Important (most absorbed; remaining are nits documented inline):**
- **IDOR contract** (Security Important #1+2): all write endpoints (POST/PATCH/DELETE) now collapse "not found" + "not owned" into 404; GET keeps 200+empty. Documented in the new "IDOR contract" section.
- **SQL audit-window math** (Backend Important #4): PATCH and DELETE now check `performed_at > now() - INTERVAL '24 hours'` server-side; eliminates API/DB clock-skew window.
- **Workouts rate limit** (Backend Important #5): raised from 5/day to 10/day; explicit assertion code in W1.4.5.
- **modality CHECK scope creep** (Backend Important #6): dropped the SQL CHECK; Zod schema owns the allowlist.
- **A11y for `<TodayLoggerMobile>`** (Frontend Important #3): explicit focus management hook, RIR-slider ARIA roles, `aria-live="polite"` status regions, `aria-busy` on Log CTA — all in W1.3.4.2.
- **Banner safe-area + route awareness** (Frontend Important #4): `env(safe-area-inset-top)`; `useLocation()`-driven suppression on `/settings/*`/`/login`. In W1.3.5.2.
- **O3 expansion** (Frontend Important #5): added the IDB-cleared Playwright spec alongside the cross-device unit-test proxy.
- **TodayLoggerMobile route separation** (Frontend Important #6): new `/today/:runId/log` route; do NOT fork `TodayWorkoutMobile.tsx`.
- **Double-stash rationale comment** (Frontend Important #1): code-comment requirement on W1.3.7.1 so future engineers don't simplify localStorage out.
- **O5 client-side debounce** (Frontend Important #2): 500ms Log-button debounce; spec updated.
- **O4 backoff curve assertion** (QA Important #3): explicit `next_attempt_at` geometric-growth check + parallel Vitest sequence assertion.
- **W1.5 structural assertion strengthening** (QA Important #4): direct SQL `GROUP BY HAVING COUNT(*) >= 3` query in the Playwright spec.
- **DELETE IDOR cross-user test** (QA Important #6): added third `it` case to W1.2.14.
- **iOS Shortcut secret-handling** (Security Important #4): explicit token hygiene guidance added to W1.4.8 outline section 1.
- **`req.userId` defensive assertion** (Security Important #5): `if (!req.userId) return 500 auth_state_missing` guard, demonstrated in the Auth Reference Appendix.

**Nits left for engineer to absorb during execution:** plan format polish, regex assertions, conventional commit boundaries, comment cleanup — captured in inline `*\(per reviewer Nit #N\)*` cues throughout.

**Pre-execution review verdict (synthesized):** APPROVED.

---

*End of W1 per-wave plan. Acceptance: master plan W1 acceptance bullets, lines 237–243.*
