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
