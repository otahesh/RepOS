// G2 contamination matrix — six rows. A CF-Access-authenticated `member` must
// be refused on every user-management route, and the X-Admin-Key escape hatch
// must not work on any of them (Q20).
//
// Why the admin-key half matters as much as the role half: that branch returns
// WITHOUT setting req.userId/req.userEmail, so there is no actor — the Q13
// self-target guards would have no "self" to compare against and every audit
// row would be unattributed. It is refused on header presence alone, before
// any CF Access check.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../../src/app.js';
import { setupTestJwks, type TestJwksHandle } from '../../helpers/cf-access-jwt.js';
import { mkUserWithEmail, cleanupUser } from '../../helpers/program-fixtures.js';
import { db } from '../../../src/db/client.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: TestJwksHandle;
let memberEmail: string;
let victimId: string;
const created: string[] = [];

beforeAll(async () => {
  jwks = await setupTestJwks();
  app = await buildApp();
  memberEmail = `w9.contam-member-${randomUUID().slice(0, 8)}@repos.test`;
  created.push((await mkUserWithEmail(memberEmail, { role: 'member', status: 'active' })).id);
  const victim = await mkUserWithEmail(`w9.contam-victim-${randomUUID().slice(0, 8)}@repos.test`, {
    role: 'member', status: 'active',
  });
  victimId = victim.id;
  created.push(victimId);
});

afterAll(async () => {
  for (const id of created) await cleanupUser(id).catch(() => {});
  await app.close();
  await jwks.teardown();
});

const ROUTES: Array<{ name: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: (id: string) => string; payload?: unknown }> = [
  { name: 'GET /api/admin/users',                    method: 'GET',    url: () => '/api/admin/users' },
  { name: 'POST /api/admin/users/invite',            method: 'POST',   url: () => '/api/admin/users/invite', payload: { email: 'x@repos.test', role: 'member' } },
  { name: 'POST /api/admin/users/:id/resend-invite', method: 'POST',   url: (id) => `/api/admin/users/${id}/resend-invite` },
  { name: 'PATCH /api/admin/users/:id',              method: 'PATCH',  url: (id) => `/api/admin/users/${id}`, payload: { status: 'suspended' } },
  { name: 'DELETE /api/admin/users/:id',             method: 'DELETE', url: (id) => `/api/admin/users/${id}` },
  { name: 'POST /api/admin/users/:id/retry-sync',    method: 'POST',   url: (id) => `/api/admin/users/${id}/retry-sync` },
];

describe('W9 contamination matrix — six rows toward G2', () => {
  for (const r of ROUTES) {
    it(`${r.name}: a CF-Access member gets 403`, async () => {
      const res = await app.inject({
        method: r.method, url: r.url(victimId),
        headers: { 'cf-access-jwt-assertion': await jwks.mintJwt(memberEmail), 'x-repos-csrf': '1' },
        ...(r.payload ? { payload: r.payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ error: string }>().error).toBe('not_an_admin');
    });

    it(`${r.name}: the X-Admin-Key path is rejected`, async () => {
      // ADMIN_API_KEY is set to the value we then present, so this proves a
      // *correct* admin key is refused — not merely that a wrong one is.
      const saved = process.env.ADMIN_API_KEY;
      process.env.ADMIN_API_KEY = 'contam-key';
      try {
        const res = await app.inject({
          method: r.method, url: r.url(victimId),
          headers: { 'x-admin-key': 'contam-key', 'x-repos-csrf': '1' },
          ...(r.payload ? { payload: r.payload } : {}),
        });
        expect(res.statusCode).toBe(403);
        expect(res.json<{ error: string }>().error).toBe('cf_access_required');
      } finally {
        if (saved === undefined) delete process.env.ADMIN_API_KEY;
        else process.env.ADMIN_API_KEY = saved;
      }
    });
  }

  // The rejections above assert a response code. This asserts the operation
  // did not happen — a route that mutated and *then* refused would satisfy
  // every case above and fail here.
  it('the victim is untouched by every rejected attempt', async () => {
    const { rows } = await db.query<{ status: string; role: string }>(
      `SELECT status, role FROM users WHERE id=$1`, [victimId],
    );
    expect(rows[0]).toEqual({ status: 'active', role: 'member' });
  });
});
