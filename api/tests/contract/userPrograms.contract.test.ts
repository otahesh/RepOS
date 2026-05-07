/**
 * Contract tests for the /api/user-programs route surface.
 *
 * Tests hit real route handlers via Fastify inject() and parse responses
 * through the canonical Zod schemas in api/src/schemas/userPrograms.ts.
 * Shape drift between handler and schema causes a loud failure here.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  UserProgramListResponseSchema,
  UserProgramWarningsResponseSchema,
} from '../../src/schemas/userPrograms.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.contract.userprograms.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'contract-test' },
  });
  token = mint.json<{ token: string }>().token;
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// GET /api/user-programs
// ---------------------------------------------------------------------------

describe('GET /api/user-programs contract', () => {
  it('empty list response parses through UserProgramListResponseSchema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/user-programs',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = UserProgramListResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(Array.isArray(parsed.data.programs)).toBe(true);
    }
  });

  it('include=past list response also parses through UserProgramListResponseSchema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/user-programs?include=past',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = UserProgramListResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/user-programs/:id — 404 on unknown
// ---------------------------------------------------------------------------

describe('GET /api/user-programs/:id contract', () => {
  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/user-programs/00000000-0000-0000-0000-000000000000',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/user-programs/:id/warnings
// ---------------------------------------------------------------------------

describe('GET /api/user-programs/:id/warnings contract', () => {
  it('warnings response parses through UserProgramWarningsResponseSchema when program exists', async () => {
    // Need a forked user_program with a linked template
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE archived_at IS NULL LIMIT 1`,
    );
    if (!tmpl) {
      console.warn('No templates in DB — skipping warnings contract test');
      return;
    }
    const { rows: [up] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, customizations, status)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, 'draft')
       RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/user-programs/${up.id}/warnings`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = UserProgramWarningsResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(Array.isArray(parsed.data.warnings)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/user-programs/:id — 404 on unknown
// ---------------------------------------------------------------------------

describe('PATCH /api/user-programs/:id contract', () => {
  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/user-programs/00000000-0000-0000-0000-000000000000',
      headers: auth(),
      body: { op: 'rename', name: 'New Name' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 on invalid op body', async () => {
    // Need any real program to test validation path
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE archived_at IS NULL LIMIT 1`,
    );
    if (!tmpl) return;
    const { rows: [up] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name, customizations, status)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, 'draft')
       RETURNING id`,
      [userId, tmpl.id, tmpl.version, tmpl.name],
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${up.id}`,
      headers: auth(),
      body: { op: 'invalid_op' }, // not in discriminated union
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; field: string }>();
    expect(typeof body.error).toBe('string');
    expect(typeof body.field).toBe('string');
  });
});
