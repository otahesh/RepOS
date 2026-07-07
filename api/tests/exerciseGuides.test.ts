import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let withGuideId: string, withoutGuideId: string, archivedGuideId: string;

async function mkEx(slug: string): Promise<string> {
  // Crash-cruft pre-clean (shared repos_test DB).
  await db.query(`DELETE FROM exercises WHERE slug=$1`, [slug]);
  const {
    rows: [ex],
  } = await db.query<{ id: string }>(
    `INSERT INTO exercises (slug, name, primary_muscle_id, movement_pattern, peak_tension_length,
                            skill_complexity, loading_demand, systemic_fatigue)
     VALUES ($1,'x',(SELECT id FROM muscles WHERE slug='chest'),'push_horizontal','mid',3,3,3)
     RETURNING id`,
    [slug],
  );
  return ex.id;
}

beforeAll(async () => {
  app = await buildApp();
  withGuideId = await mkEx('test-guide-route-yes');
  withoutGuideId = await mkEx('test-guide-route-no');
  archivedGuideId = await mkEx('test-guide-route-archived');
  await db.query(
    `INSERT INTO exercise_guides (exercise_id, setup_callout, setup_facts, cues, donts, media, archived_at)
     VALUES ($1, 'Bench: 30 degrees. Feet flat, slight arch, shoulder blades pinched together.',
             '{"bench_angle_deg":30}'::jsonb,
             ARRAY['cue one here','cue two here','cue three here'],
             ARRAY['mistake one here','mistake two here'], '{}'::jsonb, NULL),
            ($2, 'Archived guide callout text long enough to satisfy the length check.',
             '{}'::jsonb,
             ARRAY['cue one here','cue two here','cue three here'],
             ARRAY['mistake one here','mistake two here'], '{}'::jsonb, now())`,
    [withGuideId, archivedGuideId],
  );
});

afterAll(async () => {
  // Restore state: guides cascade with their exercises.
  await db.query(`DELETE FROM exercises WHERE id = ANY($1::uuid[])`, [
    [withGuideId, withoutGuideId, archivedGuideId],
  ]);
  await app.close();
  await db.end();
});

describe('GET /api/exercises/:slug/guide', () => {
  it('returns the guide with public caching', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/test-guide-route-yes/guide',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
    const body = res.json();
    expect(body).toEqual({
      slug: 'test-guide-route-yes',
      setup_callout: expect.stringContaining('Bench: 30 degrees'),
      setup_facts: { bench_angle_deg: 30 },
      cues: ['cue one here', 'cue two here', 'cue three here'],
      donts: ['mistake one here', 'mistake two here'],
      media: {},
    });
  });

  it('404s when the exercise has no guide', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/test-guide-route-no/guide',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'guide not found', field: 'slug' });
  });

  it('404s for an archived guide', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/test-guide-route-archived/guide',
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown exercise', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/exercises/no-such-slug/guide' });
    expect(res.statusCode).toBe(404);
  });
});
