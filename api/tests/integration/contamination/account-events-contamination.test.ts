// api/tests/integration/contamination/account-events-contamination.test.ts
//
// G2 contribution — GET /api/account/events with user-A bearer must never
// return user-B's account_events rows. Extracted from Task 7's
// account-profile-contamination.test.ts; duplicated here for per-route grep
// discoverability (G2 matrix).
//
// Server derives identity from req.userId; listAccountEvents() WHERE
// user_id=$1 enforces isolation. This test inserts a sentinel event for B
// (with a distinctive IP) and verifies it does not surface in A's GET.

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
  const a = await mkUser({ prefix: 'vitest.w6-evt-cont-a' });
  userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w6-evt-cont-b' });
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

describe('GET /api/account/events contamination — G2', () => {
  it('user-A token cannot read user B account_events', async () => {
    await db.query(
      `INSERT INTO account_events (user_id, kind, ip, meta) VALUES ($1,'profile_changed','9.9.9.9','{}'::jsonb)`,
      [userB],
    );
    const r = await app.inject({
      method: 'GET',
      url: '/api/account/events',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(200);
    const events = r.json<{ events: { ip: string | null }[] }>().events;
    expect(events.some((e) => e.ip === '9.9.9.9')).toBe(false);
  });
});
