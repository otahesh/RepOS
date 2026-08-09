// Q25 — the bearer path enforces users.status. Suspension must not be
// enforceable on only one of the two authentication paths.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.bearer-status' });
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 't', scopes: ['health:weight:write'] },
  });
  token = mint.json<{ token: string }>().token;
});

afterAll(async () => {
  await cleanupUser(userId);
  await app.close();
});

async function probe(): Promise<number> {
  const r = await app.inject({
    method: 'GET',
    url: '/api/account/sessions',
    headers: { authorization: `Bearer ${token}` },
  });
  return r.statusCode;
}

async function setStatus(status: string): Promise<void> {
  await db.query(`UPDATE users SET status=$2 WHERE id=$1`, [userId, status]);
}

describe('requireAuth status enforcement (Q25)', () => {
  it('allows an active user', async () => {
    await setStatus('active');
    expect(await probe()).toBe(200);
  });

  it('401s a suspended user on the VERY NEXT request', async () => {
    await setStatus('suspended');
    expect(await probe()).toBe(401);
  });

  it('401s a deleting user', async () => {
    await setStatus('deleting');
    expect(await probe()).toBe(401);
  });

  it('401s an invited-but-unactivated user', async () => {
    await setStatus('invited');
    expect(await probe()).toBe(401);
  });

  it('restores access on reinstatement — asserted through the bearer path', async () => {
    await setStatus('active');
    expect(await probe()).toBe(200);
  });

  it('does not stamp last_used_at for a rejected request', async () => {
    // The status check sits before the last_used_at UPDATE. Without this the
    // ordering is only a comment: a suspended user's token would keep showing
    // fresh activity on the sessions surface every time their Shortcut retried,
    // which is exactly the signal an admin would use to judge whether a
    // suspension took effect.
    await setStatus('active');
    expect(await probe()).toBe(200);
    const { rows: before } = await db.query<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM device_tokens WHERE user_id=$1`,
      [userId],
    );
    await setStatus('suspended');
    expect(await probe()).toBe(401);
    const { rows: after } = await db.query<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM device_tokens WHERE user_id=$1`,
      [userId],
    );
    expect(after[0].last_used_at).toEqual(before[0].last_used_at);
  });

  it('still 401s a garbage token (no status leak on the miss path)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: { authorization: 'Bearer deadbeefdeadbeef.' + 'f'.repeat(64) },
    });
    expect(r.statusCode).toBe(401);
  });
});

// The cases above probe a READ route. Q25's actual concern is the iOS Shortcut,
// which WRITES. `POST /api/health/weight` runs the same requireAuth via
// requireBearerOrCfAccess, so the gate covers it by construction — but "by
// construction" is exactly what stops holding when a route is later registered
// with a different auth preHandler. Assert the ingest path directly: a
// suspended user's Shortcut must not be able to write, and the pairing with the
// active case proves the 401 comes from the status gate rather than from a
// missing scope or a malformed body.
describe('the iOS Shortcut ingest path (the Q25 attack path)', () => {
  async function ingest(): Promise<number> {
    const r = await app.inject({
      method: 'POST',
      url: '/api/health/weight',
      headers: { authorization: `Bearer ${token}` },
      body: { weight_lbs: 185.5, date: '2026-03-14', time: '07:30:00', source: 'Apple Health' },
    });
    return r.statusCode;
  }

  it('accepts the write while the user is active', async () => {
    await setStatus('active');
    expect(await ingest()).toBe(201);
  });

  it('401s the write once the user is suspended', async () => {
    await setStatus('suspended');
    expect(await ingest()).toBe(401);
  });
});
