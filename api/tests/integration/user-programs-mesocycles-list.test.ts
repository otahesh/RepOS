import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser, mkTemplate, mkUserProgram, cleanupTemplate } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App; let userId: string; let token: string; let upId: string; let templateId: string;
let completedRunId: string; let activeRunId: string;

beforeAll(async () => {
  app = await buildApp();
  userId = (await mkUser({ prefix: 'vitest.w8-mesolist' })).id;
  const tpl = await mkTemplate({ prefix: 'vitest-w8-mesolist-tpl', weeks: 4, structure: { _v: 1, days: [
    { idx: 0, day_offset: 0, kind: 'strength', name: 'D', blocks: [
      { exercise_slug: 'barbell-bench-press', mev: 2, mav: 3, target_reps_low: 6, target_reps_high: 10, target_rir: 2, rest_sec: 180 },
    ]},
  ]}});
  templateId = tpl.id;
  upId = (await mkUserProgram({ userId, templateId: tpl.id, templateVersion: 1, status: 'active' })).id;
  // Two runs on the same program: one completed (older), one active (newer).
  const { rows: [c] } = await db.query<{ id: string }>(
    `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, current_week, status, finished_at, is_deload, created_at)
     VALUES ($1,$2,'2026-01-01','UTC',4,4,'completed', now() - interval '10 days', false, now() - interval '40 days') RETURNING id`,
    [upId, userId],
  );
  completedRunId = c.id;
  const { rows: [a] } = await db.query<{ id: string }>(
    `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, current_week, status, is_deload, created_at)
     VALUES ($1,$2,'2026-02-01','UTC',4,2,'active', false, now()) RETURNING id`,
    [upId, userId],
  );
  activeRunId = a.id;
  const t = await app.inject({ method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 'a', scopes: ['program:write'] } });
  token = t.json<{ token: string }>().token;
});
afterAll(async () => {
  await cleanupUser(userId);
  await cleanupTemplate(templateId);
  await app.close();
});

describe('GET /api/user-programs/:id/mesocycles [WS6.2 / D6]', () => {
  it('returns this program runs newest-first with recap-entry columns', async () => {
    const r = await app.inject({
      method: 'GET', url: `/api/user-programs/${upId}/mesocycles`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ mesocycles: Array<{ id: string; status: string; start_date: string; finished_at: string | null; is_deload: boolean; weeks: number }> }>();
    expect(body.mesocycles).toHaveLength(2);
    // Newest first: the active run (created now) precedes the completed run (created 40d ago).
    expect(body.mesocycles[0].id).toBe(activeRunId);
    expect(body.mesocycles[1].id).toBe(completedRunId);
    const completed = body.mesocycles.find((m) => m.id === completedRunId)!;
    expect(completed.status).toBe('completed');
    expect(completed.weeks).toBe(4);
    expect(completed.is_deload).toBe(false);
    expect(completed.start_date).toBe('2026-01-01');
    expect(typeof completed.finished_at).toBe('string');
  });

  it('returns 401 with no bearer', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/user-programs/${upId}/mesocycles` });
    expect([401, 403]).toContain(r.statusCode);
  });

  it('returns 404 for a program id that does not exist', async () => {
    const r = await app.inject({
      method: 'GET', url: `/api/user-programs/00000000-0000-0000-0000-000000000000/mesocycles`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(404);
  });
});
