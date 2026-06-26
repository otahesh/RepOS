import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireAdminKeyOrCfAccess } from '../../src/middleware/cfAccess.js';

// The X-Admin-Key path now compares via constantTimeEqual instead of `!==`.
// These tests prove the gate's BEHAVIOR is unchanged: correct key passes,
// any wrong key (including same-length) is rejected 401.

let app: FastifyInstance;
let savedAdminKey: string | undefined;
let savedCfEnabled: string | undefined;

beforeAll(async () => {
  savedAdminKey = process.env.ADMIN_API_KEY;
  savedCfEnabled = process.env.CF_ACCESS_ENABLED;
  process.env.ADMIN_API_KEY = 'correct-admin-key-123';
  // Disable CF Access so the no-/wrong-key paths resolve to 401 here rather
  // than delegating to the CF Access validator.
  delete process.env.CF_ACCESS_ENABLED;

  app = Fastify();
  app.get('/admin-only', { preHandler: requireAdminKeyOrCfAccess() }, async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = savedAdminKey;
  if (savedCfEnabled === undefined) delete process.env.CF_ACCESS_ENABLED;
  else process.env.CF_ACCESS_ENABLED = savedCfEnabled;
});

describe('X-Admin-Key gate (constant-time compare)', () => {
  it('passes with the correct admin key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { 'x-admin-key': 'correct-admin-key-123' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong admin key with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { 'x-admin-key': 'totally-wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong key of the same length with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { 'x-admin-key': 'correct-admin-key-124' },
    });
    expect(res.statusCode).toBe(401);
  });
});
