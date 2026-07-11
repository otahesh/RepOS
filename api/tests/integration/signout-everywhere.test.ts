// api/tests/integration/signout-everywhere.test.ts
//
// Beta W6 Task 8 — POST /api/auth/signout-everywhere full-stack integration.
//
// Spec note: the original plan draft showed test snippets that called this
// route with `Authorization: Bearer ${tokenA}` and expected 204. That
// contradicts C-SIGNOUT-CFACCESS-ONLY (a stolen bearer must NEVER lock the
// legitimate user out). The route is gated on `requireCfAccessOnly`, which
// 403s any Bearer header before JWT validation. The design intent is
// unambiguous, so this test wires the route through the CF Access JWT cookie
// path using `setupTestJwks` — same helper Task 5b uses. Bearer tokens are
// still minted via POST /api/tokens (admin path); the test then calls
// signout-everywhere via the CF Access cookie, and verifies the bearers all
// 401 on their next API call.
//
// Cases:
//   1. revokes all of the user's bearer tokens + sets the clear-cookie header
//      + writes account_events row with meta.revoked_count = 2.
//   2. Idempotent: a second call with zero non-revoked tokens still 204s and
//      still writes an audit row with revoked_count = 0 (no spurious revoke).
//
// CSRF: csrfOrigin requires Origin or X-RepOS-CSRF on the cf_access path. We
// send `x-repos-csrf: 1` rather than setting PUBLIC_ORIGIN globally — keeps
// the test isolated and matches the way the SPA will call this endpoint
// (fetch with X-RepOS-CSRF header, same-origin).

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';

const TEST_EMAIL = `vitest.w6-signout-${Math.random().toString(36).slice(2, 10)}@repos.test`;

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: TestJwksHandle;
let userId: string;
let userJwt: string;
let tokenA: string;
let tokenB: string;
let tokenAId: string;
let tokenBId: string;
let savedPublicOrigin: string | undefined;

beforeAll(async () => {
  // csrfOrigin fails closed when PUBLIC_ORIGIN is unset, even with the
  // X-RepOS-CSRF header. Set it here so the CF Access cookie path actually
  // makes it to the route handler; restore in afterAll.
  savedPublicOrigin = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = 'https://repos.test.example';

  jwks = await setupTestJwks();
  app = await buildApp();

  // Pre-create the user so we can mint admin-path bearer tokens against it.
  // (The CF Access JWT path would auto-provision on first sight, but minting
  // bearers via POST /api/tokens needs the user_id up front.)
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, timezone) VALUES ($1, 'UTC') RETURNING id`,
    [TEST_EMAIL],
  );
  userId = rows[0].id;

  // Mint two bearer tokens via the admin path so we can verify they all
  // become unusable after signout-everywhere.
  const mintA = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'desktop', scopes: ['health:weight:write'] },
  });
  tokenA = mintA.json<{ token: string; id: string }>().token;
  tokenAId = mintA.json<{ token: string; id: string }>().id;
  const mintB = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'mobile', scopes: ['health:weight:write'] },
  });
  tokenB = mintB.json<{ token: string; id: string }>().token;
  tokenBId = mintB.json<{ token: string; id: string }>().id;

  userJwt = await jwks.mintJwt(TEST_EMAIL);
});

afterAll(async () => {
  // Account events cascade to NULL on user delete (ON DELETE SET NULL), so
  // we drop them explicitly to keep the test corpus tidy.
  await db.query(`DELETE FROM account_events WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM device_tokens WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await app.close();
  await jwks.teardown();
  if (savedPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = savedPublicOrigin;
});

describe('POST /api/auth/signout-everywhere', () => {
  it('revokes all bearer tokens, sets clear-cookie, writes audit event', async () => {
    // Sanity precondition — both tokens authenticate before signout.
    const preA = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(preA.statusCode).toBe(200);
    const preB = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(preB.statusCode).toBe(200);

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/signout-everywhere',
      headers: {
        cookie: `CF_Authorization=${userJwt}`,
        'x-repos-csrf': '1',
      },
    });
    expect(r.statusCode).toBe(204);

    // The route must NOT touch the CF_Authorization cookie. The frontend
    // navigates to /cdn-cgi/access/logout next, and Cloudflare only
    // terminates the edge session when that request still carries the
    // cookie — an API-side Max-Age=0 clear made the logout arrive
    // cookieless, CF errored, and the team-domain SSO silently
    // re-authenticated the browser (found live 2026-07-11).
    const setCookie = r.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('\n') : (setCookie ?? '');
    expect(cookieStr).not.toMatch(/CF_Authorization/i);

    // Every previously-valid bearer now 401s on its next API call.
    const postA = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(postA.statusCode).toBe(401);
    const postB = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(postB.statusCode).toBe(401);

    // DB state: both rows carry revoke_reason='signout_everywhere'.
    const { rows: tokRows } = await db.query<{
      id: string;
      revoke_reason: string | null;
      revoked_at: Date | null;
    }>(`SELECT id::text, revoke_reason, revoked_at FROM device_tokens WHERE user_id = $1`, [
      userId,
    ]);
    expect(tokRows.length).toBe(2);
    for (const row of tokRows) {
      expect(row.revoke_reason).toBe('signout_everywhere');
      expect(row.revoked_at).not.toBeNull();
    }
    expect(tokRows.map((r) => r.id).sort()).toEqual([tokenAId, tokenBId].sort());

    // account_events: exactly one signout_everywhere row with revoked_count = 2.
    const { rows: evRows } = await db.query<{
      kind: string;
      meta: { revoked_count?: number };
    }>(`SELECT kind, meta FROM account_events WHERE user_id = $1 AND kind = 'signout_everywhere'`, [
      userId,
    ]);
    expect(evRows.length).toBe(1);
    expect(evRows[0].meta.revoked_count).toBe(2);
  });

  it('idempotent — second call writes a zero-count audit row, no new revokes', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/signout-everywhere',
      headers: {
        cookie: `CF_Authorization=${userJwt}`,
        'x-repos-csrf': '1',
      },
    });
    expect(r.statusCode).toBe(204);

    // Token rows: revoked_at values unchanged (still pointing at the first
    // signout's timestamp, not the second call's).
    const { rows: tokRows } = await db.query<{ revoke_reason: string | null }>(
      `SELECT revoke_reason FROM device_tokens WHERE user_id = $1`,
      [userId],
    );
    expect(tokRows.length).toBe(2);
    for (const row of tokRows) {
      expect(row.revoke_reason).toBe('signout_everywhere');
    }

    // Second audit row, revoked_count = 0.
    const { rows: evRows } = await db.query<{
      meta: { revoked_count?: number };
    }>(
      `SELECT meta FROM account_events
        WHERE user_id = $1 AND kind = 'signout_everywhere'
        ORDER BY occurred_at ASC`,
      [userId],
    );
    expect(evRows.length).toBe(2);
    expect(evRows[1].meta.revoked_count).toBe(0);
  });
});
