import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';
import { PAR_Q_VERSION, PAR_Q_QUESTIONS } from '../../../src/constants/parQ.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 contamination — PAR-Q', () => {
  it('user A cannot see user B PAR-Q ack via GET', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);

    // user B accepts.
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${pair.userB.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });

    // user A's GET reflects their own state, not B's.
    const res = await app.inject({
      method: 'GET', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${pair.userA.bearer}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().acknowledged_version).toBe(0);
    expect(res.json().needs_prompt).toBe(true);
  });

  it('POST by user A only writes ack rows for user A', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const answers = new Array(PAR_Q_QUESTIONS.length).fill(false);
    await app.inject({
      method: 'POST', url: '/api/me/par-q',
      headers: { authorization: `Bearer ${pair.userA.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ version: PAR_Q_VERSION, answers, q5_joints: [] }),
    });
    const { rows } = await db.query<{ user_id: string }>(
      'SELECT user_id FROM par_q_acknowledgments WHERE user_id IN ($1, $2)',
      [pair.userA.userId, pair.userB.userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(pair.userA.userId);
  });

  it('POST /me/par-q/mark-cleared by A does not clear B advisory flag', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);

    // Put B into advisory-active state directly.
    await db.query(
      `UPDATE users SET par_q_advisory_active = true WHERE id=$1`,
      [pair.userB.userId],
    );

    const res = await app.inject({
      method: 'POST', url: '/api/me/par-q/mark-cleared',
      headers: { authorization: `Bearer ${pair.userA.bearer}` },
    });
    expect(res.statusCode).toBe(200);

    // B's flag must be untouched.
    const { rows } = await db.query<{ par_q_advisory_active: boolean }>(
      `SELECT par_q_advisory_active FROM users WHERE id=$1`, [pair.userB.userId],
    );
    expect(rows[0].par_q_advisory_active).toBe(true);
  });
});
