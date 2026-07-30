// Per D10 — REPOS_ADMIN_EMAILS branch in `requireAdminKeyOrCfAccess`.
//
// We exercise the live middleware end-to-end against a real CF Access JWT
// (signed by the in-process JWKS helper) + the real Postgres DB (which
// `requireCfAccess` queries for the pre-created user row). This is the only
// way to test the admin-check branch — `requireAdminKeyOrCfAccess` calls
// `requireCfAccess` by direct reference, so module-level spies can't
// intercept it.
//
// Branches under test:
//   1. REPOS_ADMIN_EMAILS unset                  → 403 admin_check_misconfigured
//   2. Email not in REPOS_ADMIN_EMAILS           → 403 not_an_admin
//   3. Email present in REPOS_ADMIN_EMAILS       → pass (handler echoes ok)
//   4. Email present case-insensitively in env   → pass

import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireAdminKeyOrCfAccess } from '../../src/middleware/cfAccess.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';
import { db } from '../../src/db/client.js';
import { mkUserWithEmail } from '../helpers/program-fixtures.js';

let jwks: TestJwksHandle;
let savedAdminKey: string | undefined;
let savedAdminEmails: string | undefined;

// W9 Q2: every email this suite mints a JWT for needs a pre-existing users
// row. The gate is deny-by-default now, so without these the four cases below
// all stop at 403 not_invited and never reach the admin-check branch they exist
// to test. This file was NOT in the plan's Step 5 flip list.
const D10_EMAILS = [
  'd10.allowed@repos.test',
  'd10.denied@repos.test',
  'd10.misconf@repos.test',
  'd10.mixedcase@repos.test',
];

beforeAll(async () => {
  jwks = await setupTestJwks();
  // Delete first so a crashed earlier run can't trip the unique constraint.
  await db.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [D10_EMAILS]);
  for (const email of D10_EMAILS) {
    await mkUserWithEmail(email, { status: 'active' });
  }
  // Force ADMIN_API_KEY to be set so the function doesn't take the "no admin
  // key → open admin" early-return. Empty string would also be falsy.
  savedAdminKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'test-admin-key-for-d10-suite';
  savedAdminEmails = process.env.REPOS_ADMIN_EMAILS;
});

afterAll(async () => {
  await jwks.teardown();
  if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = savedAdminKey;
  if (savedAdminEmails === undefined) delete process.env.REPOS_ADMIN_EMAILS;
  else process.env.REPOS_ADMIN_EMAILS = savedAdminEmails;
  // Clear the rows beforeAll created (no longer auto-provisioned — W9 Q2).
  await db.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [D10_EMAILS]);
  await db.end();
});

afterEach(() => {
  delete process.env.REPOS_ADMIN_EMAILS;
});

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/admin-echo', { preHandler: requireAdminKeyOrCfAccess() }, async (req) => ({
    ok: true,
    authMode: (req as any).authMode,
    userEmail: (req as any).userEmail ?? null,
  }));
  return app;
}

describe('requireAdminKeyOrCfAccess — REPOS_ADMIN_EMAILS branch (D10)', () => {
  it('403 admin_check_misconfigured when REPOS_ADMIN_EMAILS unset', async () => {
    // (REPOS_ADMIN_EMAILS already deleted in afterEach of previous run.)
    delete process.env.REPOS_ADMIN_EMAILS;
    const jwt = await jwks.mintJwt('d10.misconf@repos.test');
    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/admin-echo',
        headers: { 'cf-access-jwt-assertion': jwt },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: 'admin_check_misconfigured' });
    } finally {
      await app.close();
    }
  });

  it('403 not_an_admin when email is not in REPOS_ADMIN_EMAILS', async () => {
    process.env.REPOS_ADMIN_EMAILS = 'd10.allowed@repos.test';
    const jwt = await jwks.mintJwt('d10.denied@repos.test');
    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/admin-echo',
        headers: { 'cf-access-jwt-assertion': jwt },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: 'not_an_admin' });
    } finally {
      await app.close();
    }
  });

  it('passes through when email matches REPOS_ADMIN_EMAILS', async () => {
    process.env.REPOS_ADMIN_EMAILS = 'd10.allowed@repos.test, other@repos.test';
    const jwt = await jwks.mintJwt('d10.allowed@repos.test');
    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/admin-echo',
        headers: { 'cf-access-jwt-assertion': jwt },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json<{ ok: boolean; authMode: string; userEmail: string }>();
      expect(body.ok).toBe(true);
      expect(body.authMode).toBe('cf_access');
      expect(body.userEmail).toBe('d10.allowed@repos.test');
    } finally {
      await app.close();
    }
  });

  it('case-insensitive match against REPOS_ADMIN_EMAILS', async () => {
    // Env in mixed case; the JWT email claim is lowercased by requireCfAccess
    // when stashed on the request, so we lowercase both sides in the check.
    process.env.REPOS_ADMIN_EMAILS = 'D10.MixedCase@Repos.Test';
    const jwt = await jwks.mintJwt('d10.mixedcase@repos.test');
    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/admin-echo',
        headers: { 'cf-access-jwt-assertion': jwt },
      });
      expect(r.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
