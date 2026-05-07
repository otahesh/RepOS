/**
 * Contract tests for the /api/program-templates route surface.
 *
 * Tests hit real route handlers via Fastify inject() and parse responses
 * through the canonical Zod schemas in api/src/schemas/programs.ts.
 * Shape drift between handler and schema causes a loud failure here.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  ProgramTemplateListResponseSchema,
  ProgramTemplateDetailResponseSchema,
  ProgramForkResponseSchema,
} from '../../src/schemas/programs.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let token: string;
let templateSlug: string | undefined;

beforeAll(async () => {
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.contract.programs.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'contract-test' },
  });
  token = mint.json<{ token: string }>().token;

  // Find any non-archived template to use for detail + fork tests
  const { rows: [tmpl] } = await db.query(
    `SELECT slug FROM program_templates WHERE archived_at IS NULL LIMIT 1`,
  );
  templateSlug = tmpl?.slug;
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// GET /api/program-templates
// ---------------------------------------------------------------------------

describe('GET /api/program-templates contract', () => {
  it('200 response parses through ProgramTemplateListResponseSchema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/program-templates',
    });
    expect(res.statusCode).toBe(200);
    const parsed = ProgramTemplateListResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(Array.isArray(parsed.data.templates)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/program-templates/:slug
// ---------------------------------------------------------------------------

describe('GET /api/program-templates/:slug contract', () => {
  it('200 response parses through ProgramTemplateDetailResponseSchema', async () => {
    if (!templateSlug) {
      console.warn('No templates in DB — skipping detail test');
      return;
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/program-templates/${templateSlug}`,
    });
    expect(res.statusCode).toBe(200);
    const parsed = ProgramTemplateDetailResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.slug).toBe(templateSlug);
      expect(parsed.data.structure._v).toBe(1);
      expect(Array.isArray(parsed.data.structure.days)).toBe(true);
    }
  });

  it('404 on unknown slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/program-templates/this-slug-does-not-exist',
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/program-templates/:slug/fork
// ---------------------------------------------------------------------------

describe('POST /api/program-templates/:slug/fork contract', () => {
  it('201 response parses through ProgramForkResponseSchema', async () => {
    if (!templateSlug) {
      console.warn('No templates in DB — skipping fork test');
      return;
    }
    const res = await app.inject({
      method: 'POST',
      url: `/api/program-templates/${templateSlug}/fork`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(201);
    const parsed = ProgramForkResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('draft');
    }
  });
});
