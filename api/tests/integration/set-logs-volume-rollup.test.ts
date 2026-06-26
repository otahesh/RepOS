/**
 * Beta W1.5.2 — Volume-rollup reflects POSTed set_logs.
 *
 * Closes the W1 acceptance bullet "desktop MyProgramPage shows volume rollup
 * updated" by asserting that POST /api/set-logs grows the rollup's per-muscle
 * `performed_sets` field for the week the parent day_workout belongs to. The
 * planned `sets` field is unchanged — that captures the program design.
 *
 * The rollup query attributes a logged set to the planned-week of its parent
 * day_workout (not the calendar week of performed_at). See
 * api/src/services/volumeRollup.ts for the SQL and the rationale.
 *
 * DEVIATION FROM THE PLAN (§W1.5.2): the plan's draft asserted
 * `rollup.find(r => r.exercise_id === exerciseId)?.set_count` — but the real
 * VolumeRollupResponse is week-and-muscle-shaped, not per-exercise. The fix
 * (both to the plan and to the rollup service) was to add `performed_sets`
 * to MuscleVolume so the per-muscle running total grows after each set_log.
 */

import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { randomUUID } from 'node:crypto';

const handles: SeedHandle[] = [];

afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});

afterAll(async () => {
  await db.end();
});

interface MuscleEntry {
  muscle: string;
  sets: number;
  performed_sets: number;
  mev: number;
  mav: number;
  mrv: number;
}

interface WeekEntry {
  week_idx: number;
  muscles: MuscleEntry[];
  minutes_by_modality: Record<string, number>;
}

describe('W1.5.2 — set_logs → volume rollup', () => {
  it('GET /api/mesocycles/:id/volume-rollup returns the per-week per-muscle shape with both sets and performed_sets', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    const resp = await app.inject({
      method: 'GET',
      url: `/api/mesocycles/${seed.mesocycleRunId}/volume-rollup`,
      headers: { authorization: `Bearer ${seed.bearer}` },
    });

    expect(resp.statusCode).toBe(200);
    const body = resp.json() as { run_id: string; weeks: WeekEntry[] };
    expect(body.run_id).toBe(seed.mesocycleRunId);
    expect(body.weeks).toHaveLength(1);
    expect(body.weeks[0].week_idx).toBe(1);

    // Every muscle row must carry both planned (`sets`) and performed
    // (`performed_sets`). The seed fixture logs zero sets, so performed_sets
    // is 0 across the board before the POST below.
    for (const m of body.weeks[0].muscles) {
      expect(m).toHaveProperty('sets');
      expect(m).toHaveProperty('performed_sets');
      expect(m.performed_sets).toBe(0);
    }

    await app.close();
  });

  it('POST /api/set-logs increments performed_sets for the muscles credited by the planned_set exercise; planned sets are unchanged', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    const before = (
      await app.inject({
        method: 'GET',
        url: `/api/mesocycles/${seed.mesocycleRunId}/volume-rollup`,
        headers: { authorization: `Bearer ${seed.bearer}` },
      })
    ).json() as { weeks: WeekEntry[] };

    const beforeWeek = before.weeks.find((w) => w.week_idx === 1);
    expect(beforeWeek).toBeDefined();
    const beforePerformed = beforeWeek!.muscles.reduce((acc, m) => acc + m.performed_sets, 0);
    const beforePlanned = beforeWeek!.muscles.reduce((acc, m) => acc + m.sets, 0);

    // Sanity: which muscles does the seeded exercise credit? We grab them up
    // front so we can target the ones that should grow.
    const { rows: crediting } = await db.query<{ slug: string; contribution: number }>(
      `SELECT m.slug, emc.contribution
       FROM exercise_muscle_contributions emc
       JOIN muscles m ON m.id = emc.muscle_id
       WHERE emc.exercise_id = $1`,
      [seed.exerciseId],
    );
    expect(crediting.length).toBeGreaterThan(0);
    const expectedDelta = crediting.reduce((acc, r) => acc + Number(r.contribution), 0);

    const post = await app.inject({
      method: 'POST',
      url: '/api/set-logs',
      headers: { authorization: `Bearer ${seed.bearer}` },
      payload: {
        client_request_id: randomUUID(),
        planned_set_id: seed.plannedSetId,
        weight_lbs: 200,
        reps: 5,
        rir: 1,
        performed_at: new Date().toISOString(),
      },
    });
    expect(post.statusCode).toBe(201);

    const after = (
      await app.inject({
        method: 'GET',
        url: `/api/mesocycles/${seed.mesocycleRunId}/volume-rollup`,
        headers: { authorization: `Bearer ${seed.bearer}` },
      })
    ).json() as { weeks: WeekEntry[] };

    const afterWeek = after.weeks.find((w) => w.week_idx === 1)!;
    const afterPerformed = afterWeek.muscles.reduce((acc, m) => acc + m.performed_sets, 0);
    const afterPlanned = afterWeek.muscles.reduce((acc, m) => acc + m.sets, 0);

    // Planned volume must not move — that's the program design, not user
    // activity.
    expect(afterPlanned).toBe(beforePlanned);
    // Performed volume must grow by exactly the seeded exercise's total
    // muscle contribution. Tolerance covers float drift from the SUM cast.
    expect(afterPerformed - beforePerformed).toBeGreaterThan(expectedDelta - 0.0001);
    expect(afterPerformed - beforePerformed).toBeLessThan(expectedDelta + 0.0001);

    await app.close();
  });
});
