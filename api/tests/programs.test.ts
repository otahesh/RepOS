import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

beforeAll(async () => {
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
