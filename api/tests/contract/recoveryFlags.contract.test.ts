/**
 * Contract tests for the /api/recovery-flags route surface.
 *
 * Tests hit real route handlers via Fastify inject() and parse responses
 * through the canonical Zod schemas in api/src/schemas/recoveryFlags.ts.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  RecoveryFlagListResponseSchema,
} from '../../src/schemas/recoveryFlags.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.contract.recovery.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'contract-test' },
  });
  token = mint.json<{ token: string }>().token;
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// GET /api/recovery-flags
// ---------------------------------------------------------------------------

describe('GET /api/recovery-flags contract', () => {
  it('empty flags response parses through RecoveryFlagListResponseSchema', async () => {
    // Fresh user with no weight data — bodyweight_crash won't fire
    const res = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = RecoveryFlagListResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(Array.isArray(parsed.data.flags)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/recovery-flags/dismiss
// ---------------------------------------------------------------------------

describe('POST /api/recovery-flags/dismiss contract', () => {
  it('204 on valid dismiss request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recovery-flags/dismiss',
      headers: auth(),
      body: { flag: 'bodyweight_crash' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('400 on unknown flag key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recovery-flags/dismiss',
      headers: auth(),
      body: { flag: 'unknown_flag' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; field: string }>();
    expect(typeof body.error).toBe('string');
    expect(typeof body.field).toBe('string');
  });
});
