/**
 * G2 contribution — cross-user contamination test for /api/user/injuries.
 * Per master plan G2: every per-user route must assert 404/403 (never
 * 200-with-other-user-data) when a bearer for user A targets user B's resource.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userA: string;
let tokenA: string;
let userB: string;
let tokenB: string;

beforeAll(async () => {
  app = await buildApp();
  const a = await mkUser({ prefix: 'vitest.w3-cont-a' });
  userA = a.id;
  const b = await mkUser({ prefix: 'vitest.w3-cont-b' });
  userB = b.id;
  const ma = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['health:injuries:read', 'health:injuries:write'] },
  });
  tokenA = ma.json<{ token: string }>().token;
  const mb = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userB, label: 'b', scopes: ['health:injuries:read', 'health:injuries:write'] },
  });
  tokenB = mb.json<{ token: string }>().token;

  await db.query(
    `INSERT INTO user_injuries (user_id, joint, severity) VALUES ($1,'shoulder_left','mod')`,
    [userB],
  );
});

afterAll(async () => {
  await db.query('DELETE FROM user_injuries WHERE user_id IN ($1,$2)', [userA, userB]);
  await cleanupUser(userA);
  await cleanupUser(userB);
  await app.close();
});

describe('userInjuries contamination — G2', () => {
  it('GET only returns user A rows, never user B rows', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ injuries: unknown[] }>().injuries).toEqual([]);
  });

  it('PATCH user B row from user A token returns 404 (no oracle)', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/user/injuries/shoulder_left',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { severity: 'high' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('DELETE user B row from user A token is silent-204 (idempotent, no row exposed)', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: '/api/user/injuries/shoulder_left',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(204);
    // Verify B's row is still there
    const { rows } = await db.query(
      `SELECT 1 FROM user_injuries WHERE user_id=$1 AND joint='shoulder_left'`,
      [userB],
    );
    expect(rows.length).toBe(1);
  });

  it('POST same joint from user A does not collide with user B row', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { joint: 'shoulder_left', severity: 'low' },
    });
    expect(r.statusCode).toBe(201);
    const { rows } = await db.query(
      `SELECT user_id, severity FROM user_injuries WHERE joint='shoulder_left' ORDER BY user_id`,
    );
    expect(rows.length).toBe(2);
  });
});
