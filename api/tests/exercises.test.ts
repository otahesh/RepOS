import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

beforeAll(async () => {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM exercises WHERE archived_at IS NULL`);
  if (rows[0].n < 30) throw new Error('seed not applied');
  app = await buildApp();
});
afterAll(async () => { await app.close(); await db.end(); });

describe('GET /api/exercises (spec §9.4)', () => {
  it('19. returns full non-archived catalog with stable slug ordering', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/exercises' });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ exercises: any[] }>();
    expect(body.exercises.length).toBeGreaterThanOrEqual(30);
    const slugs = body.exercises.map(e => e.slug);
    expect(slugs).toEqual([...slugs].sort());
  });

  it('20. 404 on unknown slug', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/exercises/does-not-exist' });
    expect(r.statusCode).toBe(404);
  });

  it('21. response includes resolved muscle slugs + names, not just IDs', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/exercises/barbell-bench-press' });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.primary_muscle).toBe('chest');
    expect(body.primary_muscle_name).toBe('Chest');
    expect(body.muscle_contributions.chest).toBe(1.0);
  });

  it('22. perf budget GET /api/exercises < 50ms warm', async () => {
    await app.inject({ method: 'GET', url: '/api/exercises' }); // warm
    const start = Date.now();
    await app.inject({ method: 'GET', url: '/api/exercises' });
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe('GET /api/exercises/:slug/substitutions', () => {
  let userId: string;
  let token: string;
  beforeAll(async () => {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email, equipment_profile)
       VALUES ($1, $2::jsonb) RETURNING id`,
      [`vitest.subs.${Date.now()}@repos.test`, JSON.stringify({
        _v: 1,
        dumbbells: { min_lb: 10, max_lb: 100, increment_lb: 10 },
        adjustable_bench: { incline: true, decline: true },
      })],
    );
    userId = u.id;
    const mint = await app.inject({
      method: 'POST', url: '/api/tokens',
      body: { user_id: userId, label: 'sub-test' },
    });
    token = mint.json<{ token: string }>().token;
  });
  afterAll(async () => {
    if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  it('returns ranked subs for an authed user', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/exercises/barbell-bench-press/substitutions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.from.slug).toBe('barbell-bench-press');
    expect(Array.isArray(body.subs)).toBe(true);
    expect(r.headers['cache-control']).toContain('private');
  });

  it('returns 404 for unknown slug', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/exercises/missing/substitutions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(404);
  });
});
