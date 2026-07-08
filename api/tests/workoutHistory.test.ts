/**
 * Sequence-workouts Task 4 — GET /api/workouts/history.
 *
 * Covers:
 *   - completed workouts newest-first, item shape, sets grouped by exercise
 *     in (block_idx, set_idx) order, weight_lbs is a JS number
 *   - skipped workouts (NULL completed_at) included after completed ones
 *     without breaking pagination (COALESCE '-infinity' keyset)
 *   - planned / in_progress rows excluded
 *   - another user's rows invisible (empty page, not an oracle)
 *   - two-page pagination with skipped rows in the set — no overlap, no drops
 *   - limit clamped: 0 → 1, 500 → 50 (no error)
 *   - malformed cursor → 400 { error: 'invalid cursor', field: 'cursor' }
 *   - no auth → 401
 *
 * Every fixture user is cleaned up via cleanupSeeded (cascade wipes the
 * program/run/day/set chain) so the shared repos_test DB stays clean.
 */

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from './helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from './helpers/seed-fixtures.js';
import { db } from '../src/db/client.js';

const handles: SeedHandle[] = [];

afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});

afterAll(async () => {
  await db.end();
});

async function seed(): Promise<SeedHandle> {
  const s = await seedUserWithMesocycle();
  handles.push(s);
  return s;
}

/** Insert a day_workout on the seed's run. day_idx must be unique per
 *  (run, week_idx); the base seed occupies (1, 0). completedMinutesAgo stamps
 *  completed_at (only meaningful for status='completed'). */
async function addDay(
  s: SeedHandle,
  opts: {
    dayIdx: number;
    status: 'planned' | 'in_progress' | 'completed' | 'skipped';
    name?: string;
    completedMinutesAgo?: number;
  },
): Promise<string> {
  const {
    rows: [dw],
  } = await db.query<{ id: string }>(
    `INSERT INTO day_workouts
       (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name, status, completed_at)
     VALUES ($1, 1, $2::int, CURRENT_DATE + $2::int, 'strength', $3, $4,
             CASE WHEN $5::int IS NULL THEN NULL
                  ELSE now() - ($5::int * INTERVAL '1 minute') END)
     RETURNING id`,
    [
      s.mesocycleRunId,
      opts.dayIdx,
      opts.name ?? `Day ${opts.dayIdx}`,
      opts.status,
      opts.completedMinutesAgo ?? null,
    ],
  );
  return dw.id;
}

/** Insert a planned_set + one set_log on it. */
async function addLoggedSet(
  s: SeedHandle,
  opts: {
    dayWorkoutId: string;
    exerciseId: string;
    blockIdx: number;
    setIdx: number;
    weight: number;
    reps: number;
    rir: number;
    performedMinutesAgo: number;
  },
): Promise<void> {
  const {
    rows: [ps],
  } = await db.query<{ id: string }>(
    `INSERT INTO planned_sets
       (day_workout_id, block_idx, set_idx, exercise_id,
        target_reps_low, target_reps_high, target_rir, rest_sec)
     VALUES ($1, $2, $3, $4, 5, 10, 2, 120)
     RETURNING id`,
    [opts.dayWorkoutId, opts.blockIdx, opts.setIdx, opts.exerciseId],
  );
  await db.query(
    `INSERT INTO set_logs
       (user_id, exercise_id, planned_set_id, client_request_id,
        performed_load_lbs, performed_reps, performed_rir, performed_at)
     VALUES ($1, $2, $3, gen_random_uuid(),
        $4, $5, $6, now() - ($7::int * INTERVAL '1 minute'))`,
    [s.userId, opts.exerciseId, ps.id, opts.weight, opts.reps, opts.rir, opts.performedMinutesAgo],
  );
}

async function twoExercises(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const { rows } = await db.query<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM exercises ORDER BY slug LIMIT 2`,
  );
  if (rows.length < 2) throw new Error('need >= 2 seeded exercises — run `npm run seed` in api/');
  return rows;
}

function get(app: Awaited<ReturnType<typeof build>>, bearer: string, qs = '') {
  return app.inject({
    method: 'GET',
    url: `/api/workouts/history${qs}`,
    headers: { authorization: `Bearer ${bearer}` },
  });
}

describe('GET /api/workouts/history', () => {
  it('returns completed workouts newest-first with sets grouped by exercise in block/set order', async () => {
    const app = await build();
    try {
      const s = await seed();
      const [exA, exB] = await twoExercises();

      const older = await addDay(s, {
        dayIdx: 1,
        status: 'completed',
        name: 'Lower A',
        completedMinutesAgo: 120,
      });
      const newer = await addDay(s, {
        dayIdx: 2,
        status: 'completed',
        name: 'Upper A',
        completedMinutesAgo: 10,
      });
      // Interleave inserts so ordering can only come from block/set idx, not
      // insertion order: block 1 first, then block 0's two sets out of order.
      await addLoggedSet(s, {
        dayWorkoutId: older,
        exerciseId: exB.id,
        blockIdx: 1,
        setIdx: 0,
        weight: 45.5,
        reps: 12,
        rir: 3,
        performedMinutesAgo: 130,
      });
      await addLoggedSet(s, {
        dayWorkoutId: older,
        exerciseId: exA.id,
        blockIdx: 0,
        setIdx: 1,
        weight: 95,
        reps: 8,
        rir: 2,
        performedMinutesAgo: 135,
      });
      await addLoggedSet(s, {
        dayWorkoutId: older,
        exerciseId: exA.id,
        blockIdx: 0,
        setIdx: 0,
        weight: 90,
        reps: 10,
        rir: 2,
        performedMinutesAgo: 140,
      });

      const resp = await get(app, s.bearer);
      expect(resp.statusCode).toBe(200);
      const body = resp.json();
      expect(body.items).toHaveLength(2);
      expect(body.next_cursor).toBeNull();

      // Newest completed first.
      expect(body.items[0].id).toBe(newer);
      expect(body.items[1].id).toBe(older);

      const item = body.items[1];
      expect(item).toMatchObject({
        id: older,
        name: 'Lower A',
        kind: 'strength',
        week_idx: 1,
        day_idx: 1,
        status: 'completed',
      });
      expect(item.completed_at).toBeTruthy();
      expect(item.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Grouped by exercise, block 0's exercise first, sets in set_idx order.
      expect(item.exercises).toHaveLength(2);
      expect(item.exercises[0]).toMatchObject({ slug: exA.slug, name: exA.name });
      expect(item.exercises[0].sets.map((x: { reps: number }) => x.reps)).toEqual([10, 8]);
      expect(item.exercises[0].sets[0]).toMatchObject({ weight_lbs: 90, reps: 10, rir: 2 });
      expect(item.exercises[0].sets[0].performed_at).toBeTruthy();
      expect(item.exercises[1]).toMatchObject({ slug: exB.slug, name: exB.name });
      expect(item.exercises[1].sets).toHaveLength(1);

      // NUMERIC comes back as a JS number, decimals intact.
      expect(typeof item.exercises[1].sets[0].weight_lbs).toBe('number');
      expect(item.exercises[1].sets[0].weight_lbs).toBe(45.5);

      // Workouts with no logs still carry an exercises array.
      expect(body.items[0].exercises).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('includes skipped workouts (NULL completed_at) after completed ones; excludes planned/in_progress', async () => {
    const app = await build();
    try {
      const s = await seed(); // base seed's day_workout is 'planned' at (1,0)
      const completed = await addDay(s, {
        dayIdx: 1,
        status: 'completed',
        completedMinutesAgo: 60,
      });
      const skipped = await addDay(s, { dayIdx: 2, status: 'skipped' });
      await addDay(s, { dayIdx: 3, status: 'in_progress' });

      const resp = await get(app, s.bearer);
      expect(resp.statusCode).toBe(200);
      const body = resp.json();
      expect(body.items.map((i: { id: string }) => i.id)).toEqual([completed, skipped]);
      expect(body.items[1]).toMatchObject({ status: 'skipped', completed_at: null });
      expect(body.items[1].exercises).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("another user's history is invisible", async () => {
    const app = await build();
    try {
      const owner = await seed();
      await addDay(owner, { dayIdx: 1, status: 'completed', completedMinutesAgo: 5 });
      const attacker = await seed();

      const resp = await get(app, attacker.bearer);
      expect(resp.statusCode).toBe(200);
      expect(resp.json().items).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('paginates across pages with skipped rows in the set — no overlap, no drops', async () => {
    const app = await build();
    try {
      const s = await seed();
      const expected: string[] = [];
      // 3 completed (newest first) then 3 skipped. Skipped rows all sort at
      // -infinity and tie-break on id DESC — compute that order ourselves.
      for (let i = 0; i < 3; i++) {
        expected.push(
          await addDay(s, {
            dayIdx: i + 1,
            status: 'completed',
            completedMinutesAgo: (i + 1) * 10,
          }),
        );
      }
      const skippedIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        skippedIds.push(await addDay(s, { dayIdx: i + 4, status: 'skipped' }));
      }
      expected.push(...[...skippedIds].sort().reverse()); // uuid text order ≈ pg uuid order

      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const qs = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const resp = await get(app, s.bearer, qs);
        expect(resp.statusCode).toBe(200);
        const body = resp.json();
        expect(body.items.length).toBeLessThanOrEqual(2);
        seen.push(...body.items.map((i: { id: string }) => i.id));
        cursor = body.next_cursor;
      } while (cursor !== null && ++guard < 10);

      expect(new Set(seen).size).toBe(seen.length); // no overlap
      expect(seen).toEqual(expected); // no drops, stable total order
    } finally {
      await app.close();
    }
  });

  it('clamps limit: 0 → 1 item, 500 → capped at 50 (no error)', async () => {
    const app = await build();
    try {
      const s = await seed();
      await addDay(s, { dayIdx: 1, status: 'completed', completedMinutesAgo: 10 });
      await addDay(s, { dayIdx: 2, status: 'completed', completedMinutesAgo: 20 });

      const zero = await get(app, s.bearer, '?limit=0');
      expect(zero.statusCode).toBe(200);
      expect(zero.json().items).toHaveLength(1);
      expect(zero.json().next_cursor).not.toBeNull();

      const huge = await get(app, s.bearer, '?limit=500');
      expect(huge.statusCode).toBe(200);
      expect(huge.json().items).toHaveLength(2);
      expect(huge.json().next_cursor).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('malformed cursor → 400 { error: "invalid cursor", field: "cursor" }', async () => {
    const app = await build();
    try {
      const s = await seed();
      for (const bad of [
        'not-a-cursor',
        'garbage|also-garbage',
        '2026-01-01T00:00:00.000Z|not-a-uuid',
        '01/01/2026|4b4b4b4b-0000-0000-0000-000000000000',
      ]) {
        const resp = await get(app, s.bearer, `?cursor=${encodeURIComponent(bad)}`);
        expect(resp.statusCode).toBe(400);
        expect(resp.json()).toEqual({ error: 'invalid cursor', field: 'cursor' });
      }
    } finally {
      await app.close();
    }
  });

  it('no auth → 401', async () => {
    const app = await build();
    try {
      const resp = await app.inject({ method: 'GET', url: '/api/workouts/history' });
      expect(resp.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
