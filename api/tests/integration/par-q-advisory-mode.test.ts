// api/tests/integration/par-q-advisory-mode.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { PAR_Q_VERSION, PAR_Q_QUESTIONS } from '../../src/constants/parQ.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — PAR-Q advisory mode flag', () => {
  it('any_yes=true → users.par_q_advisory_active=true; response advisory_active=true', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[0] = true;
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });
    expect(res.json().advisory_active).toBe(true);
    const { rows: [u] } = await db.query(
      `SELECT par_q_advisory_active FROM users WHERE id=$1`,
      [seed.userId],
    );
    expect(u.par_q_advisory_active).toBe(true);
  });

  it('POST /api/me/par-q/mark-cleared sets par_q_advisory_active=false', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    await db.query(`UPDATE users SET par_q_advisory_active=true WHERE id=$1`, [seed.userId]);
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q/mark-cleared',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().advisory_active).toBe(false);
    const { rows: [u] } = await db.query(
      `SELECT par_q_advisory_active FROM users WHERE id=$1`,
      [seed.userId],
    );
    expect(u.par_q_advisory_active).toBe(false);
  });

  it('clearing advisory does NOT bump par_q_version (it stays at last-acknowledged)', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[0] = true;
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });
    await app.inject({
      method: 'POST', url: '/api/me/par-q/mark-cleared',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    const { rows: [u] } = await db.query(
      `SELECT par_q_version FROM users WHERE id=$1`,
      [seed.userId],
    );
    expect(u.par_q_version).toBe(PAR_Q_VERSION);
  });
});
