/**
 * Beta W1.5.1 — Set-logs → W3 evaluator signal shape.
 *
 * Asserts that POST /api/set-logs lands rows in the shape the (not-yet-shipped)
 * W3 recovery-flags evaluator will consume: a per-user per-exercise count of
 * RIR-0 set_logs in the last 7 days, with the seeded compound exercise showing
 * a count >= 3 after three identical RIR-0 POSTs.
 *
 * DEVIATION FROM THE PLAN — file location.
 * The W1 plan (docs/superpowers/plans/2026-05-12-beta-W1-live-data-foundation.md
 * §W1.5.1) puts this at frontend/playwright/set-logs-to-recovery-flags.spec.ts.
 * Two reasons it lives here instead:
 *   1. The existing W1.3.6 Playwright pattern is route-mocking — page.route()
 *      intercepts /api/set-logs and inspects IndexedDB. There is no live API
 *      or DB; importing `db` from `../../api/src/db/client.js` into a
 *      Playwright spec would force a parallel test harness (Playwright +
 *      live Postgres) that this repo doesn't run today.
 *   2. The plan's assertion is structural — "does the SQL that W3 will run
 *      return the right shape after three POSTs?". That is best served by a
 *      vitest integration test against the real fastify app + real DB, which
 *      is exactly the pattern in api/tests/integration/set-logs-flow.test.ts.
 *
 * The plan's W3 UI assertion (an overreaching toast on /today) ships as a
 * `test.skip` placeholder until W3.1 lands the evaluator + toast.
 */

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import {
  seedUserWithMesocycle,
  seedUserOverreaching,
  cleanupSeeded,
  type SeedHandle,
} from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { randomUUID } from 'node:crypto';

const handles: SeedHandle[] = [];

afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});

afterAll(async () => {
  await db.end();
});

/**
 * Seed two additional planned_sets on the same day_workout / exercise so the
 * spec can POST three set_logs against three distinct planned_set_ids on a
 * single exercise — which is the shape the W3 evaluator will look for.
 */
async function addExtraPlannedSets(
  seed: SeedHandle,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const { rows: [r] } = await db.query<{ id: string }>(
      `INSERT INTO planned_sets
         (day_workout_id, block_idx, set_idx, exercise_id,
          target_reps_low, target_reps_high, target_rir, rest_sec)
       VALUES ($1, 0, $2, $3, 5, 8, 2, 120)
       RETURNING id`,
      [seed.dayWorkoutId, i, seed.exerciseId],
    );
    ids.push(r.id);
  }
  return ids;
}

describe('W1.5.1 — set_logs → W3 evaluator signal', () => {
  it('three RIR-0 set_logs on a single exercise surface as count>=3 in the W3-shape DB query', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    // seedUserWithMesocycle creates ONE planned_set; add two more on the
    // same day_workout + same exercise so we have three distinct planned_set
    // ids to POST against. (The W1.1 unique index forbids two set_logs from
    // sharing the same (planned_set_id, UTC minute), so we'd hit minute-bucket
    // dedupe if we tried to POST three logs against a single planned_set.)
    const extra = await addExtraPlannedSets(seed, 2);
    const plannedSetIds = [seed.plannedSetId, ...extra];

    // Three RIR-0 logs, one per planned_set, spread one day apart so they all
    // fall in the last-7-days window but in distinct minute buckets.
    for (let i = 0; i < 3; i++) {
      const performed_at = new Date(
        Date.now() - i * 24 * 60 * 60 * 1000,
      ).toISOString();
      const resp = await app.inject({
        method: 'POST',
        url: '/api/set-logs',
        headers: { authorization: `Bearer ${seed.bearer}` },
        payload: {
          client_request_id: randomUUID(),
          planned_set_id: plannedSetIds[i],
          weight_lbs: 225,
          reps: 5,
          rir: 0,
          performed_at,
        },
      });
      expect(resp.statusCode).toBe(201);
    }

    // This is the SQL the W3 evaluator will run (or one structurally
    // equivalent to it). If this returns the seeded exercise with count >= 3,
    // W3 is reduced to wiring this query into /api/recovery-flags + a UI
    // toast — no W1-side schema or route change.
    const { rows } = await db.query<{ exercise_id: string; count: number }>(
      `SELECT exercise_id, COUNT(*)::int AS count
       FROM set_logs
       WHERE user_id = $1
         AND performed_rir = 0
         AND performed_at > now() - INTERVAL '7 days'
       GROUP BY exercise_id
       HAVING COUNT(*) >= 3`,
      [seed.userId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      exercise_id: seed.exerciseId,
      count: 3,
    });

    await app.close();
  });

  // [W3.1 Task 13] Re-enabled. The W1.5 author left this as an
  // it.skip-with-expected-fail placeholder pending the W3 evaluator landing.
  // Now that overreachingEvaluator + route registration + telemetry are in
  // place (Tasks 10–12.5), GET /api/recovery-flags returns the flag whenever
  // the strict AND-gate conditions hold. seedUserOverreaching seeds exactly
  // those conditions: 3 RIR-0 compound sessions in 7d + current-week
  // performed_sets >= MAV. This locks in the cross-wave W1→W3 contract.
  it('the /today overreaching toast appears after three RIR-0 logs (W3.1)', async () => {
    const app = await build();
    const seed = await seedUserOverreaching();
    handles.push(seed);

    const flags = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(flags.statusCode).toBe(200);
    expect(
      flags.json<{ flags: Array<{ flag: string }> }>().flags.some(
        (f) => f.flag === 'overreaching',
      ),
    ).toBe(true);

    await app.close();
  });
});
