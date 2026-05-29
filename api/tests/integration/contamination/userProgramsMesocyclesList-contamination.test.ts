import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { mkUser, cleanupUser, mkTemplate, mkUserProgram, cleanupTemplate } from '../../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userA: string; let tokenA: string;
let userB: string; let userBProgramId: string;
let templateId: string;

beforeAll(async () => {
  app = await buildApp();
  userA = (await mkUser({ prefix: 'vitest.w8-mesolist-a' })).id;
  userB = (await mkUser({ prefix: 'vitest.w8-mesolist-b' })).id;
  const tpl = await mkTemplate({ prefix: 'vitest-w8-mesolist-c-tpl', weeks: 4, structure: { _v: 1, days: [
    { idx: 0, day_offset: 0, kind: 'strength', name: 'D', blocks: [
      { exercise_slug: 'barbell-bench-press', mev: 2, mav: 3, target_reps_low: 6, target_reps_high: 10, target_rir: 2, rest_sec: 180 },
    ]},
  ]}});
  templateId = tpl.id;
  // User B owns a program with one completed run.
  userBProgramId = (await mkUserProgram({ userId: userB, templateId: tpl.id, templateVersion: 1, status: 'completed' })).id;
  await db.query(
    `INSERT INTO mesocycle_runs (user_program_id, user_id, start_date, start_tz, weeks, current_week, status, finished_at, is_deload)
     VALUES ($1,$2,'2026-01-01','UTC',4,4,'completed', now(), false)`,
    [userBProgramId, userB],
  );
  const t = await app.inject({ method: 'POST', url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['program:write'] }});
  tokenA = t.json<{ token: string }>().token;
});
afterAll(async () => {
  await cleanupUser(userA);
  await cleanupUser(userB);
  await cleanupTemplate(templateId);
  await app.close();
});

describe('GET /api/user-programs/:id/mesocycles contamination — G2 [I-CONTAM-MATRIX-COMPLETE]', () => {
  it('returns 401/403 with no bearer', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/user-programs/${userBProgramId}/mesocycles` });
    expect([401, 403]).toContain(r.statusCode);
  });

  it('user A reading user B program runs returns 404 (never B data)', async () => {
    const r = await app.inject({
      method: 'GET', url: `/api/user-programs/${userBProgramId}/mesocycles`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(r.statusCode).toBe(404);
    // Must NOT leak B's run rows.
    const body = r.json<{ mesocycles?: unknown[] }>();
    expect(body.mesocycles).toBeUndefined();
  });
});
