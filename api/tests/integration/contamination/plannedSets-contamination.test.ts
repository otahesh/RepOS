import 'dotenv/config';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { build } from '../../helpers/build-test-app.js';
import { mkUserPair, seedFullMesocycleForUser, cleanupUserPair, type UserPairHandle } from '../../helpers/seed-fixtures.js';
import { db } from '../../../src/db/client.js';

const handles: UserPairHandle[] = [];
afterEach(async () => { if (handles.length) await cleanupUserPair(handles.splice(0)); });
afterAll(async () => { await db.end(); });

async function aPlannedSet(userId: string): Promise<{ plannedSetId: string }> {
  const runId = await seedFullMesocycleForUser(userId, { weeks: 4 });
  const { rows } = await db.query<{ id: string }>(
    `SELECT ps.id
     FROM planned_sets ps
     JOIN day_workouts dw ON dw.id = ps.day_workout_id
     WHERE dw.mesocycle_run_id = $1
     ORDER BY ps.id LIMIT 1`,
    [runId],
  );
  return { plannedSetId: rows[0].id };
}

describe('W8.2 contamination — planned-sets (deep IDOR)', () => {
  it('PATCH /planned-sets/:id on A set from B token returns 404 and does not mutate', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { plannedSetId } = await aPlannedSet(pair.userA.userId);

    const res = await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${plannedSetId}`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      // PlannedSetPatchRequestSchema: target_rir min is 1, so use a VALID
      // minimal field (target_reps_low) — we want the ownership 404, not a
      // validation 400 that would mask the IDOR assertion.
      payload: { target_reps_low: 5 },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await db.query<{ overridden_at: Date | null }>(
      `SELECT overridden_at FROM planned_sets WHERE id=$1`, [plannedSetId],
    );
    expect(rows[0].overridden_at).toBeNull();
  });

  it('POST /planned-sets/:id/substitute on A set from B token returns 404', async () => {
    const app = await build();
    const pair = await mkUserPair();
    handles.push(pair);
    const { plannedSetId } = await aPlannedSet(pair.userA.userId);
    const { rows: ex } = await db.query<{ id: string }>(`SELECT id FROM exercises WHERE archived_at IS NULL LIMIT 1`);

    const res = await app.inject({
      method: 'POST', url: `/api/planned-sets/${plannedSetId}/substitute`,
      headers: { authorization: `Bearer ${pair.userB.bearer}` },
      payload: { to_exercise_id: ex[0].id },
    });
    expect(res.statusCode).toBe(404);
  });
});
