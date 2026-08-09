/**
 * Bearer verified-token cache (G9 finding, 2026-07-10).
 *
 * argon2.verify costs ~50–100ms of CPU per call; running it on EVERY bearer
 * request caps the whole API at ~16 req/s on the 2-CPU prod box. The cache
 * skips ONLY the redundant re-verify for a token that already passed argon2;
 * the per-request DB prefix lookup (which enforces `revoked_at IS NULL`)
 * still runs, so revocation takes effect on the very next request.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return {
    default: {
      ...actual.default,
      hash: actual.default.hash,
      verify: vi.fn(actual.default.verify),
    },
  };
});

import argon2 from 'argon2';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;

const verifyMock = argon2.verify as ReturnType<typeof vi.fn>;

async function mintToken(label: string): Promise<{ id: string; token: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

function get(token: string) {
  return app.inject({
    method: 'GET',
    url: '/api/health/weight?range=7d',
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeAll(async () => {
  app = await buildApp();
  const {
    rows: [u],
  } = await db.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [
    `vitest.bearer-cache.${Date.now()}@repos.test`,
  ]);
  userId = u.id;
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

describe('bearer verified-token cache', () => {
  it('verifies with argon2 once, then serves repeat requests from the cache', async () => {
    const { token } = await mintToken('cache-hit');
    verifyMock.mockClear();

    expect((await get(token)).statusCode).toBe(200);
    const callsAfterFirst = verifyMock.mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    expect((await get(token)).statusCode).toBe(200);
    expect((await get(token)).statusCode).toBe(200);
    expect(verifyMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('revocation 401s on the very next request even when the token is cached', async () => {
    const { id, token } = await mintToken('cache-revoke');
    expect((await get(token)).statusCode).toBe(200); // populate cache
    await db.query(`UPDATE device_tokens SET revoked_at = now() WHERE id = $1`, [id]);
    expect((await get(token)).statusCode).toBe(401);
  });

  it('debounces last_used_at touches to one write per window', async () => {
    const { id, token } = await mintToken('cache-touch-debounce');
    expect((await get(token)).statusCode).toBe(200);
    const {
      rows: [a],
    } = await db.query(`SELECT last_used_at FROM device_tokens WHERE id = $1`, [id]);
    // Age the timestamp inside the debounce window; a per-request write
    // (the pre-fix behavior) would overwrite it on the next request.
    await db.query(
      `UPDATE device_tokens SET last_used_at = now() - interval '5 seconds' WHERE id = $1`,
      [id],
    );
    expect((await get(token)).statusCode).toBe(200);
    const {
      rows: [b],
    } = await db.query(`SELECT last_used_at FROM device_tokens WHERE id = $1`, [id]);
    expect(new Date(b.last_used_at).getTime()).toBeLessThan(new Date(a.last_used_at).getTime());
  });

  it('rejects a LIKE-wildcard prefix without matching any token', async () => {
    const { token } = await mintToken('cache-wildcard');
    expect((await get(token)).statusCode).toBe(200);
    const [, secret] = token.split('.');
    // `%` would match every stored `<prefix>:<hash>` composite if it reached
    // the LIKE pattern un-validated.
    expect((await get(`%.${secret}`)).statusCode).toBe(401);
    expect((await get(`________________.${secret}`)).statusCode).toBe(401);
  });

  it('same prefix with a wrong secret is never served from the cache', async () => {
    const { token } = await mintToken('cache-wrong-secret');
    expect((await get(token)).statusCode).toBe(200); // populate cache
    const [prefix] = token.split('.');
    const forged = `${prefix}.${'0'.repeat(64)}`;
    expect((await get(forged)).statusCode).toBe(401);
  });
});
