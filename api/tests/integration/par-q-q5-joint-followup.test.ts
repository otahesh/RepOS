// api/tests/integration/par-q-q5-joint-followup.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { seedUserWithMesocycle, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';
import { PAR_Q_VERSION, PAR_Q_QUESTIONS, PAR_Q_Q5_INDEX } from '../../src/constants/parQ.js';

const handles: SeedHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupSeeded(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W2 — PAR-Q Q5 joint follow-up writes user_injuries', () => {
  it('Q5=no → no user_injuries rows created', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });
    const { rows } = await db.query(`SELECT joint FROM user_injuries WHERE user_id=$1`, [seed.userId]);
    expect(rows).toHaveLength(0);
  });

  it('Q5=yes + [low_back, knee_right] → 2 user_injuries rows + 1 par_q_acknowledgments row in one transaction', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[PAR_Q_Q5_INDEX] = true;
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        version: PAR_Q_VERSION,
        answers,
        q5_joints: ['low_back', 'knee_right'],
      }),
    });
    expect(res.statusCode).toBe(201);  // first acceptance
    expect(res.json().injuries_created).toBe(2);

    const { rows: injuries } = await db.query(
      `SELECT joint, severity, source, notes FROM user_injuries WHERE user_id=$1 ORDER BY joint`,
      [seed.userId],
    );
    expect(injuries).toHaveLength(2);
    expect(injuries[0].joint).toBe('knee_right');
    expect(injuries[0].severity).toBe('mod');
    expect(injuries[0].source).toBe(`par_q_v${PAR_Q_VERSION}`);
    expect(injuries[1].joint).toBe('low_back');

    const { rows: acks } = await db.query(
      `SELECT version FROM par_q_acknowledgments WHERE user_id=$1`,
      [seed.userId],
    );
    expect(acks).toHaveLength(1);
  });

  it('Q5=yes + [other] → 0 user_injuries rows (other is filtered, no W3 joint mapping) but ack still recorded', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[PAR_Q_Q5_INDEX] = true;
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: ['other'] }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().injuries_created).toBe(0);
    const { rows } = await db.query(`SELECT joint FROM user_injuries WHERE user_id=$1`, [seed.userId]);
    expect(rows).toHaveLength(0);
    // the 'other' selection is still preserved in the account_events meta.
    const { rows: ev } = await db.query(
      `SELECT meta FROM account_events WHERE user_id=$1 AND kind='par_q_acknowledged'`,
      [seed.userId],
    );
    expect(ev[0].meta.q5_joints).toEqual(['other']);
  });

  it('Q5=no + joints in payload → 400 q5_joints_provided_but_q5_no', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: ['low_back'] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('q5_joints_provided_but_q5_no');
  });

  it('re-accepting same version with same joints does NOT duplicate user_injuries rows', async () => {
    const app = await build();
    const seed = await seedUserWithMesocycle();
    handles.push(seed);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    answers[PAR_Q_Q5_INDEX] = true;
    const payload = JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: ['low_back'] });
    const headers = { authorization: `Bearer ${seed.bearer}`, 'content-type': 'application/json' };
    await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });
    await app.inject({ method: 'POST', url: '/api/me/par-q', headers, payload });

    const { rows } = await db.query(`SELECT joint FROM user_injuries WHERE user_id=$1`, [seed.userId]);
    expect(rows).toHaveLength(1);
  });
});
