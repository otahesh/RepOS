/**
 * Beta W1.2 — POST + PATCH /api/set-logs integration tests.
 *
 * Covers:
 *   - POST happy path: 201, derived user_id + exercise_id, aliased weight_lbs/reps/rir
 *   - POST idempotency: identical client_request_id → 200 deduped:true
 *   - POST double-tap minute-bucket dedupe: same planned_set + same UTC minute → 200
 *   - POST IDOR contract: planned_set owned by another user → 404 (no oracle)
 *   - PATCH 24h audit window: within window → 200; past window → 409;
 *     IDOR (set_log owned by another user) → 404 (no oracle)
 *   - DELETE 24h audit window: within window → 200 deleted:true; past window → 409;
 *     IDOR (set_log owned by another user) → 404 (no oracle)
 *
 * The atomic INSERT ... ON CONFLICT DO NOTHING in the handler covers both
 * idempotency probes from W1.1's unique indices (set_logs_user_id_client_request_id_key
 * and set_logs_minute_dedupe_key). No probe-then-insert TOCTOU window.
 *
 * PATCH + DELETE use a single SQL pass for load + ownership + audit-window
 * check. SQL is the source of truth for time so API/DB clock-skew can't pop
 * the gate.
 */

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import {
  seedUserWithMesocycle,
  seedUserWithLoggedSet,
  cleanupSeeded,
  type SeedHandle,
} from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];

afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});

afterAll(async () => {
  await db.end();
});

describe('POST /api/set-logs — happy path', () => {
  it('inserts a row with derived user_id + exercise_id, returns 201', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {
          client_request_id: '11111111-1111-4111-8111-111111111111',
          planned_set_id: seed.plannedSetId,
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
        user_id: seed.userId,
        exercise_id: seed.exerciseId,
        planned_set_id: seed.plannedSetId,
        weight_lbs: 225.0,
        reps: 5,
        rir: 2,
      });
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/set-logs — idempotency', () => {
  it('returns prior row + deduped:true on identical client_request_id', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const payload = {
        client_request_id: '22222222-2222-4222-8222-222222222222',
        planned_set_id: seed.plannedSetId,
        weight_lbs: 200.0,
        reps: 5,
        rir: 1,
        performed_at: new Date().toISOString(),
      };
      const first = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { ...payload, weight_lbs: 999 },
      });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().deduped).toBe(true);
      expect(second.json().set_log.weight_lbs).toBe(200.0);
      expect(second.json().set_log.id).toBe(first.json().set_log.id);
    } finally {
      await app.close();
    }
  });

  it('double-tap minute-bucket dedupe — same minute, same planned_set, different client_request_id → 200 deduped', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const ts = new Date().toISOString();
      const first = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {
          client_request_id: '33333333-3333-4333-8333-333333333333',
          planned_set_id: seed.plannedSetId,
          weight_lbs: 200,
          reps: 5,
          performed_at: ts,
        },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {
          client_request_id: '44444444-4444-4444-8444-444444444444',
          planned_set_id: seed.plannedSetId,
          weight_lbs: 200,
          reps: 5,
          performed_at: ts,
        },
      });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().deduped).toBe(true);
      expect(second.json().set_log.id).toBe(first.json().set_log.id);
    } finally {
      await app.close();
    }
  });

  it('404 when planned_set belongs to another user (IDOR oracle prevention)', async () => {
    const app = await build();
    try {
      const userA = await seedUserWithMesocycle();
      handles.push(userA);
      const userB = await seedUserWithMesocycle();
      handles.push(userB);
      const resp = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${userB.bearer}` },
        payload: {
          client_request_id: '55555555-5555-4555-8555-555555555555',
          planned_set_id: userA.plannedSetId,
          weight_lbs: 100,
          reps: 1,
          performed_at: new Date().toISOString(),
        },
      });
      expect(resp.statusCode).toBe(404);

      // Guard against a future refactor that moves the ownership check
      // below the INSERT: the 404 would still surface but a row would
      // leak. Asserting zero rows tied to userA's planned_set catches it.
      const { rows: leaked } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM set_logs WHERE planned_set_id = $1`,
        [userA.plannedSetId],
      );
      expect(leaked[0].n).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('PATCH /api/set-logs/:id — 24h audit window', () => {
  it('200 when performed_at is within 24h', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithLoggedSet({ minutesAgo: 60 });
      handles.push(seed);
      const resp = await app.inject({
        method: 'PATCH',
        url: `/api/set-logs/${seed.setLogId}`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { weight_lbs: 230 },
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json().set_log.weight_lbs).toBe(230);
    } finally {
      await app.close();
    }
  });

  it('409 audit_window_expired when performed_at > 24h ago', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithLoggedSet({ minutesAgo: 25 * 60 });
      handles.push(seed);
      const resp = await app.inject({
        method: 'PATCH',
        url: `/api/set-logs/${seed.setLogId}`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { weight_lbs: 230 },
      });
      expect(resp.statusCode).toBe(409);
      expect(resp.json().error).toBe('audit_window_expired');
      expect(resp.json()).toHaveProperty('performed_at');
      expect(resp.json()).toHaveProperty('max_edit_at');
      // Lock the contract: both timestamps serialize as ISO-8601-Z, not
      // Postgres DateStyle (`2026-05-12 19:30:00+00`). Drift between the
      // two is the regression this regex catches.
      expect(resp.json().performed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      expect(resp.json().max_edit_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    } finally {
      await app.close();
    }
  });

  it('400 when :id is not a UUID', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const resp = await app.inject({
        method: 'PATCH',
        url: '/api/set-logs/not-a-uuid',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { weight_lbs: 230 },
      });
      expect(resp.statusCode).toBe(400);
      expect(resp.json().field).toBe('id');
    } finally {
      await app.close();
    }
  });

  it('404 when set_log belongs to another user (IDOR — collapsed with not-found)', async () => {
    const app = await build();
    try {
      const userA = await seedUserWithLoggedSet({ minutesAgo: 10 });
      handles.push(userA);
      const userB = await seedUserWithMesocycle();
      handles.push(userB);
      const resp = await app.inject({
        method: 'PATCH',
        url: `/api/set-logs/${userA.setLogId}`,
        headers: { authorization: `Bearer ${userB.bearer}` },
        payload: { weight_lbs: 9 },
      });
      expect(resp.statusCode).toBe(404);

      // Guard against a future refactor that moves the ownership check
      // below the UPDATE: the 404 would still surface but the row would
      // be silently mutated. Assert userA's row weight is unchanged.
      const { rows } = await db.query<{ weight_lbs: number }>(
        `SELECT performed_load_lbs::float AS weight_lbs
         FROM set_logs WHERE id = $1`,
        [userA.setLogId],
      );
      expect(rows[0].weight_lbs).toBe(200.0);
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /api/set-logs/:id — 24h audit window', () => {
  it('200 deleted:true when performed_at is within 24h', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithLoggedSet({ minutesAgo: 30 });
      handles.push(seed);
      const resp = await app.inject({
        method: 'DELETE',
        url: `/api/set-logs/${seed.setLogId}`,
        headers: { authorization: `Bearer ${seed.bearer}` },
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json()).toEqual({ deleted: true });
    } finally {
      await app.close();
    }
  });

  it('409 audit_window_expired when performed_at > 24h ago', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithLoggedSet({ minutesAgo: 25 * 60 });
      handles.push(seed);
      const resp = await app.inject({
        method: 'DELETE',
        url: `/api/set-logs/${seed.setLogId}`,
        headers: { authorization: `Bearer ${seed.bearer}` },
      });
      expect(resp.statusCode).toBe(409);
      expect(resp.json().error).toBe('audit_window_expired');
      expect(resp.json()).toHaveProperty('performed_at');
      expect(resp.json()).toHaveProperty('max_edit_at');
      // Same ISO-Z contract lock as PATCH — drift between handlers is the
      // regression this regex catches.
      expect(resp.json().performed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      expect(resp.json().max_edit_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    } finally {
      await app.close();
    }
  });

  it('404 when set_log belongs to another user (IDOR — collapsed with not-found)', async () => {
    const app = await build();
    try {
      const userA = await seedUserWithLoggedSet({ minutesAgo: 10 });
      handles.push(userA);
      const userB = await seedUserWithMesocycle();
      handles.push(userB);
      const resp = await app.inject({
        method: 'DELETE',
        url: `/api/set-logs/${userA.setLogId}`,
        headers: { authorization: `Bearer ${userB.bearer}` },
      });
      expect(resp.statusCode).toBe(404);

      // Anti-refactor leak-guard: a future change that moves the ownership
      // check below the DELETE would still surface a 404 but would silently
      // remove userA's row. Assert userA's set_log still exists.
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM set_logs WHERE id = $1`,
        [userA.setLogId],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await app.close();
    }
  });
});
