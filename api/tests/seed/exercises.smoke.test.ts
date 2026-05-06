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
  afterAll(async () => { await db.end(); });

  it('runs without error and reports archived=0 against the deployed seed_meta row', async () => {
    const r = await runSeed({ key: 'exercises', entries: exercises, adapter: makeExerciseSeedAdapter('exercises') });
    // applied may be true or false depending on prior state — both acceptable
    if (r.applied) expect(r.archived).toBe(0); // no curated entries removed
  });

  it('every active exercise has primary_muscle resolved', async () => {
    const { rows } = await db.query(`
      SELECT slug FROM exercises
      WHERE created_by='system' AND archived_at IS NULL AND seed_key='exercises'
        AND primary_muscle_id IS NULL`);
    expect(rows).toEqual([]);
  });
});
