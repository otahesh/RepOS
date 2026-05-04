import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../src/db/client.js';

afterAll(async () => { await db.end(); });

describe('exercises schema (migration 009)', () => {
  it('rejects out-of-range skill_complexity', async () => {
    await expect(
      db.query(
        `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                                skill_complexity, loading_demand, systemic_fatigue)
         VALUES ('test-bad-skill','x',
                 (SELECT id FROM muscles WHERE slug='chest'),
                 'push_horizontal','mid', 6, 3, 3)`
      )
    ).rejects.toThrow();
  });

  it('rejects bad slug format', async () => {
    await expect(
      db.query(
        `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                                skill_complexity, loading_demand, systemic_fatigue)
         VALUES ('Bad Slug','x',
                 (SELECT id FROM muscles WHERE slug='chest'),
                 'push_horizontal','mid', 3, 3, 3)`
      )
    ).rejects.toThrow();
  });

  it('rejects self-referential parent_exercise_id', async () => {
    const { rows: [r] } = await db.query(
      `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                              skill_complexity, loading_demand, systemic_fatigue)
       VALUES ('test-self-parent','x',
               (SELECT id FROM muscles WHERE slug='chest'),
               'push_horizontal','mid', 3, 3, 3)
       RETURNING id`
    );
    await expect(
      db.query(`UPDATE exercises SET parent_exercise_id=$1 WHERE id=$1`, [r.id])
    ).rejects.toThrow();
    await db.query(`DELETE FROM exercises WHERE id=$1`, [r.id]);
  });
});
