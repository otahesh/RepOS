import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';
import { runSeed } from '../../src/seed/runSeed.js';
import { makeExerciseSeedAdapter } from '../../src/seed/adapters/exercises.js';
import { exercises } from '../../src/seed/exercises.js';

// This is the sole test file that mutates rows with seed_key='exercises'.
// If a future test also touches that key, the file-parallel race risk on
// `archived` and the active-row invariant must be re-evaluated.
describe('exercises seed (production smoke)', () => {
  afterAll(async () => {
    await db.end();
  });

  it('runs without error and reports archived=0 against the deployed seed_meta row', async () => {
    const r = await runSeed({
      key: 'exercises',
      entries: exercises,
      adapter: makeExerciseSeedAdapter('exercises'),
    });
    // applied may be true or false depending on prior state — both acceptable
    if (r.applied) expect(r.archived).toBe(0); // no curated entries removed
  });

  it('classifies holds and carries as duration, dynamic work as reps', async () => {
    const { rows } = await db.query(
      `SELECT slug, measurement FROM exercises
       WHERE slug IN ('side-plank','dumbbell-farmers-carry','suitcase-carry',
                      'dumbbell-suitcase-carry','dumbbell-overhead-carry','dead-bug','barbell-back-squat')`,
    );
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.measurement]));
    expect(bySlug['side-plank']).toBe('duration');
    expect(bySlug['dumbbell-farmers-carry']).toBe('duration');
    expect(bySlug['suitcase-carry']).toBe('duration');
    expect(bySlug['dumbbell-suitcase-carry']).toBe('duration');
    expect(bySlug['dumbbell-overhead-carry']).toBe('duration');
    expect(bySlug['dead-bug']).toBe('reps'); // dynamic — stays reps by design
    expect(bySlug['barbell-back-squat']).toBe('reps');
  });

  it('every active exercise has primary_muscle resolved', async () => {
    const { rows } = await db.query(`
      SELECT slug FROM exercises
      WHERE created_by='system' AND archived_at IS NULL AND seed_key='exercises'
        AND primary_muscle_id IS NULL`);
    expect(rows).toEqual([]);
  });
});
