import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';

afterAll(async () => { await db.end(); });

describe('muscles seed (migration 008)', () => {
  it('has exactly 12 rows after migration', async () => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM muscles');
    expect(rows[0].n).toBe(12);
  });

  it('every group_name resolves to a known group', async () => {
    const { rows } = await db.query(
      `SELECT DISTINCT group_name FROM muscles ORDER BY group_name`
    );
    const groups = rows.map(r => r.group_name);
    expect(groups).toEqual(['arms','back','chest','legs','shoulders']);
  });

  it('rejects a duplicate slug', async () => {
    await expect(
      db.query(`INSERT INTO muscles (slug, name, group_name, display_order)
                VALUES ('chest','dup','chest',999)`)
    ).rejects.toThrow();
  });

  it('rejects a malformed slug', async () => {
    await expect(
      db.query(`INSERT INTO muscles (slug, name, group_name, display_order)
                VALUES ('Bad-Slug','x','arms',999)`)
    ).rejects.toThrow();
  });
});
