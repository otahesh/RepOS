import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import {
  mkUserPair,
  seedFullMesocycleForUser,
  cleanupUserPair,
  type UserPairHandle,
} from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => {
  if (handles.length) await cleanupUserPair(handles.splice(0));
});
afterAll(async () => {
  await db.end();
});

describe('W8.2 — manual-deload contamination', () => {
  it("user B cannot deload user A's mesocycle_run", async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5, currentWeek: 2 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${runId}/deload-now`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);

    // Confirm A's run is untouched.
    const { rows: events } = await db.query(
      `SELECT event_type FROM mesocycle_run_events WHERE run_id=$1 AND event_type='manual_deload'`,
      [runId],
    );
    expect(events).toHaveLength(0);
  });

  it("user B cannot undo a deload on user A's mesocycle_run (no existence oracle)", async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const runId = await seedFullMesocycleForUser(pair.userA.userId, { weeks: 5, currentWeek: 2 });

    // Ownership must be resolved before deload-state — a foreign caller gets a
    // flat 404 (not a 409 'no_manual_deload' that would leak run existence).
    const res = await app.inject({
      method: 'POST',
      url: `/api/mesocycles/${runId}/deload-now/undo`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
    });
    expect(res.statusCode).toBe(404);

    // No manual-deload event of any kind was written to A's run by B's call.
    const { rows: events } = await db.query(
      `SELECT event_type FROM mesocycle_run_events WHERE run_id=$1 AND event_type::text LIKE 'manual_deload%'`,
      [runId],
    );
    expect(events).toHaveLength(0);
  });

  it("user B cannot undo user A's APPLIED deload (deload survives, no undo event)", async () => {
    // Complementary to the no-deload-present case above: here A has a real
    // deload applied, and the assertion is that B's undo cannot unwind it.
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
    const kinds = events.map((r) => r.event_type);
    expect(kinds).toContain('manual_deload');
    expect(kinds).not.toContain('manual_deload_undone');
  });
});
