import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string;

beforeAll(async () => {
  app = await buildApp();
  userId = (await mkUser({ prefix: 'vitest.lm-rt' })).id;
  const t = await app.inject({
    method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 'a', scopes: ['program:write'] },
  });
  token = t.json<{ token: string }>().token;
});
afterAll(async () => { await cleanupUser(userId); await app.close(); });

describe('/api/users/me/landmarks', () => {
  it('GET returns merged defaults+overrides AND par_q_advisory_active AND injury_constraints', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ landmarks: Record<string, { mev: number }>; par_q_advisory_active: boolean; injury_constraints: Record<string, unknown> }>();
    expect(body.landmarks.chest.mev).toBe(10); // default
    expect(typeof body.par_q_advisory_active).toBe('boolean');
    expect(typeof body.injury_constraints).toBe('object');
  });

  it('PATCH rejects MEV>=MAV with per-row error message [C-LANDMARKS-CLINICAL-FLOORS]', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` },
      payload: { overrides: { chest: { mev: 20, mav: 15, mrv: 10 } } }, // inverted
    });
    expect(r.statusCode).toBe(400);
    const body = r.json<{ fieldErrors: Record<string, string> }>();
    expect(body.fieldErrors.chest).toMatch(/MAV - MEV must be >= 2|MEV below clinical floor|MRV/);
  });

  it('PATCH rejects MEV below clinical floor [C-LANDMARKS-CLINICAL-FLOORS]', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` },
      payload: { overrides: { chest: { mev: 1, mav: 4, mrv: 8 } } }, // below 50% of seed
    });
    expect(r.statusCode).toBe(400);
    expect(r.json<{ fieldErrors: Record<string, string> }>().fieldErrors.chest).toMatch(/MEV below clinical floor/);
  });

  it('PATCH surfaces per-row errors for multiple bad rows [C-LANDMARKS-CLINICAL-FLOORS]', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` },
      payload: { overrides: { chest: { mev: 1, mav: 4, mrv: 8 }, quads: { mev: 100, mav: 110, mrv: 120 } } },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json<{ fieldErrors: Record<string, string> }>();
    expect(body.fieldErrors.chest).toBeDefined();
    expect(body.fieldErrors.quads).toBeDefined();
  });

  it('PATCH persists a valid override and GET reflects it', async () => {
    const r = await app.inject({
      method: 'PATCH', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` },
      payload: { overrides: { chest: { mev: 12, mav: 16, mrv: 24 } } },
    });
    expect(r.statusCode).toBe(200);
    const g = await app.inject({ method: 'GET', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` } });
    expect(g.json<{ landmarks: Record<string, { mev: number; mrv: number }> }>().landmarks.chest)
      .toEqual({ mev: 12, mav: 16, mrv: 24 });
  });
});
