// Per C-CSRF-ORIGIN — when authMode === 'cf_access', state-changing routes
// require either:
//   (a) Origin header matching the configured host, OR
//   (b) X-RepOS-CSRF: 1 custom header (cross-origin form can't set without
//       preflight)
// Missing/wrong → 403.
//
// This integration test exercises the guard against a minimal test app that
// mounts `csrfOrigin` as a preHandler on a PATCH/DELETE/POST handler. The
// "real" routes that use this guard (`PATCH /api/me/profile`, `DELETE /api/me`,
// `POST /api/auth/signout-everywhere`) land in Tasks 7–9; those tasks will
// add a sibling test that wires through the full route stack. Until then,
// this suite locks in the middleware contract.

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { csrfOrigin } from '../../src/middleware/csrfOrigin.js';
import { db } from '../../src/db/client.js';

const ALLOWED_ORIGIN = 'https://repos.test.example';

let savedOrigin: string | undefined;

beforeAll(() => {
  savedOrigin = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = ALLOWED_ORIGIN;
});

afterAll(async () => {
  if (savedOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = savedOrigin;
  await db.end();
});

/**
 * Build a tiny test app:
 *   - A pre-pre-handler stamps `authMode` (so the test can simulate the
 *     bearer vs CF Access path without bringing up real auth).
 *   - csrfOrigin runs next.
 *   - A trivial handler returns 200 if both pass.
 */
async function buildApp(simulateAuthMode: 'cf_access' | 'bearer'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const stampAuthMode = async (req: any) => {
    req.authMode = simulateAuthMode;
  };
  const handler = async () => ({ ok: true });
  app.patch('/test/profile', { preHandler: [stampAuthMode, csrfOrigin] }, handler);
  app.delete('/test/me', { preHandler: [stampAuthMode, csrfOrigin] }, handler);
  app.post('/test/signout-everywhere', { preHandler: [stampAuthMode, csrfOrigin] }, handler);
  return app;
}

describe('csrfOrigin guard — CF Access cookie path', () => {
  it('PATCH with no Origin and no X-RepOS-CSRF → 403 csrf_origin_required', async () => {
    const app = await buildApp('cf_access');
    try {
      const r = await app.inject({
        method: 'PATCH',
        url: '/test/profile',
        payload: { display_name: 'X' },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({
        error: 'csrf_origin_required',
        expected_origin: ALLOWED_ORIGIN,
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH with wrong Origin → 403', async () => {
    const app = await buildApp('cf_access');
    try {
      const r = await app.inject({
        method: 'PATCH',
        url: '/test/profile',
        headers: { origin: 'https://evil.example.com' },
        payload: { display_name: 'X' },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe('csrf_origin_required');
    } finally {
      await app.close();
    }
  });

  it('PATCH with matching Origin → 200', async () => {
    const app = await buildApp('cf_access');
    try {
      const r = await app.inject({
        method: 'PATCH',
        url: '/test/profile',
        headers: { origin: ALLOWED_ORIGIN },
        payload: { display_name: 'Jason' },
      });
      expect(r.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('PATCH with X-RepOS-CSRF: 1 (no Origin) → 200', async () => {
    const app = await buildApp('cf_access');
    try {
      const r = await app.inject({
        method: 'PATCH',
        url: '/test/profile',
        headers: { 'x-repos-csrf': '1' },
        payload: { display_name: 'Jason CSRF' },
      });
      expect(r.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('DELETE /me also gates on the CSRF guard', async () => {
    const app = await buildApp('cf_access');
    try {
      const r = await app.inject({ method: 'DELETE', url: '/test/me' });
      expect(r.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('POST signout-everywhere also gates on the CSRF guard', async () => {
    const app = await buildApp('cf_access');
    try {
      const r = await app.inject({ method: 'POST', url: '/test/signout-everywhere' });
      expect(r.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('does NOT block bearer-auth paths (guard is cookie-path only)', async () => {
    // When authMode is 'bearer', csrfOrigin pass-throughs — no Origin needed.
    const app = await buildApp('bearer');
    try {
      const r = await app.inject({
        method: 'PATCH',
        url: '/test/profile',
        payload: { display_name: 'Jason Bearer' },
      });
      expect(r.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('fails closed when PUBLIC_ORIGIN env is unset', async () => {
    const prev = process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_ORIGIN;
    const app = await buildApp('cf_access');
    try {
      const r = await app.inject({
        method: 'PATCH',
        url: '/test/profile',
        headers: { origin: 'https://repos.test.example' }, // would normally pass
        payload: { display_name: 'X' },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe('csrf_origin_misconfigured');
    } finally {
      await app.close();
      process.env.PUBLIC_ORIGIN = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Full-stack CSRF cases against the real account/signout routes are covered
// in signout-everywhere.test.ts, account-deletion-cascade.test.ts and
// feedback.test.ts. The original deferred-case list lives in the W6 spec,
// docs/superpowers/plans/2026-05-25-w6-account-ops.md lines 884–957.
// ---------------------------------------------------------------------------
