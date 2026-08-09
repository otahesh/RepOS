// Direct unit coverage for services/parQRateLimit.ts (quality pass Q8) —
// the per-user 5-writes/24h window (app-layer because CF Tunnel collapses
// all clients to one egress IP).
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { checkParQWriteRateLimit } from '../../src/services/parQRateLimit.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';
import { db } from '../../src/db/client.js';

const created: string[] = [];

async function userWithAcks(count: number, opts: { hoursAgo?: number } = {}): Promise<string> {
  const u = await mkUser({ prefix: 'parq-rl' });
  created.push(u.id);
  for (let v = 1; v <= count; v++) {
    await db.query(
      `INSERT INTO par_q_acknowledgments (user_id, version, accepted_at, responses)
       VALUES ($1, $2, now() - ($3 || ' hours')::interval,
               '{"questions":[],"answers":[]}'::jsonb)`,
      [u.id, v, String(opts.hoursAgo ?? 0)],
    );
  }
  return u.id;
}

afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await db.end();
});

describe('checkParQWriteRateLimit', () => {
  it('allows a user with no prior writes', async () => {
    const userId = await userWithAcks(0);
    expect(await checkParQWriteRateLimit(userId)).toBe(true);
  });

  it('allows up to 4 writes in the trailing 24h', async () => {
    const userId = await userWithAcks(4);
    expect(await checkParQWriteRateLimit(userId)).toBe(true);
  });

  it('blocks the 6th write once 5 landed inside the window', async () => {
    const userId = await userWithAcks(5);
    expect(await checkParQWriteRateLimit(userId)).toBe(false);
  });

  it('ignores writes older than 24h', async () => {
    const userId = await userWithAcks(5, { hoursAgo: 25 });
    expect(await checkParQWriteRateLimit(userId)).toBe(true);
  });
});
