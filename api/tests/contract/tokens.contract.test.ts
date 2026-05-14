/**
 * Contract tests for the /api/tokens route surface.
 *
 * Tests hit real route handlers via Fastify inject() and parse responses
 * through the canonical Zod schemas in api/src/schemas/tokens.ts.
 * Shape drift between handler and schema causes a loud failure here.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  TokenMintResponseSchema,
  TokenListResponseSchema,
} from '../../src/schemas/tokens.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let mintedTokenId: string;

beforeAll(async () => {
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.contract.tokens.${Date.now()}@repos.test`],
  );
  userId = u.id;
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

// ---------------------------------------------------------------------------
// POST /api/tokens — mint
// ---------------------------------------------------------------------------

describe('POST /api/tokens contract', () => {
  it('201 response parses through TokenMintResponseSchema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: userId, label: 'contract-test-token' },
    });
    expect(res.statusCode).toBe(201);
    const parsed = TokenMintResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(typeof parsed.data.token).toBe('string');
      // Token must be in "<prefix>.<secret>" format
      expect(parsed.data.token).toMatch(/^[0-9a-f]{16}\.[0-9a-f]{64}$/);
      mintedTokenId = parsed.data.id;
    }
  });

  it('400 on missing user_id (admin mode)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { label: 'no-user' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('201 on scopes: ["health:workouts:write"] and persists to device_tokens.scopes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: {
        user_id: userId,
        label: 'contract-test-workouts-scope',
        scopes: ['health:workouts:write'],
      },
    });
    expect(res.statusCode).toBe(201);
    const parsed = TokenMintResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      const { rows } = await db.query(
        `SELECT scopes FROM device_tokens WHERE id = $1`,
        [parsed.data.id],
      );
      expect(rows[0].scopes).toEqual(['health:workouts:write']);
    }
  });

  it('400 on unknown scope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: {
        user_id: userId,
        label: 'contract-test-bad-scope',
        scopes: ['admin:everything'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_scope' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/tokens — list
// ---------------------------------------------------------------------------

describe('GET /api/tokens contract', () => {
  it('200 response parses through TokenListResponseSchema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tokens?user_id=${userId}`,
    });
    expect(res.statusCode).toBe(200);
    const parsed = TokenListResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(Array.isArray(parsed.data)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tokens/:id — revoke (204 no body)
// ---------------------------------------------------------------------------

describe('DELETE /api/tokens/:id contract', () => {
  it('204 on valid revoke', async () => {
    if (!mintedTokenId) return; // Skip if mint test didn't run
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${mintedTokenId}?user_id=${userId}`,
    });
    expect(res.statusCode).toBe(204);
  });

  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/99999999?user_id=${userId}`,
    });
    expect(res.statusCode).toBe(404);
  });
});
