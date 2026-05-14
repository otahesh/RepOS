/**
 * Beta W1.4.5–W1.4.7 — POST /api/health/workouts integration tests.
 *
 * Mirrors the structure of scope-enforcement.test.ts and set-logs-flow.test.ts:
 * each test mints its own bearer via seedUserAndMintBearer so rate-limit state
 * (workout_write_log.write_count, capped at 10/day per user) doesn't cross
 * test boundaries.
 *
 * Five cases:
 *   1. 201 happy path on first ingest with health:workouts:write scope.
 *   2. 200 deduped:true on identical (user, started_at, source). Same id
 *      returned, exactly one DB row.
 *   3. 403 when the bearer only carries health:weight:write — scope guard
 *      surfaces /scope_required:health:workouts:write/.
 *   4. 409 rate_limit_exceeded on the 11th write within one calendar day
 *      per user (10 distinct started_at, 1 minute apart, expect 10x 201 + 409).
 *   5. 400 {error, field} envelope on a malformed started_at (Zod's
 *      datetime({ offset: true }) rejection).
 */

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import {
  seedUserAndMintBearer,
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

// Returns a fresh payload each call — never share by reference: the rate-
// limit test mutates started_at/ended_at per iteration and we don't want a
// surprise dedupe from a captured object reused across iterations.
function validWorkoutPayload() {
  return {
    started_at: '2026-05-12T10:00:00-04:00',
    ended_at: '2026-05-12T10:32:15-04:00',
    modality: 'run',
    distance_m: 5200,
    duration_sec: 1935,
    source: 'Apple Health',
  };
}

describe('POST /api/health/workouts', () => {
  it('201 on first ingest with health:workouts:write scope', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['health:workouts:write'],
      });
      handles.push(handle);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/health/workouts',
        headers: { authorization: `Bearer ${bearer}` },
        payload: validWorkoutPayload(),
      });

      expect(resp.statusCode).toBe(201);
      const body = resp.json();
      expect(body.deduped).toBe(false);
      expect(body.workout).toMatchObject({
        modality: 'run',
        distance_m: 5200,
        duration_sec: 1935,
        source: 'Apple Health',
      });
    } finally {
      await app.close();
    }
  });

  it('200 deduped:true on identical (user, started_at, source)', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['health:workouts:write'],
      });
      handles.push(handle);

      const payload = validWorkoutPayload();
      const first = await app.inject({
        method: 'POST',
        url: '/api/health/workouts',
        headers: { authorization: `Bearer ${bearer}` },
        payload,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/health/workouts',
        headers: { authorization: `Bearer ${bearer}` },
        payload,
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().deduped).toBe(true);
      expect(second.json().workout.id).toBe(first.json().workout.id);

      // Verify exactly one DB row for the (user_id, started_at, source) tuple.
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM health_workouts
         WHERE user_id = $1 AND source = $2`,
        [handle.userId, 'Apple Health'],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('403 when bearer has only health:weight:write scope', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['health:weight:write'],
      });
      handles.push(handle);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/health/workouts',
        headers: { authorization: `Bearer ${bearer}` },
        payload: validWorkoutPayload(),
      });

      expect(resp.statusCode).toBe(403);
      expect(resp.json().error).toMatch(/scope/i);
    } finally {
      await app.close();
    }
  });

  it('409 rate_limit_exceeded on 11th write within calendar day per user', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['health:workouts:write'],
      });
      handles.push(handle);

      const responses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const startedAt = new Date(Date.UTC(2026, 4, 12, 10, i)).toISOString();
        const endedAt = new Date(Date.parse(startedAt) + 30 * 60_000).toISOString();
        const r = await app.inject({
          method: 'POST',
          url: '/api/health/workouts',
          headers: { authorization: `Bearer ${bearer}` },
          payload: {
            ...validWorkoutPayload(),
            started_at: startedAt,
            ended_at: endedAt,
          },
        });
        responses.push(r.statusCode);
        if (i === 10) {
          expect(r.json()).toEqual({ error: 'rate_limit_exceeded' });
        }
      }
      expect(responses.slice(0, 10).every((s) => s === 201)).toBe(true);
      expect(responses[10]).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('400 {error, field} envelope on malformed started_at', async () => {
    const app = await build();
    try {
      const { bearer, handle } = await seedUserAndMintBearer({
        scopes: ['health:workouts:write'],
      });
      handles.push(handle);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/health/workouts',
        headers: { authorization: `Bearer ${bearer}` },
        payload: { ...validWorkoutPayload(), started_at: 'not-a-timestamp' },
      });

      expect(resp.statusCode).toBe(400);
      expect(resp.json()).toMatchObject({ field: 'started_at' });
      expect(typeof resp.json().error).toBe('string');
    } finally {
      await app.close();
    }
  });
});
