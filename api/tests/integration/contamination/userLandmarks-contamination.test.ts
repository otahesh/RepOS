/**
 * G2 contribution — cross-user contamination test for /api/users/me/landmarks.
 * Per master plan G2: every per-user route must assert it never returns
 * another user's data. The /me routes self-scope via (req as any).userId, so
 * the test asserts user A's PATCH does not bleed into user B's GET, plus the
 * full 401/400/200 matrix per [I-CONTAM-MATRIX-COMPLETE].
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userA: string;
let tokenA: string;
let userB: string;
let tokenB: string;

beforeAll(async () => {
  app = await buildApp();
  userA = (await mkUser({ prefix: 'vitest.w4-lm-cont-a' })).id;
  userB = (await mkUser({ prefix: 'vitest.w4-lm-cont-b' })).id;
  const ma = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['program:write'] },
  });
  tokenA = ma.json<{ token: string }>().token;
  const mb = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userB, label: 'b', scopes: ['program:write'] },
  });
  tokenB = mb.json<{ token: string }>().token;
});
afterAll(async () => {
  await cleanupUser(userA);
  await cleanupUser(userB);
  await app.close();
});

describe('userLandmarks contamination — G2 [I-CONTAM-MATRIX-COMPLETE]', () => {
  // 401 — missing bearer
  it('GET without bearer returns 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/users/me/landmarks' });
    expect([401, 403]).toContain(r.statusCode);
  });
  it('PATCH without bearer returns 401', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/users/me/landmarks',
      payload: { overrides: { chest: { mev: 12, mav: 16, mrv: 22 } } },
    });
    expect([401, 403]).toContain(r.statusCode);
  });

  // 400 — malformed body
  it('PATCH with malformed body returns 400', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { not_overrides: 'wat' },
    });
    expect(r.statusCode).toBe(400);
  });

  // 200 — self-access (PATCH returns 200 in this route, not 201)
  it('user A self-PATCH returns 200', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { overrides: { chest: { mev: 12, mav: 16, mrv: 24 } } },
    });
    expect(r.statusCode).toBe(200);
  });

  // Cross-user isolation
  it('user A PATCH does not change user B GET', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { overrides: { chest: { mev: 14, mav: 18, mrv: 26 } } },
    });
    const gb = await app.inject({
      method: 'GET',
      url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(gb.statusCode).toBe(200);
    expect(gb.json<{ landmarks: Record<string, { mev: number }> }>().landmarks.chest.mev).toBe(10);
  });
});
