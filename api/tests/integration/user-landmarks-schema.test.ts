import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

describe('users.muscle_landmarks — migration 041', () => {
  let userId: string;
  beforeAll(async () => { userId = (await mkUser({ prefix: 'vitest.lm-mig' })).id; });
  afterAll(async () => { await cleanupUser(userId); });

  it('column exists with default {"_v":1}', async () => {
    const { rows } = await db.query<{ muscle_landmarks: { _v: number } }>(
      `SELECT muscle_landmarks FROM users WHERE id=$1`, [userId],
    );
    expect(rows[0].muscle_landmarks).toEqual({ _v: 1 });
  });

  it('accepts a valid override JSON', async () => {
    await db.query(
      `UPDATE users SET muscle_landmarks=$2::jsonb WHERE id=$1`,
      [userId, JSON.stringify({ _v: 1, overrides: { chest: { mev: 12, mav: 16, mrv: 22 } } })],
    );
    const { rows } = await db.query<{ ml: any }>(
      `SELECT muscle_landmarks AS ml FROM users WHERE id=$1`, [userId],
    );
    expect(rows[0].ml.overrides.chest.mev).toBe(12);
  });

  it('rejects non-object or missing _v via CHECK constraint [I-MIG-040-CHECK]', async () => {
    await expect(
      db.query(`UPDATE users SET muscle_landmarks='[]'::jsonb WHERE id=$1`, [userId]),
    ).rejects.toThrow(/users_muscle_landmarks_shape/);
    await expect(
      db.query(`UPDATE users SET muscle_landmarks='{"overrides":{}}'::jsonb WHERE id=$1`, [userId]),
    ).rejects.toThrow(/users_muscle_landmarks_shape/);
  });
});
