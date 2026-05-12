/**
 * Beta W1.2 — POST /api/set-logs integration tests.
 *
 * Covers:
 *   - Happy path: 201, derived user_id + exercise_id, aliased weight_lbs/reps/rir
 *   - Idempotency: identical client_request_id → 200 deduped:true
 *   - Double-tap minute-bucket dedupe: same planned_set + same UTC minute → 200
 *   - IDOR contract: planned_set owned by another user → 404 (no oracle)
 *
 * The atomic INSERT ... ON CONFLICT DO NOTHING in the handler covers both
 * idempotency probes from W1.1's unique indices (set_logs_user_id_client_request_id_key
 * and set_logs_minute_dedupe_key). No probe-then-insert TOCTOU window.
 */

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import {
  seedUserWithMesocycle,
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
    } finally {
      await app.close();
    }
  });
});
