// api/tests/plannedSets.test.ts
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string; let runId: string;

beforeAll(async () => {
  vi.setSystemTime(new Date('2026-05-04T15:00:00.000Z'));
  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.ps.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const mint = await app.inject({
    method: 'POST', url: '/api/tokens', body: { user_id: userId, label: 'ps-test' }
  });
  token = mint.json<{ token: string }>().token;
  const f = await app.inject({
    method: 'POST', url: '/api/program-templates/full-body-3-day/fork',
    headers: { authorization: `Bearer ${token}` },
  });
  const upId = f.json<any>().id;
  const s = await app.inject({
    method: 'POST', url: `/api/user-programs/${upId}/start`,
    headers: { authorization: `Bearer ${token}` },
    body: { start_date: '2026-05-04', start_tz: 'America/New_York' },
  });
  runId = s.json<any>().mesocycle_run_id;
});
afterAll(async () => {
  vi.useRealTimers();
  if (userId) await db.query(`DELETE FROM users WHERE id=$1`, [userId]);
  await app.close(); await db.end();
});
const auth = () => ({ authorization: `Bearer ${token}` });

async function getSetOnDate(date: string) {
  const { rows } = await db.query(
    `SELECT ps.id, ps.target_reps_low, ps.target_reps_high, ps.target_rir,
            to_char(dw.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            ps.block_idx, ps.set_idx
     FROM planned_sets ps JOIN day_workouts dw ON dw.id=ps.day_workout_id
     WHERE dw.mesocycle_run_id=$1 AND dw.scheduled_date=$2::date
     ORDER BY ps.block_idx, ps.set_idx LIMIT 1`,
    [runId, date],
  );
  return rows[0];
}

describe('PATCH /api/planned-sets/:id', () => {
  it('today succeeds; records overridden_at + override_reason', async () => {
    const setRow = await getSetOnDate('2026-05-04');
    expect(setRow).toBeDefined();
    const r = await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${setRow.id}`, headers: auth(),
      body: { target_reps_low: 5, target_reps_high: 8, target_rir: 2, override_reason: 'feeling beat-up' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.target_reps_low).toBe(5);
    expect(body.target_reps_high).toBe(8);
    expect(body.target_rir).toBe(2);
    expect(body.overridden_at).toBeDefined();
    expect(body.override_reason).toBe('feeling beat-up');
  });

  it('future day succeeds', async () => {
    const setRow = await getSetOnDate('2026-05-06');   // Wed of week 1
    expect(setRow).toBeDefined();
    const r = await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${setRow.id}`, headers: auth(),
      body: { target_reps_high: 12, override_reason: 'pushing volume' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('past day → 409', async () => {
    // Backdate one day_workout so a planned_set sits in the past relative to pinned today.
    await db.query(
      `UPDATE day_workouts SET scheduled_date='2026-05-01'
       WHERE mesocycle_run_id=$1 AND week_idx=1 AND day_idx=0`,
      [runId],
    );
    try {
      const { rows: [past] } = await db.query(
        `SELECT ps.id FROM planned_sets ps JOIN day_workouts dw ON dw.id=ps.day_workout_id
         WHERE dw.mesocycle_run_id=$1 AND dw.scheduled_date='2026-05-01' LIMIT 1`,
        [runId],
      );
      expect(past).toBeDefined();
      const r = await app.inject({
        method: 'PATCH', url: `/api/planned-sets/${past.id}`, headers: auth(),
        body: { target_reps_low: 6 },
      });
      expect(r.statusCode).toBe(409);
      expect(r.json<any>().error).toBe('past_day_readonly');
    } finally {
      // Restore the date so subsequent tests can still find a set on 2026-05-04.
      await db.query(
        `UPDATE day_workouts SET scheduled_date='2026-05-04'
         WHERE mesocycle_run_id=$1 AND week_idx=1 AND day_idx=0`,
        [runId],
      );
    }
  });

  it('week+1 baseline unaffected by today override', async () => {
    const { rows: [w2Before] } = await db.query(
      `SELECT ps.target_reps_low FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx=2 AND dw.day_idx=0
         AND ps.block_idx=0 AND ps.set_idx=0`,
      [runId],
    );
    const todaySet = await getSetOnDate('2026-05-04');
    await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${todaySet.id}`, headers: auth(),
      body: { target_reps_low: 3, override_reason: 'iso testing' },
    });
    const { rows: [w2After] } = await db.query(
      `SELECT ps.target_reps_low FROM planned_sets ps
       JOIN day_workouts dw ON dw.id=ps.day_workout_id
       WHERE dw.mesocycle_run_id=$1 AND dw.week_idx=2 AND dw.day_idx=0
         AND ps.block_idx=0 AND ps.set_idx=0`,
      [runId],
    );
    expect(w2After.target_reps_low).toBe(w2Before.target_reps_low);
  });

  it('appends mesocycle_run_events row with event_type=set_overridden', async () => {
    const setRow = await getSetOnDate('2026-05-04');
    await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${setRow.id}`, headers: auth(),
      body: { target_rir: 1, override_reason: 'pushing for PR' },
    });
    const { rows } = await db.query(
      `SELECT event_type, payload FROM mesocycle_run_events
       WHERE run_id=$1 AND event_type='set_overridden'
       ORDER BY occurred_at DESC LIMIT 1`,
      [runId],
    );
    expect(rows[0].event_type).toBe('set_overridden');
    expect(rows[0].payload.planned_set_id).toBe(setRow.id);
  });

  it('rejects empty PATCH body with 400', async () => {
    const setRow = await getSetOnDate('2026-05-06');
    const r = await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${setRow.id}`, headers: auth(),
      body: {},
    });
    expect(r.statusCode).toBe(400);
    expect(r.json<any>().error).toContain('patch body cannot be empty');
  });

  it('explicit override_reason: null clears the existing reason', async () => {
    const setRow = await getSetOnDate('2026-05-06');
    // First set a reason
    await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${setRow.id}`, headers: auth(),
      body: { override_reason: 'temp' },
    });
    // Then explicitly clear
    const r = await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${setRow.id}`, headers: auth(),
      body: { override_reason: null },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await db.query(`SELECT override_reason FROM planned_sets WHERE id=$1`, [setRow.id]);
    expect(rows[0].override_reason).toBeNull();
  });

  it('cross-row rep range: PATCH target_reps_low > current high → 400 (no CHECK violation)', async () => {
    const setRow = await getSetOnDate('2026-05-06');
    const { rows: [orig] } = await db.query(
      `SELECT target_reps_low, target_reps_high FROM planned_sets WHERE id=$1`, [setRow.id]
    );
    // Set new low above current high
    const r = await app.inject({
      method: 'PATCH', url: `/api/planned-sets/${setRow.id}`, headers: auth(),
      body: { target_reps_low: orig.target_reps_high + 5 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json<any>().field).toBe('target_reps_low');
  });

  it('bearer revoked mid-mesocycle → 401, no partial write', async () => {
    const setRow = await getSetOnDate('2026-05-06');
    const before = await db.query(`SELECT target_reps_low FROM planned_sets WHERE id=$1`, [setRow.id]);
    await db.query(
      `UPDATE device_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [userId],
    );
    try {
      const r = await app.inject({
        method: 'PATCH', url: `/api/planned-sets/${setRow.id}`, headers: auth(),
        body: { target_reps_low: 1 },
      });
      expect(r.statusCode).toBe(401);
      const after = await db.query(`SELECT target_reps_low FROM planned_sets WHERE id=$1`, [setRow.id]);
      expect(after.rows[0].target_reps_low).toBe(before.rows[0].target_reps_low);
    } finally {
      await db.query(`UPDATE device_tokens SET revoked_at=NULL WHERE user_id=$1`, [userId]);
    }
  });
});
