import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

// Phase D's seed-runner e2e tests archive 'strength-cardio-3-2' when proving
// the "missing from input → archive" path (D.19). Restore the curated 4 here
// so this catalog suite is order-independent vs. seed-runner suites.
const CURATED_SLUGS = [
  'full-body-2-day',
  'full-body-3-day',
  'strength-cardio-3-2',
  'upper-lower-4-day',
];

beforeAll(async () => {
  await db.query(
    `UPDATE program_templates SET archived_at = NULL
     WHERE slug = ANY($1::text[]) AND archived_at IS NOT NULL`,
    [CURATED_SLUGS],
  );
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM program_templates WHERE archived_at IS NULL`,
  );
  if (rows[0].n < CURATED_SLUGS.length)
    throw new Error(
      `program_templates seed not applied (need ${CURATED_SLUGS.length} curated templates)`,
    );
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await db.end();
});

describe('GET /api/program-templates', () => {
  it('returns the curated templates with strength + cardio coverage', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/program-templates' });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ templates: any[] }>();
    // Superset assertion, not exact-list: sibling suites insert their own
    // program_templates rows into the shared repos_test DB, and an
    // interrupted run can leak them past a finally-cleanup. Curated slugs
    // present + non-archived is the seed contract; leaked extras are the
    // sibling's bug, not this route's.
    const slugs = body.templates.map((t) => t.slug);
    for (const slug of CURATED_SLUGS) expect(slugs).toContain(slug);
    const cardio = body.templates.find((t) => t.slug === 'strength-cardio-3-2');
    expect(cardio).toBeDefined();
    expect(cardio.days_per_week).toBe(5);
  });

  it('sets Cache-Control: public, max-age=300', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/program-templates' });
    expect(r.headers['cache-control']).toMatch(/public.*max-age=300/);
  });

  it('omits archived_at IS NOT NULL templates', async () => {
    const { rows } = await db.query(
      `INSERT INTO program_templates
       (slug, name, weeks, days_per_week, structure, archived_at, track)
       VALUES ('vitest-archived-tmpl', 'Archived', 4, 3, '{"_v":1,"days":[]}'::jsonb, now(), 'beginner')
       RETURNING id`,
    );
    try {
      const r = await app.inject({ method: 'GET', url: '/api/program-templates' });
      const slugs = r.json<{ templates: any[] }>().templates.map((t) => t.slug);
      expect(slugs).not.toContain('vitest-archived-tmpl');
    } finally {
      await db.query(`DELETE FROM program_templates WHERE id=$1`, [rows[0].id]);
    }
  });
  it('list returns a track on every template', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/program-templates' });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ templates: { slug: string; track: string }[] }>();
    expect(body.templates.length).toBeGreaterThanOrEqual(3);
    for (const t of body.templates) {
      expect(['beginner', 'intermediate', 'advanced']).toContain(t.track);
    }
  });

  it('?track=intermediate returns only intermediate templates', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/program-templates?track=intermediate' });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ templates: { slug: string; track: string }[] }>();
    expect(body.templates.length).toBeGreaterThan(0);
    expect(body.templates.every((t) => t.track === 'intermediate')).toBe(true);
  });

  it('?track=bogus returns 400 with actionable error', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/program-templates?track=bogus' });
    expect(r.statusCode).toBe(400);
    expect(r.json<{ error: string }>().error).toMatch(/track/i);
  });
});

describe('GET /api/program-templates/:slug', () => {
  it('returns full structure for a known slug', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/program-templates/full-body-3-day',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.slug).toBe('full-body-3-day');
    expect(body.structure._v).toBe(1);
    expect(Array.isArray(body.structure.days)).toBe(true);
  });

  it('detail returns a track', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/program-templates/full-body-3-day' });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ track: string }>().track).toBe('beginner');
  });

  it('404 on unknown slug', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/program-templates/does-not-exist',
    });
    expect(r.statusCode).toBe(404);
  });

  it('404 on archived template (treats as gone)', async () => {
    const { rows } = await db.query(
      `INSERT INTO program_templates
       (slug, name, weeks, days_per_week, structure, archived_at, track)
       VALUES ('vitest-archived-detail', 'Archived', 4, 3, '{"_v":1,"days":[]}'::jsonb, now(), 'beginner')
       RETURNING id`,
    );
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/api/program-templates/vitest-archived-detail',
      });
      expect(r.statusCode).toBe(404);
    } finally {
      await db.query(`DELETE FROM program_templates WHERE id=$1`, [rows[0].id]);
    }
  });
});

describe('POST /api/program-templates/:slug/fork', () => {
  let userId: string;
  let token: string;
  beforeAll(async () => {
    const {
      rows: [u],
    } = await db.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [
      `vitest.fork.${Date.now()}@repos.test`,
    ]);
    userId = u.id;
    const mint = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: userId, label: 'fork-test' },
    });
    token = mint.json<{ token: string }>().token;
  });
  afterAll(async () => {
    if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });
  const auth = () => ({ authorization: `Bearer ${token}` });

  it('401 without auth', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
    });
    expect(r.statusCode).toBe(401);
  });

  it('201 creates user_program with template_id + template_version, status=draft, structure NOT copied', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    expect(r.statusCode).toBe(201);
    const body = r.json<any>();
    expect(body.id).toBeDefined();
    expect(body.template_id).toBeDefined();
    expect(body.template_version).toBeGreaterThanOrEqual(1);
    expect(body.status).toBe('draft');
    expect(body.customizations).toEqual({});
    // structure must NOT be carried on user_programs (Q16)
    expect(body.structure).toBeUndefined();
    // verify in DB
    const { rows } = await db.query(
      `SELECT template_id, template_version, status FROM user_programs WHERE id=$1`,
      [body.id],
    );
    expect(rows[0].status).toBe('draft');
  });

  it('two forks of the same template produce independent rows', async () => {
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/program-templates/full-body-3-day/fork',
      headers: auth(),
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json<any>().id).not.toBe(r2.json<any>().id);
  });

  it('404 on unknown slug', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/program-templates/martian-program/fork',
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
  });
});
