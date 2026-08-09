// Q3 + Q20 — role, not an env allow-list. And user-management routes reject
// the X-Admin-Key path outright: requireAdminKeyOrCfAccess returns on the
// admin-key branch WITHOUT setting req.userId or req.userEmail, so there is no
// actor — self-lockout guards have no "self" and audit rows have no attribution.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { requireCfAccessAdmin } from '../../src/middleware/cfAccess.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';
import { mkUserWithEmail, cleanupUser } from '../helpers/program-fixtures.js';

let jwks: TestJwksHandle;
let app: Awaited<ReturnType<typeof buildProbe>>;
const created: string[] = [];
let adminEmail: string;
let memberEmail: string;

async function buildProbe() {
  const a = Fastify({ logger: false });
  a.get('/probe', { preHandler: requireCfAccessAdmin() }, async () => ({ ok: true }));
  a.delete(
    '/probe-strict',
    { preHandler: requireCfAccessAdmin({ rejectBearer: true }) },
    async () => ({ ok: true }),
  );
  await a.ready();
  return a;
}

beforeAll(async () => {
  jwks = await setupTestJwks();
  app = await buildProbe();
  adminEmail = `vitest.role-admin-${randomUUID().slice(0, 8)}@repos.test`;
  memberEmail = `vitest.role-member-${randomUUID().slice(0, 8)}@repos.test`;
  created.push((await mkUserWithEmail(adminEmail, { role: 'admin', status: 'active' })).id);
  created.push((await mkUserWithEmail(memberEmail, { role: 'member', status: 'active' })).id);
});

afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await app.close();
  await jwks.teardown();
});

describe('requireCfAccessAdmin (Q3, Q20)', () => {
  it('allows role=admin', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(adminEmail) },
    });
    expect(r.statusCode).toBe(200);
  });

  it('403s role=member', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(memberEmail) },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('not_an_admin');
  });

  it('rejects the X-Admin-Key path even with a valid key', async () => {
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'valid-key';
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { 'x-admin-key': 'valid-key' },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json<{ error: string }>().error).toBe('cf_access_required');
    } finally {
      if (saved === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = saved;
    }
  });

  it('401s with no CF Access JWT at all', async () => {
    const r = await app.inject({ method: 'GET', url: '/probe' });
    expect(r.statusCode).toBe(401);
  });

  it('rejectBearer:true 403s an Authorization: Bearer header before JWT validation', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: '/probe-strict',
      headers: { authorization: 'Bearer whatever' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json<{ error: string }>().error).toBe('cf_access_required');
  });

  // NOTE: there is deliberately NO "the gate ignores the old admin-emails env
  // var" test here. Writing one means writing an env read for that variable,
  // and Task 19's sweep matches raw file text — it cannot tell a real reader
  // from one inside a test or a comment, so this file would become the sweep's
  // only remaining offender and fail it deterministically. The sweep is also
  // the strictly stronger statement: "no file reads it anywhere" subsumes
  // "setting it changes nothing here". This comment names no variable for the
  // same reason.
});
