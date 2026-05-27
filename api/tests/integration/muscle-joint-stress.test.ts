import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string;

beforeAll(async () => {
  app = await buildApp();
  userId = (await mkUser({ prefix: 'vitest.w4-jstress' })).id;
  const t = await app.inject({ method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 'a', scopes: ['program:write'] } });
  token = t.json<{ token: string }>().token;
});
afterAll(async () => { await cleanupUser(userId); await app.close(); });

describe('GET /api/muscles/joint-stress', () => {
  it('returns JOINT_ROOT + MUSCLE_JOINT_ROOTS', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/muscles/joint-stress',
      headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ JOINT_ROOT: Record<string, string>; MUSCLE_JOINT_ROOTS: Record<string, string[]> }>();
    expect(body.JOINT_ROOT.shoulder_left).toBe('shoulder');
    expect(body.JOINT_ROOT.knee_left).toBe('knee');
    expect(body.MUSCLE_JOINT_ROOTS.chest).toEqual(expect.arrayContaining(['shoulder', 'elbow']));
    expect(body.MUSCLE_JOINT_ROOTS.quads).toEqual(expect.arrayContaining(['knee']));
  });
});
