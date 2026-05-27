import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { PAR_Q_VERSION, PAR_Q_QUESTIONS } from '../../src/constants/parQ.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — PAR-Q flow', () => {
  it('GET /api/me/par-q returns needs_prompt=true for new user', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.current_version).toBe(PAR_Q_VERSION);
    expect(body.acknowledged_version).toBe(0);
    expect(body.needs_prompt).toBe(true);
    expect(body.questions).toEqual(PAR_Q_QUESTIONS);
  });

  it('POST /api/me/par-q creates an audit row + sets users.par_q_acknowledged_at + par_q_version', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.json().any_yes).toBe(false);
    expect(res.json().injuries_created).toBe(0);

    const { rows: ackRows } = await db.query(
      'SELECT version, responses FROM par_q_acknowledgments WHERE user_id = $1',
      [seed.userId],
    );
    expect(ackRows).toHaveLength(1);
    expect(ackRows[0].version).toBe(PAR_Q_VERSION);

    const { rows: [userRow] } = await db.query(
      'SELECT par_q_version, par_q_acknowledged_at FROM users WHERE id = $1',
      [seed.userId],
    );
    expect(userRow.par_q_version).toBe(PAR_Q_VERSION);
    expect(userRow.par_q_acknowledged_at).not.toBeNull();
  });

  it('any_yes=true when at least one answer is true', async () => {
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
    expect(res.json().any_yes).toBe(true);
  });

  it('version bump re-prompts AND prior ack rows are preserved (per QA Round 2)', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);

    // Accept the current version.
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });

    // Simulate a version bump by manually downgrading users.par_q_version
    // (in production this happens when PAR_Q_VERSION constant is incremented;
    // existing rows fall below it and re-prompt). 2 → 1 here.
    await db.query('UPDATE users SET par_q_version = par_q_version - 1 WHERE id = $1', [seed.userId]);

    const res = await app.inject({
      method: 'GET', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}` },
    });
    const body = res.json();
    expect(body.needs_prompt).toBe(true);
    expect(body.acknowledged_version).toBe(PAR_Q_VERSION - 1);  // downgraded below current

    // Audit row from previous acceptance is preserved.
    const { rows: ackRows } = await db.query(
      'SELECT version FROM par_q_acknowledgments WHERE user_id = $1 ORDER BY version',
      [seed.userId],
    );
    expect(ackRows).toHaveLength(1);
    expect(ackRows[0].version).toBe(PAR_Q_VERSION);
  });

  it('POST is idempotent on (user_id, version) — first accept returns 201, re-accept returns 200, no duplicate row', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    const payload = JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] });
    const headers = { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' };

    const r1 = await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    const r2 = await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    // Atomic upsert returns 201 on first accept, 200 on re-accept (panel I-UPSERT).
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(200);

    const { rows } = await db.query('SELECT count(*)::int AS c FROM par_q_acknowledgments WHERE user_id = $1', [seed.userId]);
    expect(rows[0].c).toBe(1);
  });

  it('par_q_acknowledged_at is first-write-wins (COALESCE) — re-accept does NOT rewrite the timestamp', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    const payload = JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] });
    const headers = { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' };

    await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    const { rows: [u1] } = await db.query(
      'SELECT par_q_acknowledged_at FROM users WHERE id=$1',
      [seed.userId],
    );
    // Wait so any rewrite would be visible.
    await new Promise(r => setTimeout(r, 50));
    await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    const { rows: [u2] } = await db.query(
      'SELECT par_q_acknowledged_at FROM users WHERE id=$1',
      [seed.userId],
    );
    expect(u2.par_q_acknowledged_at).toEqual(u1.par_q_acknowledged_at);
  });
});
