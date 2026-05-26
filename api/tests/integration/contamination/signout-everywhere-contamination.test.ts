// api/tests/integration/contamination/signout-everywhere-contamination.test.ts
//
// G2 contribution — user A's signout-everywhere must never revoke user B's
// device tokens, and must never write an audit row attributed to user B.
//
// The route is CF-Access-JWT-only (per C-SIGNOUT-CFACCESS-ONLY), so this test
// mints a real CF Access JWT for user A and posts via the cookie path. Bearer
// tokens are minted for both users via the admin-path /api/tokens (which is
// how alpha users still authenticate); we verify B's bearer keeps working
// after A's signout.
//
// Asserts:
//   1. Before signout, both A's and B's bearers authenticate.
//   2. After A signs out everywhere: A's bearer 401s, B's bearer still 200s.
//   3. account_events.kind='signout_everywhere' exists for A only, never for B.

import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { setupTestJwks, type TestJwksHandle } from '../../helpers/cf-access-jwt.js';

const EMAIL_A = `vitest.w6-signout-cont-a-${Math.random().toString(36).slice(2, 10)}@repos.test`;
const EMAIL_B = `vitest.w6-signout-cont-b-${Math.random().toString(36).slice(2, 10)}@repos.test`;

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: TestJwksHandle;
let userA: string;
let userB: string;
let jwtA: string;
let tokenA: string;
let tokenB: string;
let savedPublicOrigin: string | undefined;

beforeAll(async () => {
  savedPublicOrigin = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = 'https://repos.test.example';

  jwks = await setupTestJwks();
  app = await buildApp();

  const a = await db.query<{ id: string }>(
    `INSERT INTO users (email, timezone) VALUES ($1, 'UTC') RETURNING id`,
    [EMAIL_A],
  );
  userA = a.rows[0].id;
  const b = await db.query<{ id: string }>(
    `INSERT INTO users (email, timezone) VALUES ($1, 'UTC') RETURNING id`,
    [EMAIL_B],
  );
  userB = b.rows[0].id;

  const mintA = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userA, label: 'A-desktop', scopes: ['health:weight:write'] },
  });
  tokenA = mintA.json<{ token: string }>().token;
  const mintB = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userB, label: 'B-mobile', scopes: ['health:weight:write'] },
  });
  tokenB = mintB.json<{ token: string }>().token;

  jwtA = await jwks.mintJwt(EMAIL_A);
});

afterAll(async () => {
  await db.query(`DELETE FROM account_events WHERE user_id IN ($1,$2)`, [userA, userB]);
  await db.query(`DELETE FROM device_tokens WHERE user_id IN ($1,$2)`, [userA, userB]);
  await db.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
  await app.close();
  await jwks.teardown();
  if (savedPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = savedPublicOrigin;
});

describe('POST /api/auth/signout-everywhere contamination — G2', () => {
  it('A signing out does NOT revoke B; audit row exists for A only', async () => {
    // Precondition: both bearers work.
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

    // A signs out everywhere via the CF Access cookie path.
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/signout-everywhere',
      headers: {
        cookie: `CF_Authorization=${jwtA}`,
        'x-repos-csrf': '1',
      },
    });
    expect(r.statusCode).toBe(204);

    // A's bearer is now revoked.
    const postA = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(postA.statusCode).toBe(401);

    // B's bearer must still work — A's signout must NOT bleed into B.
    const postB = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(postB.statusCode).toBe(200);

    // B's device_tokens row remains non-revoked.
    const { rows: bTok } = await db.query<{
      revoke_reason: string | null;
      revoked_at: Date | null;
    }>(
      `SELECT revoke_reason, revoked_at FROM device_tokens WHERE user_id = $1`,
      [userB],
    );
    expect(bTok.length).toBe(1);
    expect(bTok[0].revoked_at).toBeNull();
    expect(bTok[0].revoke_reason).toBeNull();

    // account_events has exactly one signout_everywhere row, attributed to A.
    const { rows: aEv } = await db.query<{ user_id: string }>(
      `SELECT user_id::text FROM account_events WHERE kind = 'signout_everywhere' AND user_id = $1`,
      [userA],
    );
    expect(aEv.length).toBe(1);
    const { rows: bEv } = await db.query(
      `SELECT 1 FROM account_events WHERE kind = 'signout_everywhere' AND user_id = $1`,
      [userB],
    );
    expect(bEv.length).toBe(0);
  });
});
