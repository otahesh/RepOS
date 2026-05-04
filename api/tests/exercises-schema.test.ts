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

describe('exercise_muscle_contributions (migration 010)', () => {
  it('cascades on exercise delete', async () => {
    const { rows: [ex] } = await db.query(
      `INSERT INTO exercises (slug,name,primary_muscle_id,movement_pattern,peak_tension_length,
                              skill_complexity,loading_demand,systemic_fatigue)
       VALUES ('test-cascade','x',
               (SELECT id FROM muscles WHERE slug='chest'),
               'push_horizontal','mid',3,3,3) RETURNING id`
    );
    await db.query(
      `INSERT INTO exercise_muscle_contributions (exercise_id,muscle_id,contribution)
       VALUES ($1,(SELECT id FROM muscles WHERE slug='chest'),1.0)`, [ex.id]
    );
    await db.query(`DELETE FROM exercises WHERE id=$1`, [ex.id]);
    const { rows } = await db.query(
      `SELECT 1 FROM exercise_muscle_contributions WHERE exercise_id=$1`, [ex.id]
    );
    expect(rows.length).toBe(0);
  });

  it('rejects contribution > 1.0', async () => {
    const { rows: [ex] } = await db.query(
      `INSERT INTO exercises (slug,name,primary_muscle_id,movement_pattern,peak_tension_length,
                              skill_complexity,loading_demand,systemic_fatigue)
       VALUES ('test-bad-contrib','x',
               (SELECT id FROM muscles WHERE slug='chest'),
               'push_horizontal','mid',3,3,3) RETURNING id`
    );
    await expect(
      db.query(
        `INSERT INTO exercise_muscle_contributions (exercise_id,muscle_id,contribution)
         VALUES ($1,(SELECT id FROM muscles WHERE slug='chest'),1.5)`, [ex.id]
      )
    ).rejects.toThrow();
    await db.query(`DELETE FROM exercises WHERE id=$1`, [ex.id]);
  });
});

describe('users.equipment_profile (migration 011)', () => {
  it('defaults to versioned empty object', async () => {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING equipment_profile`,
      [`vitest.eq.${Date.now()}@repos.test`]
    );
    expect(u.equipment_profile).toEqual({ _v: 1 });
    await db.query(`DELETE FROM users WHERE email LIKE 'vitest.eq.%'`);
  });
});
