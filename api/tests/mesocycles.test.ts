import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string;
let otherUserId: string;
let token: string;
let runId: string;

beforeAll(async () => {
  // Pin system time so getTodayWorkout sees today_local = 2026-05-04 (Mon)
  // in America/New_York — day 1 of the full-body-3-day run.
  vi.setSystemTime(new Date('2026-05-04T15:00:00.000Z'));

  app = await buildApp();
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.meso.${Date.now()}@repos.test`],
  );
  userId = u.id;
  const { rows: [u2] } = await db.query(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`vitest.meso.other.${Date.now()}@repos.test`],
  );
  otherUserId = u2.id;
  const mint = await app.inject({
    method: 'POST', url: '/api/tokens', body: { user_id: userId, label: 'meso-test' }
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
  if (otherUserId) await db.query(`DELETE FROM users WHERE id=$1`, [otherUserId]);
  await app.close();
  await db.end();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('GET /api/mesocycles/:id', () => {
  it('returns run detail with day_workouts summary', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/mesocycles/${runId}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.id).toBe(runId);
    expect(body.start_date).toBe('2026-05-04');
    expect(body.start_tz).toBe('America/New_York');
    expect(Array.isArray(body.day_workouts)).toBe(true);
    expect(body.day_workouts.length).toBeGreaterThan(0);
    // TZ-safe: scheduled_date returned as YYYY-MM-DD string, not a shifted Date
    for (const dw of body.day_workouts) {
      expect(typeof dw.scheduled_date).toBe('string');
      expect(dw.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("404 on someone else's run", async () => {
    const { rows: [tmpl] } = await db.query(
      `SELECT id, version, name FROM program_templates WHERE slug='full-body-3-day'`
    );
    const { rows: [up2] } = await db.query(
      `INSERT INTO user_programs (user_id, template_id, template_version, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [otherUserId, tmpl.id, tmpl.version, tmpl.name],
    );
    const { rows: [other] } = await db.query(
      `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks)
       VALUES ($1, $2, '2026-05-04', 'America/New_York', 5) RETURNING id`,
      [up2.id, otherUserId],
    );
    const r = await app.inject({ method: 'GET', url: `/api/mesocycles/${other.id}`, headers: auth() });
    expect(r.statusCode).toBe(404);
  });

  it('401 without auth', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/mesocycles/${runId}` });
    expect(r.statusCode).toBe(401);
  });
});

describe('GET /api/mesocycles/today', () => {
  it('returns state:workout for today within the active run window', async () => {
    // Today_local in America/New_York is 2026-05-04 (Mon). full-body-3-day has
    // day 1 on Mon → workout state with sets array.
    const r = await app.inject({ method: 'GET', url: '/api/mesocycles/today', headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json<any>();
    expect(body.state).toBe('workout');
    expect(body.run_id).toBe(runId);
    expect(Array.isArray(body.sets)).toBe(true);
    expect(body.day).toBeDefined();
    expect(body.day.scheduled_date).toBe('2026-05-04');
  });

  it('returns state:rest on an off-day inside the run window', async () => {
    // Move time forward to Tuesday, which is a rest day for Mon/Wed/Fri.
    vi.setSystemTime(new Date('2026-05-05T15:00:00.000Z'));
    try {
      const r = await app.inject({ method: 'GET', url: '/api/mesocycles/today', headers: auth() });
      expect(r.statusCode).toBe(200);
      const body = r.json<any>();
      expect(body.state).toBe('rest');
      expect(body.run_id).toBe(runId);
    } finally {
      vi.setSystemTime(new Date('2026-05-04T15:00:00.000Z'));
    }
  });

  it('returns state:no_active_run when no active run exists', async () => {
    await db.query(`UPDATE mesocycle_runs SET status='completed' WHERE id=$1`, [runId]);
    try {
      const r = await app.inject({ method: 'GET', url: '/api/mesocycles/today', headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json<any>().state).toBe('no_active_run');
    } finally {
      await db.query(`UPDATE mesocycle_runs SET status='active' WHERE id=$1`, [runId]);
    }
  });

  it('401 without auth', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/mesocycles/today' });
    expect(r.statusCode).toBe(401);
  });
});
