import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupUserPair(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

describe('W8.2 contamination — onboarding-complete', () => {
  it("user B's POST cannot mutate user A's users row", async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);

    // Both users start un-onboarded.
    await db.query('UPDATE users SET onboarding_completed_at = NULL WHERE id = ANY($1::uuid[])', [
      [pair.userA.userId, pair.userB.userId],
    ]);

    // user B completes onboarding.
    await app.inject({
      method: 'POST',
      url: '/api/me/onboarding/complete',
      headers: { authorization: `Bearer ${pair.userB.bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ goal: 'bulk' }),
    });

    // user A's row is untouched: still un-onboarded, default goal.
    const {
      rows: [a],
    } = await db.query('SELECT onboarding_completed_at, goal FROM users WHERE id = $1', [
      pair.userA.userId,
    ]);
    expect(a.onboarding_completed_at).toBeNull();
    expect(a.goal).toBe('maintain'); // unchanged default

    // user B's row reflects only B's write.
    const {
      rows: [b],
    } = await db.query('SELECT onboarding_completed_at, goal FROM users WHERE id = $1', [
      pair.userB.userId,
    ]);
    expect(b.onboarding_completed_at).not.toBeNull();
    expect(b.goal).toBe('bulk');
  });
});
