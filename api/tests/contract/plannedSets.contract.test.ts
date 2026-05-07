/**
 * Contract tests for the /api/planned-sets route surface.
 *
 * Tests hit real route handlers via Fastify inject() and parse responses
 * through the canonical Zod schemas in api/src/schemas/plannedSets.ts.
 * Shape drift between handler and schema causes a loud failure here.
 *
 * PATCH and substitute require a real planned_set row, which means we need
 * a materialized mesocycle. When no template is seeded these tests skip
 * gracefully rather than failing.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  PlannedSetPatchResponseSchema,
  PlannedSetSubstituteResponseSchema,
} from '../../src/schemas/plannedSets.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let token: string;
let plannedSetId: string | undefined;
let targetExerciseId: string | undefined;

beforeAll(async () => {
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.contract.plannedsets.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'contract-test' },
  });
  token = mint.json<{ token: string }>().token;

  // Try to set up a materialized mesocycle so we can get a real planned_set id
  const { rows: [tmpl] } = await db.query(
    `SELECT id, version, name FROM program_templates WHERE archived_at IS NULL LIMIT 1`,
  );
  if (tmpl) {
    const { rows: [up] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, customizations, status)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, 'draft')
       RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/user-programs/${up.id}/start`,
      headers: { authorization: `Bearer ${token}` },
      body: { start_date: '2026-01-06', start_tz: 'America/New_York' },
    });
    if (startRes.statusCode === 201) {
      const { mesocycle_run_id } = startRes.json<{ mesocycle_run_id: string }>();
      // Find a planned_set row for today or future
      const { rows: [ps] } = await db.query(
        `SELECT ps.id FROM planned_sets ps
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
         WHERE mr.id = $1
         ORDER BY dw.scheduled_date ASC LIMIT 1`,
        [mesocycle_run_id],
      );
      plannedSetId = ps?.id;

      // Find a different exercise to substitute to
      const { rows: [ex] } = await db.query(
        `SELECT e.id FROM exercises e
         JOIN planned_sets ps2 ON ps2.id = $1
         WHERE e.id != ps2.exercise_id AND e.archived_at IS NULL
         LIMIT 1`,
        [plannedSetId],
      );
      targetExerciseId = ex?.id;
    }
  }
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// PATCH /api/planned-sets/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/planned-sets/:id contract', () => {
  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/planned-sets/00000000-0000-0000-0000-000000000000',
      headers: auth(),
      body: { target_rir: 2 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 on empty patch body', async () => {
    if (!plannedSetId) {
      console.warn('No planned_set in DB — skipping 400 body test');
      return;
    }
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/planned-sets/${plannedSetId}`,
      headers: auth(),
      body: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; field: string }>();
    expect(typeof body.error).toBe('string');
  });

  it('200 PATCH response parses through PlannedSetPatchResponseSchema', async () => {
    if (!plannedSetId) {
      console.warn('No planned_set in DB — skipping PATCH contract test');
      return;
    }
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/planned-sets/${plannedSetId}`,
      headers: auth(),
      body: { target_rir: 3 },
    });
    // May be 409 if the day is in the past; accept either success shape
    if (res.statusCode === 409) {
      console.warn('Planned set is in the past — skipping shape assertion');
      return;
    }
    expect(res.statusCode).toBe(200);
    const parsed = PlannedSetPatchResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/planned-sets/:id/substitute
// ---------------------------------------------------------------------------

describe('POST /api/planned-sets/:id/substitute contract', () => {
  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/planned-sets/00000000-0000-0000-0000-000000000000/substitute',
      headers: auth(),
      body: { to_exercise_id: '00000000-0000-0000-0000-000000000001' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('substitute response parses through PlannedSetSubstituteResponseSchema', async () => {
    if (!plannedSetId || !targetExerciseId) {
      console.warn('No planned_set or target exercise in DB — skipping substitute contract test');
      return;
    }
    const res = await app.inject({
      method: 'POST',
      url: `/api/planned-sets/${plannedSetId}/substitute`,
      headers: auth(),
      body: { to_exercise_id: targetExerciseId },
    });
    if (res.statusCode === 409) {
      console.warn('Planned set is in the past — skipping shape assertion');
      return;
    }
    expect(res.statusCode).toBe(200);
    const parsed = PlannedSetSubstituteResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.exercise_id).toBe(targetExerciseId);
    }
  });
});
