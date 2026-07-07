// api/tests/exerciseGuides-schema.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';

let exerciseId: string;

beforeAll(async () => {
  // Crash-cruft pre-clean: a killed prior run can leave the fixture exercise
  // behind (shared repos_test DB) — clear it before inserting.
  await db.query(`DELETE FROM exercises WHERE slug='test-guide-schema-ex'`);
  const {
    rows: [ex],
  } = await db.query<{ id: string }>(
    `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                            skill_complexity, loading_demand, systemic_fatigue)
     VALUES ('test-guide-schema-ex','x',
             (SELECT id FROM muscles WHERE slug='chest'),
             'push_horizontal','mid', 3, 3, 3)
     RETURNING id`,
  );
  exerciseId = ex.id;
});

afterAll(async () => {
  // Restore state: cascade removes any guide rows hung on the fixture exercise.
  await db.query(`DELETE FROM exercises WHERE id=$1`, [exerciseId]);
  await db.end();
});

const GOOD = {
  cues: ['a cue', 'b cue', 'c cue'],
  donts: ['a mistake', 'b mistake'],
};

// Callout must satisfy the migration's length CHECK (40–600 chars).
const CALLOUT = 'Bench: 30 degrees. Feet flat, slight arch, shoulder blades pinched together.';

function insertGuide(overrides: Partial<{ cues: string[]; donts: string[] }> = {}) {
  const g = { ...GOOD, ...overrides };
  return db.query(
    `INSERT INTO exercise_guides (exercise_id, setup_callout, setup_facts, cues, donts, media)
     VALUES ($1, $2, '{}'::jsonb, $3, $4, '{}'::jsonb)`,
    [exerciseId, CALLOUT, g.cues, g.donts],
  );
}

describe('exercise_guides schema (migration 080)', () => {
  it('accepts a well-formed guide and enforces one guide per exercise', async () => {
    await insertGuide();
    await expect(insertGuide()).rejects.toThrow(); // UNIQUE (exercise_id)
    await db.query(`DELETE FROM exercise_guides WHERE exercise_id=$1`, [exerciseId]);
  });

  it('rejects cues count other than 3', async () => {
    // Pin to the intended constraint: Postgres names it exercise_guides_cues_check.
    await expect(insertGuide({ cues: ['only', 'two'] })).rejects.toThrow(/cues/);
    await expect(insertGuide({ cues: ['1', '2', '3', '4'] })).rejects.toThrow(/cues/);
  });

  it('rejects donts count other than 2', async () => {
    // Pin to the intended constraint: Postgres names it exercise_guides_donts_check.
    await expect(insertGuide({ donts: ['just one'] })).rejects.toThrow(/donts/);
  });

  it('cascades when the exercise is deleted', async () => {
    await insertGuide();
    await db.query(`DELETE FROM exercises WHERE id=$1`, [exerciseId]);
    const { rows } = await db.query(`SELECT 1 FROM exercise_guides WHERE exercise_id=$1`, [
      exerciseId,
    ]);
    expect(rows).toHaveLength(0);
    // Re-create the fixture exercise so afterAll's DELETE has a row to remove
    // (keeps teardown uniform).
    const {
      rows: [ex],
    } = await db.query<{ id: string }>(
      `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                              skill_complexity, loading_demand, systemic_fatigue)
       VALUES ('test-guide-schema-ex','x',
               (SELECT id FROM muscles WHERE slug='chest'),
               'push_horizontal','mid', 3, 3, 3)
       RETURNING id`,
    );
    exerciseId = ex.id;
  });
});
