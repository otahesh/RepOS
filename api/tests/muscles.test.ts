import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

beforeAll(async () => { app = await buildApp(); });

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

describe('GET /api/muscles', () => {
  it('returns all 12 muscles ordered by display_order', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ muscles: any[] }>();
    expect(body.muscles).toHaveLength(12);
    expect(body.muscles[0].slug).toBe('chest');
    expect(body.muscles[11].slug).toBe('calves');
  });

  it('sets cache header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(res.headers['cache-control']).toContain('max-age=86400');
  });
});

afterAll(async () => { await app.close(); await db.end(); });
