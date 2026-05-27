import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';

afterAll(async () => { await db.end(); });

describe('W2 — core muscle seeded with 6+ exercises', () => {
  it('muscles row exists with slug=core', async () => {
    const { rows } = await db.query('SELECT slug FROM muscles WHERE slug = $1', ['core']);
    expect(rows).toHaveLength(1);
  });

  it('at least 6 distinct exercises have primary_muscle slug=core', async () => {
    const { rows } = await db.query(
      `SELECT e.slug FROM exercises e
       JOIN muscles m ON m.id = e.primary_muscle_id
       WHERE m.slug = 'core' AND e.archived_at IS NULL`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it('Pallof press is re-tagged to core (not upper_back)', async () => {
    const { rows } = await db.query(
      `SELECT m.slug AS muscle FROM exercises e
       JOIN muscles m ON m.id = e.primary_muscle_id
       WHERE e.slug = 'cable-pallof-press'`,
    );
    expect(rows[0]?.muscle).toBe('core');
  });
});
