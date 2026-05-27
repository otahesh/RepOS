import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — onboarding-complete', () => {
  it('POST /api/me/onboarding/complete sets onboarding_completed_at + goal', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    await db.query('UPDATE users SET onboarding_completed_at = NULL WHERE id = $1', [seed.userId]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/onboarding/complete',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ goal: 'bulk' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().onboarding_completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const { rows: [u] } = await db.query(
      'SELECT onboarding_completed_at, goal FROM users WHERE id = $1',
      [seed.userId],
    );
    expect(u.onboarding_completed_at).not.toBeNull();
    expect(u.goal).toBe('bulk');
  });

  it('rejects invalid goal with 400', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/onboarding/complete',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ goal: 'shred' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('idempotent: calling twice keeps the first onboarding_completed_at', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    await db.query('UPDATE users SET onboarding_completed_at = NULL WHERE id = $1', [seed.userId]);
    const headers = { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' };
    const r1 = await app.inject({ method: 'POST', url: '/api/me/onboarding/complete', headers, payload: JSON.stringify({ goal: 'maintain' }) });
    const r2 = await app.inject({ method: 'POST', url: '/api/me/onboarding/complete', headers, payload: JSON.stringify({ goal: 'cut' }) });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json().onboarding_completed_at).toBe(r2.json().onboarding_completed_at);
    // Goal MAY update on second call — that's a deliberate choice per the spec;
    // assert it does so the contract is recorded:
    const { rows: [u] } = await db.query('SELECT goal FROM users WHERE id = $1', [seed.userId]);
    expect(u.goal).toBe('cut');
  });
});
