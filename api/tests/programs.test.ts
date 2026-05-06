import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

// Phase D's seed-runner e2e tests archive 'strength-cardio-3-2' when proving
// the "missing from input → archive" path (D.19). Restore the curated 3 here
// so this catalog suite is order-independent vs. seed-runner suites.
const CURATED_SLUGS = ['full-body-3-day', 'strength-cardio-3-2', 'upper-lower-4-day'];

beforeAll(async () => {
  await db.query(
    `UPDATE program_templates SET archived_at = NULL
     WHERE slug = ANY($1::text[]) AND archived_at IS NOT NULL`,
    [CURATED_SLUGS],
  );
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM program_templates WHERE archived_at IS NULL`
  );
  if (rows[0].n < 3) throw new Error('program_templates seed not applied (need 3 curated templates)');
  app = await buildApp();
});
afterAll(async () => { await app.close(); await db.end(); });

describe('GET /api/program-templates', () => {
  it('returns 3 non-archived templates with strength + cardio coverage', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/program-templates' });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ templates: any[] }>();
    expect(body.templates.length).toBe(3);
    const slugs = body.templates.map(t => t.slug).sort();
    expect(slugs).toEqual(['full-body-3-day', 'strength-cardio-3-2', 'upper-lower-4-day']);
    const cardio = body.templates.find(t => t.slug === 'strength-cardio-3-2');
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
       (slug, name, weeks, days_per_week, structure, archived_at)
       VALUES ('vitest-archived-tmpl', 'Archived', 4, 3, '{"_v":1,"days":[]}'::jsonb, now())
       RETURNING id`
    );
    try {
      const r = await app.inject({ method: 'GET', url: '/api/program-templates' });
      const slugs = r.json<{ templates: any[] }>().templates.map(t => t.slug);
      expect(slugs).not.toContain('vitest-archived-tmpl');
    } finally {
      await db.query(`DELETE FROM program_templates WHERE id=$1`, [rows[0].id]);
    }
  });
});

describe('GET /api/program-templates/:slug', () => {
  it('returns full structure for a known slug', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/program-templates/full-body-3-day',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.slug).toBe('full-body-3-day');
    expect(body.structure._v).toBe(1);
    expect(Array.isArray(body.structure.days)).toBe(true);
  });

  it('404 on unknown slug', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/program-templates/does-not-exist',
    });
    expect(r.statusCode).toBe(404);
  });

  it('404 on archived template (treats as gone)', async () => {
    const { rows } = await db.query(
      `INSERT INTO program_templates
       (slug, name, weeks, days_per_week, structure, archived_at)
       VALUES ('vitest-archived-detail', 'Archived', 4, 3, '{"_v":1,"days":[]}'::jsonb, now())
       RETURNING id`
    );
    try {
      const r = await app.inject({
        method: 'GET', url: '/api/program-templates/vitest-archived-detail',
      });
      expect(r.statusCode).toBe(404);
    } finally {
      await db.query(`DELETE FROM program_templates WHERE id=$1`, [rows[0].id]);
    }
  });
});

describe('POST /api/program-templates/:slug/fork', () => {
  let userId: string; let token: string;
  beforeAll(async () => {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.fork.${Date.now()}@repos.test`],
    );
    userId = u.id;
    const mint = await app.inject({
      method: 'POST', url: '/api/tokens', body: { user_id: userId, label: 'fork-test' }
    });
    token = mint.json<{ token: string }>().token;
  });
  afterAll(async () => {
    if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });
  const auth = () => ({ authorization: `Bearer ${token}` });

  it('401 without auth', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork',
    });
    expect(r.statusCode).toBe(401);
  });

  it('201 creates user_program with template_id + template_version, status=draft, structure NOT copied', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork',
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
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    const r2 = await app.inject({
      method: 'POST', url: '/api/program-templates/full-body-3-day/fork', headers: auth(),
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json<any>().id).not.toBe(r2.json<any>().id);
  });

  it('404 on unknown slug', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/program-templates/martian-program/fork', headers: auth(),
    });
    expect(r.statusCode).toBe(404);
  });
});
