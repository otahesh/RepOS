// api/tests/integration/recovery-flag-telemetry.test.ts
//
// Beta W3.1 — recovery_flag_events telemetry on emit.
//
// Asserts that:
//   1. GET /api/recovery-flags writes a 'shown' row to recovery_flag_events
//      for each visible (triggered AND non-dismissed) evaluator.
//   2. POST /api/recovery-flags/dismiss writes a 'dismissed' row.
//
// Uses seedUserOverreaching which seeds the AND-gate conditions for
// overreachingEvaluator (3 RIR-0 compound sessions in 7d + current-week
// performed_sets >= MAV). This means the route MUST populate ctx.runId
// from the user's active mesocycle_run for the evaluator to fire — the
// pre-T12 route hard-codes runId=null.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { seedUserOverreaching, cleanupSeeded, type SeedHandle } from '../helpers/seed-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let seed: SeedHandle;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  seed = await seedUserOverreaching();
  userId = seed.userId;
  token = seed.bearer;
});

afterAll(async () => {
  await db.query(`DELETE FROM recovery_flag_events WHERE user_id=$1`, [userId]);
  await cleanupSeeded(seed);
  await app.close();
});

describe('recovery_flag_events telemetry', () => {
  it('writes a row on shown emit', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/recovery-flags',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(200);
    const { rows } = await db.query<{ flag: string; event_type: string; week_start: string }>(
      `SELECT flag, event_type, week_start FROM recovery_flag_events WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows[0]).toMatchObject({ flag: 'overreaching', event_type: 'shown' });
  });

  it('writes a row on dismiss', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/recovery-flags/dismiss',
      headers: { authorization: `Bearer ${token}` },
      payload: { flag: 'overreaching' },
    });
    expect(resp.statusCode).toBe(204);
    const { rows } = await db.query<{ event_type: string }>(
      `SELECT event_type FROM recovery_flag_events WHERE user_id=$1 AND event_type='dismissed' ORDER BY id DESC LIMIT 1`,
      [userId],
    );
    expect(rows[0]?.event_type).toBe('dismissed');
  });
});
