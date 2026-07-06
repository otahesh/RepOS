import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import {
  mkUser,
  mkTemplate,
  mkUserProgram,
  cleanupUser,
  cleanupTemplate,
} from './helpers/program-fixtures.js';
import { materializeMesocycle } from '../src/services/materializeMesocycle.js';

type App = Awaited<ReturnType<typeof buildApp>>;

// Template with one bench block so planned sets exist to hang logs on.
const STRUCTURE = {
  _v: 1,
  days: [
    {
      idx: 0,
      day_offset: 0,
      kind: 'strength',
      name: 'Day A',
      blocks: [
        {
          exercise_slug: 'barbell-bench-press',
          mev: 2,
          mav: 3,
          target_reps_low: 5,
          target_reps_high: 8,
          target_rir: 2,
          rest_sec: 180,
        },
      ],
    },
  ],
};

let app: App;
let userId: string, otherUserId: string, templateId: string, runId: string;
let token: string, otherToken: string;

beforeAll(async () => {
  app = await buildApp();
  userId = (await mkUser({ prefix: 'vitest.exhist' })).id;
  otherUserId = (await mkUser({ prefix: 'vitest.exhist2' })).id;
  templateId = (await mkTemplate({ prefix: 'vitest-exhist', weeks: 4, structure: STRUCTURE })).id;
  const up = await mkUserProgram({ userId, templateId, name: 'hist run' });
  runId = (
    await materializeMesocycle({ userProgramId: up.id, startDate: '2026-06-01', startTz: 'UTC' })
  ).run_id;

  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    payload: { user_id: userId, label: 'exhist-token' },
  });
  token = mint.json<{ token: string }>().token;

  const otherMint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    payload: { user_id: otherUserId, label: 'exhist-other-token' },
  });
  otherToken = otherMint.json<{ token: string }>().token;

  // Log week-1 sets directly (exercise_id + user_id columns exist per migration 029).
  await db.query(
    `
    INSERT INTO set_logs (planned_set_id, user_id, exercise_id, client_request_id, performed_reps, performed_load_lbs, performed_rir, performed_at)
    SELECT ps.id, $1, ps.exercise_id, gen_random_uuid(), 8, 135.0, 2, dw.scheduled_date::timestamptz + interval '10 hours'
    FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
    WHERE dw.mesocycle_run_id = $2 AND dw.week_idx = 1`,
    [userId, runId],
  );
});

afterAll(async () => {
  await app.close();
  await cleanupUser(userId);
  await cleanupUser(otherUserId);
  await cleanupTemplate(templateId);
  await db.end();
});

describe('GET /api/exercises/:slug/history', () => {
  it('returns sessions newest-first with per-set weight/reps/rir', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/barbell-bench-press/history',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ sessions: { date: string; sets: unknown[] }[] }>();
    expect(body.sessions.length).toBe(1);
    expect(body.sessions[0].sets).toEqual([
      { weight_lbs: 135, reps: 8, rir: 2 },
      { weight_lbs: 135, reps: 8, rir: 2 },
    ]);
    expect(body.sessions[0].date).toBe('2026-06-01');
  });

  it("does not leak another user's logs", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/barbell-bench-press/history',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ sessions: unknown[] }>();
    expect(body.sessions).toEqual([]);
  });

  it('respects ?limit=1', async () => {
    // Add a week-2 session so there are two distinct days to page through.
    await db.query(
      `
      INSERT INTO set_logs (planned_set_id, user_id, exercise_id, client_request_id, performed_reps, performed_load_lbs, performed_rir, performed_at)
      SELECT ps.id, $1, ps.exercise_id, gen_random_uuid(), 8, 140.0, 1, dw.scheduled_date::timestamptz + interval '10 hours'
      FROM planned_sets ps JOIN day_workouts dw ON dw.id = ps.day_workout_id
      WHERE dw.mesocycle_run_id = $2 AND dw.week_idx = 2`,
      [userId, runId],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/barbell-bench-press/history?limit=1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ sessions: { date: string }[] }>();
    expect(body.sessions.length).toBe(1);
    // Newest-first: week-2 date should sort ahead of week-1.
    expect(body.sessions[0].date).not.toBe('2026-06-01');
  });

  it('404s an unknown slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/exercises/nope/history',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
