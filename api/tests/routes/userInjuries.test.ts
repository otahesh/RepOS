// api/tests/routes/userInjuries.test.ts
//
// Beta W3.4 Task 5 — HTTP integration tests for GET /api/user/injuries.
//
// Validates two contracts:
//   1. New user with no injuries → 200 { injuries: [] }
//   2. After inserting a row directly, list returns that row (and only that row,
//      since cleanup wipes prior rows in beforeAll's user creation).
// The cross-user IDOR matrix lives in Task 9 (scope-enforcement + contamination
// suite), so this file stays minimal — happy-path correctness + envelope shape.

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const u = await mkUser({ prefix: 'vitest.w3-inj' });
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: {
      user_id: userId,
      label: 'w3-inj',
      scopes: ['health:injuries:read', 'health:injuries:write'],
    },
  });
  token = mint.json<{ token: string }>().token;
});

afterAll(async () => {
  await db.query('DELETE FROM user_injuries WHERE user_id=$1', [userId]);
  await cleanupUser(userId);
  await app.close();
});

describe('GET /api/user/injuries', () => {
  it('returns empty array for new user', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual({ injuries: [] });
  });

  it('returns user-owned rows only', async () => {
    await db.query(
      `INSERT INTO user_injuries (user_id, joint, severity, notes) VALUES ($1,$2,$3,$4)`,
      [userId, 'knee_left', 'mod', 'meniscus'],
    );
    const resp = await app.inject({
      method: 'GET',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ injuries: Array<{ joint: string }> }>();
    expect(body.injuries.map((r) => r.joint)).toEqual(['knee_left']);
  });
});

describe('POST /api/user/injuries', () => {
  it('creates a new row and returns 201 with the persisted shape', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        joint: 'shoulder_left',
        severity: 'high',
        notes: 'impingement',
        onset_at: '2025-11-03',
      },
    });
    expect(resp.statusCode).toBe(201);
    const body = resp.json<{ injury: { joint: string; severity: string } }>();
    expect(body.injury).toMatchObject({
      joint: 'shoulder_left',
      severity: 'high',
      notes: 'impingement',
    });
  });

  it('upserts on duplicate (user_id, joint) — 200 + updated row', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'shoulder_left', severity: 'low', notes: 'better now' },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json<{ injury: { severity: string; notes: string } }>();
    expect(body.injury).toMatchObject({ severity: 'low', notes: 'better now' });
  });

  it('rejects unknown joint with 400 field_error', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'ankle' },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json<{ field_error?: object }>().field_error).toBeDefined();
  });
});

describe('PATCH /api/user/injuries/:joint', () => {
  it('updates severity + notes; returns 200 with new shape', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'elbow' },
    });
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/user/injuries/elbow',
      headers: { authorization: `Bearer ${token}` },
      payload: { severity: 'high', notes: 'tendonitis' },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json<{ injury: { severity: string } }>().injury.severity).toBe('high');
  });

  it('404 when row does not exist', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/user/injuries/wrist',
      headers: { authorization: `Bearer ${token}` },
      payload: { severity: 'low' },
    });
    expect(resp.statusCode).toBe(404);
  });

  it('400 on unknown :joint path param', async () => {
    const resp = await app.inject({
      method: 'PATCH',
      url: '/api/user/injuries/ankle',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(resp.statusCode).toBe(400);
  });
});

describe('DELETE /api/user/injuries/:joint', () => {
  it('removes the row and returns 204', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/user/injuries',
      headers: { authorization: `Bearer ${token}` },
      payload: { joint: 'wrist' },
    });
    const resp = await app.inject({
      method: 'DELETE',
      url: '/api/user/injuries/wrist',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(204);
    const { rows } = await db.query(
      `SELECT 1 FROM user_injuries WHERE user_id=$1 AND joint='wrist'`,
      [userId],
    );
    expect(rows.length).toBe(0);
  });

  it('204 idempotent on missing row', async () => {
    const resp = await app.inject({
      method: 'DELETE',
      url: '/api/user/injuries/knee_right',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(204);
  });
});
