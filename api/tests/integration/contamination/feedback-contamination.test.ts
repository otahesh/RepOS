import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { mkUser } from '../../helpers/program-fixtures.js';
import { db } from '../../../src/db/client.js';

// G2: POST /api/feedback is a per-user write — a client cannot attribute
// feedback to another user (identity is from the token, body is .strict()).
// GET /api/admin/feedback is admin-global — a regular bearer must NOT get a
// 200-with-data. Adds 2 routes to the G2 matrix.
describe('feedback contamination — G2', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userA: string;
  let tokenA: string;
  const savedAdminKey = process.env.ADMIN_API_KEY;

  beforeAll(async () => {
    // Mint the bearer FIRST, while the admin gate is still OPEN (ADMIN_API_KEY
    // unset → open-admin bypass in requireAdminKeyOrCfAccess; the gate reads the
    // env at request time). THEN set ADMIN_API_KEY so the "regular bearer can't
    // read the admin list" assertion gets a real 401/403 instead of the open
    // path. (Precedent: account-sessions-delete-contamination.test.ts mints
    // with ADMIN_API_KEY unset for exactly this reason.)
    delete process.env.ADMIN_API_KEY;
    app = await buildApp();
    const a = await mkUser({ prefix: 'vitest.w7-cont-a' });
    userA = a.id;
    const mint = await app.inject({
      method: 'POST', url: '/api/tokens',
      body: { user_id: userA, label: 'A', scopes: ['health:weight:write'] },
    });
    tokenA = mint.json<{ token: string }>().token;
    process.env.ADMIN_API_KEY = 'w7-cont-key'; // now close the gate for the admin-list assertion
  });

  afterAll(async () => {
    if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = savedAdminKey;
    await db.query(`DELETE FROM feedback WHERE user_id=$1`, [userA]);
    await db.query(`DELETE FROM device_tokens WHERE user_id=$1`, [userA]);
    await db.query(`DELETE FROM users WHERE id=$1`, [userA]);
    await app.close();
  });

  it('a body with a spoofed user_id is rejected (strict schema)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/feedback',
      headers: { authorization: `Bearer ${tokenA}`, 'x-repos-csrf': '1' },
      body: { body: 'hi', user_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('a valid submit is stamped with the token owner, not a body value', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/feedback',
      headers: { authorization: `Bearer ${tokenA}`, 'x-repos-csrf': '1' },
      body: { body: 'legit feedback' },
    });
    expect(r.statusCode).toBe(201);
    const { rows } = await db.query(`SELECT user_id FROM feedback WHERE id=$1`, [r.json<{ id: string }>().id]);
    expect(rows[0].user_id).toBe(userA);
  });

  it('a regular bearer cannot read the admin feedback list', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/admin/feedback',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect([401, 403]).toContain(r.statusCode); // never 200-with-data
  });
});
