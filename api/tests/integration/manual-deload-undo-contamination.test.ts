// api/tests/integration/manual-deload-undo-contamination.test.ts
import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../helpers/seed-fixtures.js';
import { db } from '../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

describe('W8.2 — manual-deload undo contamination', () => {
  it("user B cannot undo user A's deload of user A's mesocycle_run", async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5, currentWeek: 2 });

    // User A applies a deload (legitimate).
    await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${runId}/deload-now`,
      headers: { authorization: `Bearer ${pair.userA.bearer}` },
    });
    // User B tries to undo.
    const undoRes = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${runId}/deload-now/undo`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(undoRes.statusCode).toBe(404);

    // Confirm A's deload is still in place — the manual_deload event remains
    // and NO manual_deload_undone row was created by B's attempt. (The run
    // also carries the 'started' event materializeMesocycle emits.)
    const { rows: events } = await db.query<{ event_type: string }>(
      `SELECT event_type FROM mesocycle_run_events WHERE run_id=$1 ORDER BY occurred_at`,
      [runId],
    );
    const kinds = events.map(r => r.event_type);
    expect(kinds).toContain('manual_deload');
    expect(kinds).not.toContain('manual_deload_undone');
  });
});
