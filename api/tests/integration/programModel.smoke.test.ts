/**
 * api/tests/integration/programModel.smoke.test.ts
 *
 * Full-stack smoke test: fork → start → today → volume-rollup → override →
 * second-/start-409 (one-active-run rule).
 *
 * ── Test infra choice ────────────────────────────────────────────────────────
 * REAL POSTGRES via the existing local `repos_test` database.
 *
 * Why NOT pg-mem:
 *   • partial unique index (mesocycle_runs WHERE status='active') — pg-mem does
 *     not support partial indexes. The one-active-run guardrail is tested below
 *     and is a non-negotiable correctness path.
 *   • Custom PG ENUMs (day_workout_kind, program_status, mesocycle_run_event_type)
 *     — pg-mem has partial enum support but fails on UNNEST with typed arrays.
 *   • materializeMesocycle uses ISOLATION LEVEL SERIALIZABLE + retry-on-40001,
 *     which pg-mem does not implement.
 *
 * Why NOT testcontainers-node:
 *   • Docker is not available in this development environment.
 *
 * Local setup:
 *   DATABASE_URL in api/.env points at postgres://repos@127.0.0.1:5432/repos_test.
 *   That DB is fully migrated (all 027 migrations applied) and seeded
 *   (3 program templates, 40 exercises).
 *
 * How to run:
 *   cd /Users/jasonmeyer.ict/Projects/RepOS/api
 *   npm run test:integration
 *   # or target this file directly:
 *   npx vitest run tests/integration/programModel.smoke.test.ts
 *
 * The test cleans up after itself (cascading DELETE on the user row removes
 * all dependent rows). It does NOT truncate shared seed tables.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let token: string;

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await buildApp();

  // Insert an isolated test user via the shared fixture helper.
  // crypto.randomUUID() in mkUser guarantees no email collision with parallel runs.
  const u = await mkUser({ prefix: 'vitest.smoke', goal: 'maintain' });
  userId = u.id;

  // Mint a real bearer token via the /api/tokens admin path.
  // ADMIN_API_KEY is unset in .env → requireAdminKeyOrCfAccess is open for tests.
  // This uses argon2.hash internally so the auth middleware can verify it correctly.
  const mintRes = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'smoke-test' },
  });
  expect(mintRes.statusCode).toBe(201);
  token = mintRes.json<{ token: string }>().token;
});

afterAll(async () => {
  await cleanupUser(userId);
  await app.close();
  await db.end();
});

describe('program model v1 smoke — golden path', () => {
  /**
   * Single sequential test covering the full happy path.
   * Kept as one `it` so the state (userProgram, mesocycle_run) flows naturally
   * through each step without shared mutable closures between separate tests.
   */
  it('list templates → fork → start → today → volume-rollup → override → second-/start-409', async () => {
    // ── 1. List templates ────────────────────────────────────────────────────
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/program-templates',
      headers: auth(token),
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json<{ templates: Array<{ slug: string }> }>();
    expect(Array.isArray(listBody.templates)).toBe(true);
    // Seed has 3 templates; sanity-check at least 1 exists.
    expect(listBody.templates.length).toBeGreaterThanOrEqual(1);
    const hasFourDay = listBody.templates.some(t => t.slug === 'upper-lower-4-day');
    expect(hasFourDay).toBe(true);

    // ── 2. Fork upper-lower-4-day ────────────────────────────────────────────
    const forkRes = await app.inject({
      method: 'POST',
      url: '/api/program-templates/upper-lower-4-day/fork',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke UL' }),
    });
    expect(forkRes.statusCode).toBe(201);
    const userProgram = forkRes.json<{ id: string; status: string; template_version: number }>();
    expect(typeof userProgram.id).toBe('string');
    expect(userProgram.status).toBe('draft');

    // Verify the fork produced a user_programs row in the DB.
    const { rows: [upRow] } = await db.query(
      `SELECT id, status FROM user_programs WHERE id=$1 AND user_id=$2`,
      [userProgram.id, userId],
    );
    expect(upRow).toBeDefined();
    expect(upRow.status).toBe('draft');

    // ── 3. Start the mesocycle ────────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${userProgram.id}/start`,
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        start_date: today,
        start_tz: 'America/Indiana/Indianapolis',
      }),
    });
    expect(startRes.statusCode).toBe(201);
    const startBody = startRes.json<{
      mesocycle_run_id: string;
      start_date: string;
      start_tz: string;
      weeks: number;
      status: string;
      current_week: number;
    }>();
    expect(typeof startBody.mesocycle_run_id).toBe('string');
    expect(startBody.status).toBe('active');
    expect(startBody.start_tz).toBe('America/Indiana/Indianapolis');
    expect(startBody.current_week).toBe(1);
    const mesoRunId = startBody.mesocycle_run_id;

    // Verify materialization created day_workouts and planned_sets.
    const { rows: [{ dw_count }] } = await db.query<{ dw_count: number }>(
      `SELECT COUNT(*)::int AS dw_count FROM day_workouts WHERE mesocycle_run_id=$1`,
      [mesoRunId],
    );
    // upper-lower-4-day has 4 days/week; exact count depends on template weeks.
    expect(dw_count).toBeGreaterThan(0);

    const { rows: [{ ps_count }] } = await db.query<{ ps_count: number }>(
      `SELECT COUNT(*)::int AS ps_count
       FROM planned_sets ps
       JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1`,
      [mesoRunId],
    );
    expect(ps_count).toBeGreaterThan(0);

    // Partial unique index: only one active run allowed per user.
    const { rows: [{ active_count }] } = await db.query<{ active_count: number }>(
      `SELECT COUNT(*)::int AS active_count FROM mesocycle_runs WHERE user_id=$1 AND status='active'`,
      [userId],
    );
    expect(active_count).toBe(1);

    // ── 4. Today ──────────────────────────────────────────────────────────────
    const todayRes = await app.inject({
      method: 'GET',
      url: '/api/mesocycles/today',
      headers: auth(token),
    });
    expect(todayRes.statusCode).toBe(200);
    const todayBody = todayRes.json<{ state: string }>();
    // state must be one of the three valid values.
    expect(['workout', 'rest', 'no_active_run']).toContain(todayBody.state);

    // ── 5. Volume rollup ──────────────────────────────────────────────────────
    const rollupRes = await app.inject({
      method: 'GET',
      url: `/api/mesocycles/${mesoRunId}/volume-rollup`,
      headers: auth(token),
    });
    expect(rollupRes.statusCode).toBe(200);
    const rollupBody = rollupRes.json<{
      run_id: string;
      weeks: Array<{
        week_idx: number;
        muscles: Array<{ muscle: string; sets: number; mev: number; mav: number; mrv: number }>;
        minutes_by_modality: Record<string, number>;
      }>;
    }>();
    expect(rollupBody.run_id).toBe(mesoRunId);
    expect(Array.isArray(rollupBody.weeks)).toBe(true);
    expect(rollupBody.weeks.length).toBeGreaterThan(0);
    // Each week entry has the muscle volume breakdown.
    const w1 = rollupBody.weeks[0];
    expect(w1).toHaveProperty('week_idx');
    expect(w1).toHaveProperty('muscles');
    expect(w1).toHaveProperty('minutes_by_modality');

    // ── 6. Override a planned_set (if today is a workout day) ────────────────
    if (todayBody.state === 'workout') {
      const workoutBody = todayBody as {
        state: 'workout';
        sets: Array<{ id: string }>;
      };
      if (workoutBody.sets.length > 0) {
        const setId = workoutBody.sets[0].id;
        const patchRes = await app.inject({
          method: 'PATCH',
          url: `/api/planned-sets/${setId}`,
          headers: { ...auth(token), 'content-type': 'application/json' },
          body: JSON.stringify({ target_rir: 2, override_reason: 'smoke test override' }),
        });
        expect(patchRes.statusCode).toBe(200);
        const patchBody = patchRes.json<{ id: string; target_rir: number; overridden_at: string }>();
        expect(patchBody.id).toBe(setId);
        expect(patchBody.target_rir).toBe(2);
        expect(patchBody.overridden_at).toBeTruthy();

        // Verify audit event was written.
        const { rows: [{ evt_count }] } = await db.query<{ evt_count: number }>(
          `SELECT COUNT(*)::int AS evt_count
           FROM mesocycle_run_events
           WHERE run_id=$1 AND event_type='set_overridden'`,
          [mesoRunId],
        );
        expect(evt_count).toBeGreaterThanOrEqual(1);
      }
    }

    // ── 7. Record a set_log (workout completion) ──────────────────────────────
    // Grab any planned_set from this run to log against.
    const { rows: [sampleSet] } = await db.query<{ id: string }>(
      `SELECT ps.id FROM planned_sets ps
       JOIN day_workouts dw ON dw.id = ps.day_workout_id
       WHERE dw.mesocycle_run_id = $1
       LIMIT 1`,
      [mesoRunId],
    );
    expect(sampleSet).toBeDefined();

    // Direct DB insert for set_logs (no HTTP route yet in v1; Live Logger is v2).
    await db.query(
      `INSERT INTO set_logs (planned_set_id, performed_reps, performed_load_lbs, performed_rir)
       VALUES ($1, 8, 135.0, 2)`,
      [sampleSet.id],
    );

    const { rows: [{ log_count }] } = await db.query<{ log_count: number }>(
      `SELECT COUNT(*)::int AS log_count FROM set_logs WHERE planned_set_id=$1`,
      [sampleSet.id],
    );
    expect(log_count).toBe(1);

    // ── 8. Second /start → 409 (one-active-run-per-user partial index) ───────
    // Fork a different template for this user.
    const fork2Res = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke FB' }),
    });
    // fork2 can be 201 regardless; the active-run check fires on /start.
    expect([200, 201]).toContain(fork2Res.statusCode);
    const userProgram2 = fork2Res.json<{ id: string }>();

    const start2Res = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${userProgram2.id}/start`,
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        start_date: today,
        start_tz: 'America/Indiana/Indianapolis',
      }),
    });
    expect(start2Res.statusCode).toBe(409);
    const start2Body = start2Res.json<{ error: string }>();
    expect(start2Body.error).toBe('active_run_exists');

    // Still only one active run.
    const { rows: [{ final_count }] } = await db.query<{ final_count: number }>(
      `SELECT COUNT(*)::int AS final_count FROM mesocycle_runs WHERE user_id=$1 AND status='active'`,
      [userId],
    );
    expect(final_count).toBe(1);
  });
});
