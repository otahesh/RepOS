/**
 * Contract tests for the health/weight route surface.
 *
 * Each test hits a real Fastify route via inject() and parses the response
 * through the canonical Zod schema from api/src/schemas/healthWeight.ts.
 * If the schema and the handler ever drift, these tests fail loudly.
 *
 * These tests do NOT re-test business logic (that lives in weight.test.ts).
 * They verify the *shape* of every response the API surface can emit.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  WeightSampleResponseSchema,
  WeightBackfillResponseSchema,
  WeightRangeResponseSchema,
  SyncStatusResponseSchema,
} from '../../src/schemas/healthWeight.js';

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();

  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.contract.weight.${Date.now()}@repos.test`],
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
// POST /api/health/weight — new insert → 201
// ---------------------------------------------------------------------------

describe('POST /api/health/weight contract', () => {
  const sample = {
    weight_lbs: 175.0,
    date: '2020-06-15', // well outside 90d window so no interference with other tests
    time: '08:00:00',
    source: 'Apple Health',
  };

  it('201 response parses through WeightSampleResponseSchema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/health/weight',
      headers: auth(),
      body: sample,
    });
    expect(res.statusCode).toBe(201);
    const parsed = WeightSampleResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deduped).toBe(false);
      expect(parsed.data.weight_lbs).toBe(175.0);
      expect(parsed.data.date).toBe('2020-06-15');
    }
  });

  it('200 deduped response parses through WeightSampleResponseSchema', async () => {
    // Re-post same sample — same weight so dedup fires, no update
    const res = await app.inject({
      method: 'POST',
      url: '/api/health/weight',
      headers: auth(),
      body: sample,
    });
    expect(res.statusCode).toBe(200);
    const parsed = WeightSampleResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deduped).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/health/weight/backfill
// ---------------------------------------------------------------------------

describe('POST /api/health/weight/backfill contract', () => {
  it('response parses through WeightBackfillResponseSchema', async () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({
      weight_lbs: +(160 + i * 0.1).toFixed(1),
      date: `2019-03-${String(i + 1).padStart(2, '0')}`,
      time: '09:00:00',
      source: 'Manual',
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/health/weight/backfill',
      headers: auth(),
      body: { samples },
    });
    expect(res.statusCode).toBe(200);
    const parsed = WeightBackfillResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.created + parsed.data.deduped).toBe(5);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/health/weight — with data
// ---------------------------------------------------------------------------

describe('GET /api/health/weight contract', () => {
  beforeAll(async () => {
    // Insert a recent sample so the response is non-empty and all fields are exercised
    await app.inject({
      method: 'POST',
      url: '/api/health/weight',
      headers: auth(),
      body: {
        weight_lbs: 172.0,
        date: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
        time: '07:00:00',
        source: 'Apple Health',
      },
    });
  });

  for (const range of ['7d', '30d', '90d', '1y', 'all'] as const) {
    it(`range=${range} response parses through WeightRangeResponseSchema`, async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/health/weight?range=${range}`,
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      const parsed = WeightRangeResponseSchema.safeParse(res.json());
      expect(
        parsed.success,
        `Schema parse failed for range=${range}: ${JSON.stringify(parsed.error?.issues)}`,
      ).toBe(true);
    });
  }

  it('empty range response still parses through WeightRangeResponseSchema', async () => {
    // Use 7d with a user that has no data in range — stats will have nulls
    // We already have data from 2 days ago so 7d will have data. Use a past
    // range that has no data to exercise the null stats path.
    // The 2020/2019 data is outside 7d, so just use a fresh user.
    const { rows: [u2] } = await db.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.contract.weight.empty.${Date.now()}@repos.test`],
    );
    const m = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: u2.id, label: 'empty-test' },
    });
    const t2 = m.json<{ token: string }>().token;

    const res = await app.inject({
      method: 'GET',
      url: '/api/health/weight?range=90d',
      headers: { authorization: `Bearer ${t2}` },
    });
    expect(res.statusCode).toBe(200);
    const parsed = WeightRangeResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.samples).toEqual([]);
      expect(parsed.data.current).toBeNull();
      expect(parsed.data.stats.trend_7d_lbs).toBeNull();
      expect(parsed.data.stats.adherence_pct).toBeNull();
      expect(parsed.data.sync).toBeNull();
    }

    await db.query('DELETE FROM users WHERE id = $1', [u2.id]);
  });

  it('default range (omitted) response parses through WeightRangeResponseSchema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health/weight',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = WeightRangeResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/health/sync/status
// ---------------------------------------------------------------------------

describe('GET /api/health/sync/status contract', () => {
  it('no-sync-record response parses through SyncStatusResponseSchema', async () => {
    // Create a fresh user with no sync record
    const { rows: [u3] } = await db.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`vitest.contract.sync.${Date.now()}@repos.test`],
    );
    const m = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: u3.id, label: 'sync-test' },
    });
    const t3 = m.json<{ token: string }>().token;

    const res = await app.inject({
      method: 'GET',
      url: '/api/health/sync/status',
      headers: { authorization: `Bearer ${t3}` },
    });
    expect(res.statusCode).toBe(200);
    const parsed = SyncStatusResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      // No record → fallback shape from sync route
      expect(parsed.data.state).toBe('broken');
    }

    await db.query('DELETE FROM users WHERE id = $1', [u3.id]);
  });

  it('fresh sync record response parses through SyncStatusResponseSchema', async () => {
    // Seed a recent sync for our main test user
    await db.query(
      `INSERT INTO health_sync_status (user_id, source, last_fired_at, last_success_at, consecutive_failures)
       VALUES ($1, 'Apple Health', now(), now(), 0)
       ON CONFLICT (user_id) DO UPDATE
         SET last_success_at = now(), last_fired_at = now(), consecutive_failures = 0`,
      [userId],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/health/sync/status',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = SyncStatusResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.state).toBe('fresh');
      expect(typeof parsed.data.last_success_at).toBe('string');
    }
  });

  it('stale sync record response parses through SyncStatusResponseSchema', async () => {
    await db.query(
      `INSERT INTO health_sync_status (user_id, source, last_fired_at, last_success_at, consecutive_failures)
       VALUES ($1, 'Apple Health', now() - interval '48 hours', now() - interval '48 hours', 0)
       ON CONFLICT (user_id) DO UPDATE
         SET last_success_at = now() - interval '48 hours',
             last_fired_at = now() - interval '48 hours',
             consecutive_failures = 0`,
      [userId],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/health/sync/status',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = SyncStatusResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.state).toBe('stale');
    }
  });

  it('broken sync record (>72h) response parses through SyncStatusResponseSchema', async () => {
    await db.query(
      `INSERT INTO health_sync_status (user_id, source, last_fired_at, last_success_at, consecutive_failures)
       VALUES ($1, 'Apple Health', now() - interval '73 hours', now() - interval '73 hours', 0)
       ON CONFLICT (user_id) DO UPDATE
         SET last_success_at = now() - interval '73 hours',
             last_fired_at = now() - interval '73 hours',
             consecutive_failures = 0`,
      [userId],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/health/sync/status',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const parsed = SyncStatusResponseSchema.safeParse(res.json());
    expect(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.state).toBe('broken');
    }
  });
});
