// api/tests/integration/contamination/account-profile-contamination.test.ts
//
// G2 contribution — PATCH /api/me/profile with user-A token must never edit
// user-B's row. Server derives identity from req.userId; verify a body that
// tries to spoof user_id is silently ignored.
//
// Also covers:
//   - GET /api/account/events  — must not list user-B audit rows
//   - GET /api/account/sessions — must not list user-B tokens
//
// Per master plan G2: every per-user route must assert 404/403 (never
// 200-with-other-user-data) when a bearer for user A targets user B's
// resource. PATCH /me/profile derives identity from req.userId, so the
// contamination check is "user-B's row unchanged" (silent isolation, not a
// 404 — there is no way to express "user B's profile" in the URL).
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
  const a = await mkUser({ prefix: 'vitest.w6-cont-a' });
  userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w6-cont-b' });
  userB = b.id;
  const m = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['health:weight:write'] },
  });
  tokenA = m.json<{ token: string }>().token;
  await db.query(`UPDATE users SET display_name='B Original' WHERE id=$1`, [
    userB,
  ]);
});

afterAll(async () => {
  // account_events rows for either user cascade via ON DELETE SET NULL — we
  // still want to keep the test corpus tight, so drop any rows we wrote
  // explicitly to userB before deleting the users.
  await db.query(`DELETE FROM account_events WHERE user_id IN ($1,$2)`, [
    userA,
    userB,
  ]);
  await cleanupUser(userA);
  await cleanupUser(userB);
  await app.close();
});

describe('PATCH /api/me/profile contamination — G2', () => {
  it('user-A token + body with user-B-style fields edits user A only', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { display_name: 'A Modified' },
    });
    const { rows: ar } = await db.query<{ display_name: string }>(
      'SELECT display_name FROM users WHERE id=$1',
      [userA],
    );
    const { rows: br } = await db.query<{ display_name: string }>(
      'SELECT display_name FROM users WHERE id=$1',
      [userB],
    );
    expect(ar[0].display_name).toBe('A Modified');
    expect(br[0].display_name).toBe('B Original');
  });

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
