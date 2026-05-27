import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

beforeAll(async () => { app = await buildApp(); });

describe('muscles seed (migration 008 + W2.4 core)', () => {
  it('has exactly 13 rows (12 v1 + core via migration 038)', async () => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM muscles');
    expect(rows[0].n).toBe(13);
  });

  it('every group_name resolves to a known group (incl. core from W2.4)', async () => {
    const { rows } = await db.query(
      `SELECT DISTINCT group_name FROM muscles ORDER BY group_name`
    );
    const groups = rows.map(r => r.group_name);
    expect(groups).toEqual(['arms','back','chest','core','legs','shoulders']);
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
  it('returns all 13 muscles ordered by display_order (core last, W2.4)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ muscles: any[] }>();
    expect(body.muscles).toHaveLength(13);
    expect(body.muscles[0].slug).toBe('chest');
    expect(body.muscles[11].slug).toBe('calves');
    expect(body.muscles[12].slug).toBe('core');
  });

  it('sets cache header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/muscles' });
    expect(res.headers['cache-control']).toContain('max-age=86400');
  });
});

afterAll(async () => { await app.close(); await db.end(); });
