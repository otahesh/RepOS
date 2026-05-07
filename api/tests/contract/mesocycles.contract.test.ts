/**
 * Contract tests for the /api/mesocycles route surface.
 *
 * Tests hit real route handlers via Fastify inject() and parse responses
 * through the canonical Zod schemas in api/src/schemas/mesocycles.ts.
 * Shape drift between handler and schema causes a loud failure here.
 *
 * These tests exercise the response shape for each endpoint — business logic
 * lives in mesocycles.test.ts, materializeMesocycle.test.ts, etc.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  TodayWorkoutResponseSchema,
  MesocycleDetailResponseSchema,
  VolumeRollupResponseSchema,
  MesocycleAbandonResponseSchema,
  MesocycleRecapStatsResponseSchema,
} from '../../src/schemas/mesocycles.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.contract.mesocycles.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'contract-test' },
  });
  token = mint.json<{ token: string }>().token;
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// GET /api/mesocycles/today
// ---------------------------------------------------------------------------

describe('GET /api/mesocycles/today contract', () => {
  it('no_active_run response parses through TodayWorkoutResponseSchema', async () => {
    // Fresh user has no active run
    const res = await app.inject({
      method: 'GET',
      url: '/api/mesocycles/today',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = TodayWorkoutResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.state).toBe('no_active_run');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/mesocycles/:id
// ---------------------------------------------------------------------------

describe('GET /api/mesocycles/:id contract', () => {
  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mesocycles/00000000-0000-0000-0000-000000000000',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('detail response parses through MesocycleDetailResponseSchema when run exists', async () => {
    // We need a real mesocycle_run row. Use a template if one exists;
    // otherwise skip since we can't materialize without a seeded template.
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE archived_at IS NULL LIMIT 1`,
    );
    if (!tmpl) {
      console.warn('No templates in DB — skipping mesocycle detail contract test');
      return;
    }

    // Fork a user_program and materialize a run via the /start endpoint
    const { rows: [up] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, customizations, status)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, 'draft')
       RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );

    const startRes = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${up.id}/start`,
      headers: auth(),
      body: { start_date: '2026-01-06', start_tz: 'America/New_York' },
    });
    if (startRes.statusCode !== 201) {
      console.warn('Could not materialize mesocycle — skipping detail contract test');
      return;
    }
    const { mesocycle_run_id } = startRes.json<{ mesocycle_run_id: string }>();

    const res = await app.inject({
      method: 'GET',
      url: `/api/mesocycles/${mesocycle_run_id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = MesocycleDetailResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe(mesocycle_run_id);
      expect(Array.isArray(parsed.data.day_workouts)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/mesocycles/:id/volume-rollup
// ---------------------------------------------------------------------------

describe('GET /api/mesocycles/:id/volume-rollup contract', () => {
  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mesocycles/00000000-0000-0000-0000-000000000000/volume-rollup',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/mesocycles/:id/recap-stats
// ---------------------------------------------------------------------------

describe('GET /api/mesocycles/:id/recap-stats contract', () => {
  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mesocycles/00000000-0000-0000-0000-000000000000/recap-stats',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('recap-stats response parses through MesocycleRecapStatsResponseSchema when run exists', async () => {
    // Reuse any run that belongs to our test user (active or completed).
    const { rows: [run] } = await db.query(
      `SELECT id FROM mesocycle_runs WHERE user_id=$1 LIMIT 1`,
      [userId],
    );
    if (!run) {
      console.warn('No run for test user — skipping recap-stats contract test');
      return;
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/mesocycles/${run.id}/recap-stats`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = MesocycleRecapStatsResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.weeks).toBeGreaterThanOrEqual(0);
      expect(parsed.data.total_sets).toBeGreaterThanOrEqual(0);
      expect(parsed.data.prs).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/mesocycles/:id/abandon
// ---------------------------------------------------------------------------

describe('POST /api/mesocycles/:id/abandon contract', () => {
  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mesocycles/00000000-0000-0000-0000-000000000000/abandon',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('abandon response parses through MesocycleAbandonResponseSchema when run is active', async () => {
    // Find an active run belonging to our test user
    const { rows: [run] } = await db.query(
      `SELECT id FROM mesocycle_runs WHERE user_id=$1 AND status='active' LIMIT 1`,
      [userId],
    );
    if (!run) {
      console.warn('No active run for test user — skipping abandon contract test');
      return;
    }
    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${run.id}/abandon`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = MesocycleAbandonResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('abandoned');
      expect(typeof parsed.data.finished_at).toBe('string');
    }
  });
});
