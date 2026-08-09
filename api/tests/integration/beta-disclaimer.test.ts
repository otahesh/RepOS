import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: SeedHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupSeeded(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

// G14 — first-run Beta disclaimer. Every cohort member must see (and ack)
// a first-run notice that RepOS is Beta software and not medical advice.
describe('G14 — beta disclaimer ack', () => {
  it('POST /api/me/beta-disclaimer-ack stamps beta_disclaimer_ack_at', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/beta-disclaimer-ack',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().beta_disclaimer_ack_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const {
      rows: [u],
    } = await db.query('SELECT beta_disclaimer_ack_at FROM users WHERE id = $1', [seed.userId]);
    expect(u.beta_disclaimer_ack_at).not.toBeNull();
  });

  it('is idempotent — a second ack keeps the first timestamp', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const headers = { authorization: `Bearer ${seed.bearer}` };
    const r1 = await app.inject({ method: 'POST', url: '/api/me/beta-disclaimer-ack', headers });
    const first = r1.json().beta_disclaimer_ack_at;
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await app.inject({ method: 'POST', url: '/api/me/beta-disclaimer-ack', headers });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().beta_disclaimer_ack_at).toBe(first);
  });

  it('unauthenticated ack is rejected', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/me/beta-disclaimer-ack' });
    expect([401, 503]).toContain(res.statusCode);
  });
});
