/**
 * Beta W1.2 — POST /api/set-logs integration tests.
 *
 * Covers (this commit): happy path — 201 with derived user_id + exercise_id
 * and the aliased weight_lbs/reps/rir projection.
 *
 * Idempotency + IDOR cases are added in the follow-up test commit.
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
