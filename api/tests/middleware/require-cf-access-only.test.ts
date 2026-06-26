// Per C-SIGNOUT-CFACCESS-ONLY — `requireCfAccessOnly` rejects bearer auth
// outright and delegates to the existing CF Access validator for the cookie
// path. Used by POST /api/auth/signout-everywhere and DELETE /api/me to
// guarantee a stolen bearer token can never trigger account deletion or a
// mass sign-out.
//
// Branches under test:
//   1. Authorization: Bearer ... → 403 cf_access_required (no JWT validation)
//   2. No bearer, no CF Access cookie → 401 no_cf_access_jwt
//   3. Valid CF Access JWT → 200 (passes through to handler)

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireCfAccessOnly } from '../../src/middleware/cfAccess.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';
import { db } from '../../src/db/client.js';

let jwks: TestJwksHandle;

beforeAll(async () => {
  jwks = await setupTestJwks();
});

afterAll(async () => {
  await jwks.teardown();
  await db.query(`DELETE FROM users WHERE email = $1`, ['cfaccess.only@repos.test']);
  await db.end();
});

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.post('/signout-everywhere-test', { preHandler: requireCfAccessOnly }, async (req) => ({
    ok: true,
    userEmail: (req as any).userEmail,
  }));
  return app;
}

describe('requireCfAccessOnly (C-SIGNOUT-CFACCESS-ONLY)', () => {
  it('403 cf_access_required when called with a bearer token', async () => {
    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/signout-everywhere-test',
        headers: { authorization: 'Bearer some-bearer-token.value' },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: 'cf_access_required' });
    } finally {
      await app.close();
    }
  });

  it('401 no_cf_access_jwt when no auth headers are present', async () => {
    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/signout-everywhere-test',
      });
      expect(r.statusCode).toBe(401);
      expect(r.json().error).toBe('no_cf_access_jwt');
    } finally {
      await app.close();
    }
  });

  it('passes through to the handler with a valid CF Access JWT', async () => {
    const jwt = await jwks.mintJwt('cfaccess.only@repos.test');
    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/signout-everywhere-test',
        headers: { 'cf-access-jwt-assertion': jwt },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json<{ ok: boolean; userEmail: string }>().userEmail).toBe(
        'cfaccess.only@repos.test',
      );
    } finally {
      await app.close();
    }
  });
});
