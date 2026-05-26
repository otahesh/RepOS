// api/tests/integration/contamination/account-sessions-contamination.test.ts
//
// G2 contribution — GET /api/account/sessions with user-A bearer must never
// return user-B's device_tokens rows. Extracted from Task 7's
// account-profile-contamination.test.ts (which still owns the assertion for
// the PATCH /me/profile path); duplicated here for per-route grep
// discoverability (G2 matrix).
//
// Server derives identity from req.userId, so the contamination invariant is
// "user-B's session NEVER appears in user-A's response."

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userA: string;
let tokenA: string;
let userB: string;

beforeAll(async () => {
  app = await buildApp();
  const a = await mkUser({ prefix: 'vitest.w6-sess-cont-a' });
  userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w6-sess-cont-b' });
  userB = b.id;
  const m = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userA, label: 'A-bearer', scopes: ['health:weight:write'] },
  });
  tokenA = m.json<{ token: string }>().token;
});

afterAll(async () => {
  await db.query(`DELETE FROM account_events WHERE user_id IN ($1,$2)`, [userA, userB]);
  await cleanupUser(userA);
  await cleanupUser(userB);
  await app.close();
});

describe('GET /api/account/sessions contamination — G2', () => {
  it('user-A token cannot read user B sessions', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: {
        user_id: userB,
        label: 'B-shortcut',
        scopes: ['health:weight:write'],
      },
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(200);
    const sessions = r.json<{ sessions: { label: string | null }[] }>().sessions;
    expect(sessions.some((s) => s.label === 'B-shortcut')).toBe(false);
  });
});
