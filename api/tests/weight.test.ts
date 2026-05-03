import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;

// Dates in the past, outside the 90d lookback window (today is ~2026-05-02)
// so test 11's range=90d query returns an empty samples array
const D1 = '2025-01-01'; // tests 1–3: dedup sequence
const D10 = '2025-01-10'; // test 10: rate limit seed

const base = { weight_lbs: 185.4, date: D1, time: '07:32:00', source: 'Apple Health' };

let app: App;
let userId: string;
let token: string;
let revokedToken: string;

beforeAll(async () => {
  app = await buildApp();

  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.weight.${Date.now()}@repos.test`],
  );
  userId = u.id;

  // Active token
  const mint = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 'vitest' },
  });
  token = mint.json<{ token: string }>().token;

  // Revoked token for test 9
  const r = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 'revoke-me' },
  });
  const { id: rid, token: plain } = r.json<{ id: string; token: string }>();
  revokedToken = plain;
  await app.inject({ method: 'DELETE', url: `/api/tokens/${rid}` });
}, 30_000);

afterAll(async () => {
  if (userId) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await db.end();
});

// Helpers
const post = (body: object, auth = `Bearer ${token}`) =>
  app.inject({ method: 'POST', url: '/api/health/weight', headers: { authorization: auth }, body });

describe('POST /api/health/weight', () => {
  it('1. valid sample → 201, row created', async () => {
    const res = await post(base);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.deduped).toBe(false);
    expect(body.date).toBe(D1);
    expect(body.weight_lbs).toBe(185.4);
    expect(body.id).toBeDefined(); // BIGINT serialized as string by pg
  });

  it('2. same (user,date,source) same weight → 200, deduped:true, updated_at unchanged', async () => {
    const { rows: [before] } = await db.query<{ updated_at: Date }>(
      `SELECT updated_at FROM health_weight_samples WHERE user_id=$1 AND sample_date=$2 AND source=$3`,
      [userId, D1, 'Apple Health'],
    );

    const res = await post(base);
    expect(res.statusCode).toBe(200);
    expect(res.json().deduped).toBe(true);

    const { rows: [after] } = await db.query<{ updated_at: Date }>(
      `SELECT updated_at FROM health_weight_samples WHERE user_id=$1 AND sample_date=$2 AND source=$3`,
      [userId, D1, 'Apple Health'],
    );
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
  });

  it('3. same (user,date,source) different weight → 200, deduped:true, weight updated, updated_at bumped', async () => {
    const { rows: [before] } = await db.query<{ updated_at: Date }>(
      `SELECT updated_at FROM health_weight_samples WHERE user_id=$1 AND sample_date=$2 AND source=$3`,
      [userId, D1, 'Apple Health'],
    );

    const res = await post({ ...base, weight_lbs: 186.0 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deduped).toBe(true);
    expect(body.weight_lbs).toBe(186.0);

    const { rows: [row] } = await db.query<{ w: number; updated_at: Date }>(
      `SELECT weight_lbs::float AS w, updated_at FROM health_weight_samples WHERE user_id=$1 AND sample_date=$2 AND source=$3`,
      [userId, D1, 'Apple Health'],
    );
    expect(row.w).toBe(186.0);
    expect(row.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  it('4. weight_lbs=49.9 → 400, field=weight_lbs', async () => {
    const res = await post({ ...base, weight_lbs: 49.9 });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('weight_lbs');
  });

  it('5. weight_lbs=600.1 → 400, field=weight_lbs', async () => {
    const res = await post({ ...base, weight_lbs: 600.1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('weight_lbs');
  });

  it('6. source="Fitbit" → 400, field=source', async () => {
    const res = await post({ ...base, source: 'Fitbit' });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('source');
  });

  it('7. date="04/26/2026" → 400, field=date', async () => {
    const res = await post({ ...base, date: '04/26/2026' });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('date');
  });

  it('8. no bearer token → 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/health/weight', body: base,
    });
    expect(res.statusCode).toBe(401);
  });

  it('9. revoked bearer → 401', async () => {
    const res = await post(base, `Bearer ${revokedToken}`);
    expect(res.statusCode).toBe(401);
  });

  it('10. 6th POST for same (user,date) in 24h → 409', async () => {
    // Seed the write log with 5 existing writes so the next one tips over
    await db.query(
      `INSERT INTO weight_write_log (user_id, log_date, write_count)
       VALUES ($1, $2, 5)
       ON CONFLICT (user_id, log_date) DO UPDATE SET write_count = 5`,
      [userId, D10],
    );
    const res = await post({ ...base, date: D10 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('rate_limited');
  });
});

describe('GET /api/health/weight', () => {
  it('11. no data in 90d range → 200, samples:[], stats with nulls', async () => {
    // All test data is in 2099/2098 — outside the 90d lookback from today
    const res = await app.inject({
      method: 'GET',
      url: '/api/health/weight?range=90d',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.samples).toEqual([]);
    expect(body.stats.trend_7d_lbs).toBeNull();
    expect(body.stats.trend_30d_lbs).toBeNull();
    expect(body.stats.trend_90d_lbs).toBeNull();
    expect(body.stats.adherence_pct).toBeNull();
  });
});

describe('GET /api/health/sync/status', () => {
  it('12. last_success_at > 72h ago → state:"broken"', async () => {
    await db.query(
      `INSERT INTO health_sync_status (user_id, source, last_fired_at, last_success_at, consecutive_failures)
       VALUES ($1, 'Apple Health', now() - interval '73 hours', now() - interval '73 hours', 0)
       ON CONFLICT (user_id) DO UPDATE
         SET last_success_at    = now() - interval '73 hours',
             last_fired_at      = now() - interval '73 hours',
             consecutive_failures = 0`,
      [userId],
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/health/sync/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('broken');
  });
});

describe('POST /api/health/weight/backfill', () => {
  it('13. 30-day backfill, 5 already exist with same weight → {created:25, deduped:5}', async () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      weight_lbs: +(180 + i * 0.1).toFixed(1),
      date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      time: '07:00:00',
      source: 'Apple Health',
    }));

    // Pre-insert first 5 with identical weights (diff = 0 → will be deduped)
    for (const s of samples.slice(0, 5)) {
      await post(s);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/health/weight/backfill',
      headers: { authorization: `Bearer ${token}` },
      body: { samples },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(25);
    expect(body.deduped).toBe(5);
  });
});
