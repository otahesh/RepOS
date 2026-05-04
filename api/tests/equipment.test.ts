import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string;

beforeAll(async () => {
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.eq.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const mint = await app.inject({
    method: 'POST', url: '/api/tokens', body: { user_id: userId, label: 'eq-test' }
  });
  token = mint.json<{ token: string }>().token;
});
afterAll(async () => {
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  await app.close(); await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('equipment profile (spec §9.2)', () => {
  it('7. PUT with unknown key → 400', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/equipment/profile',
      headers: auth(), body: { _v: 1, unobtanium: true },
    });
    expect(r.statusCode).toBe(400);
  });

  it('8. PUT with max_lb < min_lb → 400', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/equipment/profile',
      headers: auth(),
      body: { _v: 1, dumbbells: { min_lb: 100, max_lb: 50, increment_lb: 10 } },
    });
    expect(r.statusCode).toBe(400);
  });

  it('9. valid PUT then GET round-trips exactly', async () => {
    const profile = {
      _v: 1, dumbbells: { min_lb: 10, max_lb: 100, increment_lb: 10 },
      adjustable_bench: { incline: true, decline: true },
    };
    const put = await app.inject({
      method: 'PUT', url: '/api/equipment/profile', headers: auth(), body: profile,
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({
      method: 'GET', url: '/api/equipment/profile', headers: auth(),
    });
    expect(get.json()).toEqual(profile);
  });

  it('11. v1-shaped profile reads cleanly under simulated v2 expansion', async () => {
    // Manually inject a profile with an extra unknown key and ensure GET still reads.
    // We bypass PUT validation via direct DB write.
    await db.query(
      `UPDATE users SET equipment_profile=$1::jsonb WHERE id=$2`,
      [JSON.stringify({ _v: 1, dumbbells: { min_lb: 10, max_lb: 100, increment_lb: 10 }, kettlebells: { min_lb: 25, max_lb: 50, increment_lb: 5 } }), userId],
    );
    const r = await app.inject({ method: 'GET', url: '/api/equipment/profile', headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json<any>().kettlebells).toBeDefined();
  });
});
