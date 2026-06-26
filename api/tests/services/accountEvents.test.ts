import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { recordAccountEvent, listAccountEvents } from '../../src/services/accountEvents.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

let userId: string;

beforeAll(async () => {
  const u = await mkUser({ prefix: 'vitest.acct-svc' });
  userId = u.id;
});
afterAll(async () => {
  await cleanupUser(userId);
});

describe('recordAccountEvent', () => {
  let userEmail: string;
  beforeAll(async () => {
    const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [
      userId,
    ]);
    userEmail = rows[0].email;
  });

  it('inserts a row with kind + meta + ip + PII snapshot columns (per D8)', async () => {
    await recordAccountEvent({
      userId,
      userEmail,
      kind: 'profile_changed',
      ip: '10.0.0.5',
      meta: { field: 'display_name', changed: true },
    });
    const { rows } = await db.query(
      `SELECT kind, ip, meta, user_id_at_event, user_email_at_event FROM account_events WHERE user_id=$1`,
      [userId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('profile_changed');
    expect(rows[0].meta).toEqual({ field: 'display_name', changed: true });
    expect(rows[0].user_id_at_event).toBe(userId);
    expect(rows[0].user_email_at_event).toBe(userEmail);
  });

  it('rejects unknown kinds at compile time (TypeScript union enforces it)', async () => {
    await recordAccountEvent({
      userId,
      userEmail,
      // @ts-expect-error — invalid kind (caught by TS, not by Postgres)
      kind: 'not_real',
      ip: null,
      meta: {},
    });
  });

  it('accepts W2/W5 cross-wave kinds (par_q_acknowledged, onboarding_completed, restore_replayed)', async () => {
    for (const kind of [
      'par_q_acknowledged',
      'onboarding_completed',
      'restore_replayed',
    ] as const) {
      await expect(
        recordAccountEvent({ userId, userEmail, kind, ip: null, meta: {} }),
      ).resolves.toBeUndefined();
    }
  });

  it('listAccountEvents uses keyset pagination — (occurred_at, id) tiebreaker', async () => {
    const ts = new Date();
    await db.query(
      `INSERT INTO account_events (user_id, user_id_at_event, user_email_at_event, kind, ip, meta, occurred_at)
       VALUES ($1, $1, $2, 'token_minted', null, '{}'::jsonb, $3),
              ($1, $1, $2, 'token_minted', null, '{}'::jsonb, $3)`,
      [userId, userEmail, ts],
    );
    const rows = await listAccountEvents(userId, { limit: 1 });
    expect(rows.length).toBe(1);
    const next = await listAccountEvents(userId, {
      limit: 1,
      beforeTs: rows[0].occurred_at,
      beforeId: rows[0].id,
    });
    expect(next.length).toBe(1);
  });
});
