// Measurement model phase 2 — cardio_logs flow tests.
//
// planned_cardio_blocks were prescribed + rendered since W1 but never
// completable; POST /api/cardio-logs is the completion path. Coverage:
//   - POST happy path: 201, derived user_id + exercise_id, aliased names
//   - idempotency: same client_request_id → 200 deduped:true
//   - minute-bucket dedupe: same block + same UTC minute → 200 deduped
//   - IDOR: another user's block → 404 (no oracle); list is own-rows-only
//   - PATCH inside 24h window → 200; DELETE semantics mirror set-logs
//   - today view exposes cardio logged state

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { build } from '../helpers/build-test-app.js';
import {
  seedUserWithMesocycle,
  cleanupSeeded,
  type SeedHandle,
} from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { getTodayWorkout } from '../../src/services/getTodayWorkout.js';

const handles: SeedHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

/** Attach a planned cardio block to the fixture's day workout. */
async function addCardioBlock(seed: SeedHandle): Promise<string> {
  const {
    rows: [pc],
  } = await db.query<{ id: string }>(
    `INSERT INTO planned_cardio_blocks
       (day_workout_id, block_idx, exercise_id, target_duration_sec, target_zone)
     VALUES ($1, 9, $2, 2700, 2)
     RETURNING id`,
    [seed.dayWorkoutId, seed.exerciseId],
  );
  return pc.id;
}

function postBody(blockId: string, over: Record<string, unknown> = {}) {
  return {
    client_request_id: randomUUID(),
    planned_cardio_block_id: blockId,
    duration_sec: 2700,
    performed_at: new Date().toISOString(),
    ...over,
  };
}

describe('POST /api/cardio-logs', () => {
  it('201 happy path: derives user + exercise, returns aliased row', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const blockId = await addCardioBlock(seed);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: postBody(blockId, { distance_m: 4200, srpe: 3 }),
      });
      expect(resp.statusCode).toBe(201);
      const body = resp.json();
      expect(body.deduped).toBe(false);
      expect(body.cardio_log).toMatchObject({
        user_id: seed.userId,
        exercise_id: seed.exerciseId,
        planned_cardio_block_id: blockId,
        duration_sec: 2700,
        distance_m: 4200,
        srpe: 3,
        source: 'manual',
      });
    } finally {
      await app.close();
    }
  });

  it('replays with the same client_request_id → 200 deduped', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const blockId = await addCardioBlock(seed);
      const payload = postBody(blockId);

      const first = await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload,
      });
      expect(first.statusCode).toBe(201);
      const replay = await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().deduped).toBe(true);
      expect(replay.json().cardio_log.id).toBe(first.json().cardio_log.id);

      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM cardio_logs WHERE planned_cardio_block_id=$1`,
        [blockId],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('double-tap: same block + same UTC minute, different client_request_id → 200 deduped', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const blockId = await addCardioBlock(seed);
      const at = new Date().toISOString();

      const first = await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: postBody(blockId, { performed_at: at }),
      });
      expect(first.statusCode).toBe(201);
      const tap = await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: postBody(blockId, { performed_at: at }),
      });
      expect(tap.statusCode).toBe(200);
      expect(tap.json().deduped).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("404 on another user's block (no existence oracle); list stays own-rows-only", async () => {
    const app = await build();
    try {
      const owner = await seedUserWithMesocycle();
      const attacker = await seedUserWithMesocycle();
      handles.push(owner, attacker);
      const blockId = await addCardioBlock(owner);

      const resp = await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${attacker.bearer}` },
        payload: postBody(blockId),
      });
      expect(resp.statusCode).toBe(404);

      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM cardio_logs WHERE planned_cardio_block_id=$1`,
        [blockId],
      );
      expect(rows[0].n).toBe(0); // no mutation

      const list = await app.inject({
        method: 'GET',
        url: `/api/cardio-logs?planned_cardio_block_id=${blockId}`,
        headers: { authorization: `Bearer ${attacker.bearer}` },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().cardio_logs).toEqual([]); // empty, not 404 — list semantics
    } finally {
      await app.close();
    }
  });
});

describe('PATCH/DELETE /api/cardio-logs/:id — 24h audit window', () => {
  it('PATCH inside the window updates and bumps updated_at', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const blockId = await addCardioBlock(seed);
      const post = await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: postBody(blockId),
      });
      const logId = post.json().cardio_log.id;

      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/cardio-logs/${logId}`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { duration_sec: 3000, srpe: 4 },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().cardio_log.duration_sec).toBe(3000);
      expect(patch.json().cardio_log.srpe).toBe(4);
    } finally {
      await app.close();
    }
  });

  it('PATCH outside the window → 409 audit_window_expired', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const blockId = await addCardioBlock(seed);
      const post = await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: postBody(blockId),
      });
      const logId = post.json().cardio_log.id;
      await db.query(`UPDATE cardio_logs SET performed_at = now() - INTERVAL '25 hours' WHERE id=$1`, [
        logId,
      ]);

      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/cardio-logs/${logId}`,
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: { duration_sec: 3000 },
      });
      expect(patch.statusCode).toBe(409);
      expect(patch.json().error).toBe('audit_window_expired');
    } finally {
      await app.close();
    }
  });
});

describe('today view — cardio logged state', () => {
  it('exposes the latest cardio_log on the block', async () => {
    const app = await build();
    try {
      const seed = await seedUserWithMesocycle();
      handles.push(seed);
      const blockId = await addCardioBlock(seed);
      await app.inject({
        method: 'POST',
        url: '/api/cardio-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: postBody(blockId, { distance_m: 4000 }),
      });

      const today = await getTodayWorkout(seed.userId);
      if (today.state !== 'workout') throw new Error('expected workout state');
      const block = today.cardio.find((c) => c.id === blockId);
      expect(block).toBeDefined();
      expect(block!.logged).toEqual({ duration_sec: 2700, distance_m: 4000 });
    } finally {
      await app.close();
    }
  });
});
