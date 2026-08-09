// W5 — C-RESTORE-AUTH-CFACCESS. The restore endpoints require a fresh CF
// Access JWT and REJECT the X-Admin-Key path. This exercises the
// requireFreshCfAccess option of the requireAdminKeyOrCfAccess factory.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import { requireAdminKeyOrCfAccess } from '../../src/middleware/cfAccess.js';
import { db } from '../../src/db/client.js';

afterAll(async () => {
  await db.end();
});

describe('requireAdminKeyOrCfAccess factory', () => {
  it('default factory still gates via X-Admin-Key (back-compat)', async () => {
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'test-key-admin-gate';
    const app = Fastify({ logger: false });
    app.get('/api/_test/dual', { preHandler: requireAdminKeyOrCfAccess() }, async () => ({
      ok: true,
    }));
    try {
      const good = await app.inject({
        method: 'GET',
        url: '/api/_test/dual',
        headers: { 'x-admin-key': 'test-key-admin-gate' },
      });
      expect(good.statusCode).toBe(200);
      const bad = await app.inject({
        method: 'GET',
        url: '/api/_test/dual',
        headers: { 'x-admin-key': 'wrong' },
      });
      expect(bad.statusCode).toBe(401);
    } finally {
      await app.close();
      if (saved === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = saved;
    }
  });

  it('requireFreshCfAccess rejects X-Admin-Key path', async () => {
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'test-key-fresh';
    const app = Fastify({ logger: false });
    app.post(
      '/api/_test/strict',
      { preHandler: requireAdminKeyOrCfAccess({ requireFreshCfAccess: true }) },
      async () => ({ ok: true }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/_test/strict',
        headers: { 'x-admin-key': 'test-key-fresh' },
      });
      expect([401, 403, 503]).toContain(res.statusCode); // never 200
      expect(res.statusCode).not.toBe(200);
    } finally {
      await app.close();
      if (saved === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = saved;
    }
  });
});
