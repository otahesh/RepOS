/**
 * G2 contribution — minimal cross-user contamination test for
 * GET /api/muscles/joint-stress. The data is a read-only catalog (identical
 * for every user), but the route still gates on bearer + must reject
 * unauthenticated requests. [C-JOINT-ROOT-ENDPOINT]
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { mkUser, cleanupUser } from '../../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userA: string; let tokenA: string;
let userB: string; let tokenB: string;

beforeAll(async () => {
  app = await buildApp();
  userA = (await mkUser({ prefix: 'vitest.w4-js-cont-a' })).id;
  userB = (await mkUser({ prefix: 'vitest.w4-js-cont-b' })).id;
  const ma = await app.inject({ method: 'POST', url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['program:write'] } });
  tokenA = ma.json<{ token: string }>().token;
  const mb = await app.inject({ method: 'POST', url: '/api/tokens',
    body: { user_id: userB, label: 'b', scopes: ['program:write'] } });
  tokenB = mb.json<{ token: string }>().token;
});
afterAll(async () => { await cleanupUser(userA); await cleanupUser(userB); await app.close(); });

describe('GET /api/muscles/joint-stress contamination — G2', () => {
  it('rejects missing bearer with 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/muscles/joint-stress' });
    expect([401, 403]).toContain(r.statusCode);
  });
  it('user A and user B see identical catalog (read-only)', async () => {
    const ra = await app.inject({ method: 'GET', url: '/api/muscles/joint-stress',
      headers: { authorization: `Bearer ${tokenA}` } });
    const rb = await app.inject({ method: 'GET', url: '/api/muscles/joint-stress',
      headers: { authorization: `Bearer ${tokenB}` } });
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    expect(ra.json()).toEqual(rb.json());
  });
});
