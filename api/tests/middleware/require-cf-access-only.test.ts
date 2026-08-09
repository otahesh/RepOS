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
import { mkUserWithEmail } from '../helpers/program-fixtures.js';

let jwks: TestJwksHandle;

const CF_ONLY_EMAIL = 'cfaccess.only@repos.test';

beforeAll(async () => {
  jwks = await setupTestJwks();
  // W9 Q2: the gate is deny-by-default, so the row has to exist before a JWT
  // for it will authenticate — this suite used to rely on the middleware
  // auto-provisioning it. Delete first so a crashed earlier run can't leave a
  // row behind and trip the unique constraint.
  await db.query(`DELETE FROM users WHERE email = $1`, [CF_ONLY_EMAIL]);
  await mkUserWithEmail(CF_ONLY_EMAIL, { status: 'active' });
});

afterAll(async () => {
  await jwks.teardown();
  await db.query(`DELETE FROM users WHERE email = $1`, [CF_ONLY_EMAIL]);
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
    const jwt = await jwks.mintJwt(CF_ONLY_EMAIL);
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
