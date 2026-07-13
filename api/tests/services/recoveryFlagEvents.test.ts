// Direct unit coverage for services/recoveryFlagEvents.ts (quality pass Q8) —
// the shown-dedupe and dismissed-append contracts the W3 telemetry tuning
// pass depends on.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { recordFlagShown, recordFlagDismissed } from '../../src/services/recoveryFlagEvents.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';
import { db } from '../../src/db/client.js';

let userId: string;

beforeAll(async () => {
  const u = await mkUser({ prefix: 'rfe' });
  userId = u.id;
});
afterAll(async () => {
  await cleanupUser(userId);
  await db.end();
});

async function rowsFor(flag: string, eventType: string): Promise<number> {
  const { rows } = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM recovery_flag_events
     WHERE user_id=$1 AND flag=$2 AND event_type=$3`,
    [userId, flag, eventType],
  );
  return rows[0].c;
}

describe('recoveryFlagEvents', () => {
  it("'shown' dedupes to one row per (user, flag, week) across repeat polls", async () => {
    await recordFlagShown({ userId, flag: 'overreaching' });
    await recordFlagShown({ userId, flag: 'overreaching' });
    await recordFlagShown({ userId, flag: 'overreaching' });
    expect(await rowsFor('overreaching', 'shown')).toBe(1);
  });

  it("'shown' rows for different flags do not collide", async () => {
    await recordFlagShown({ userId, flag: 'stalled_pr' });
    expect(await rowsFor('stalled_pr', 'shown')).toBe(1);
    expect(await rowsFor('overreaching', 'shown')).toBe(1);
  });

  it("'dismissed' is append-only — each dismiss is a discrete row", async () => {
    await recordFlagDismissed({ userId, flag: 'overreaching' });
    await recordFlagDismissed({ userId, flag: 'overreaching' });
    expect(await rowsFor('overreaching', 'dismissed')).toBe(2);
  });

  it('rejects an unknown flag at the DB CHECK (typo guard, FIX-30)', async () => {
    await expect(
      // Cast past the TS union deliberately — the DB constraint is the guard
      // under test.
      recordFlagShown({ userId, flag: 'not_a_flag' as never }),
    ).rejects.toThrow(/check|constraint/i);
  });
});
