import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { mkUser, cleanupUser, mkTemplate, mkUserProgram, cleanupTemplate } from '../../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userA: string; let tokenA: string;
let userB: string; let userBProgramId: string;
let userAProgramId: string;
let templateId: string;

beforeAll(async () => {
  app = await buildApp();
  userA = (await mkUser({ prefix: 'vitest.w4-start-a' })).id;
  userB = (await mkUser({ prefix: 'vitest.w4-start-b' })).id;
  const tpl = await mkTemplate({ prefix: 'vitest-w4-start-tpl', weeks: 4, structure: { _v: 1, days: [
    { idx: 0, day_offset: 0, kind: 'strength', name: 'D', blocks: [
      { exercise_slug: 'barbell-bench-press', mev: 2, mav: 3, target_reps_low: 6, target_reps_high: 10, target_rir: 2, rest_sec: 180 },
    ]},
  ]}});
  templateId = tpl.id;
  userBProgramId = (await mkUserProgram({ userId: userB, templateId: tpl.id, templateVersion: 1 })).id;
  userAProgramId = (await mkUserProgram({ userId: userA, templateId: tpl.id, templateVersion: 1 })).id;
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

describe('POST /api/user-programs/:id/start contamination — G2 [I-CONTAM-MATRIX-COMPLETE]', () => {
  // 401 — missing bearer
  it('returns 401 with no bearer', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${userAProgramId}/start?intent=normal`,
      payload: { start_date: '2026-06-01', start_tz: 'UTC' },
    });
    expect([401, 403]).toContain(r.statusCode);
  });

  // 400 — malformed body (bad start_date)
  it('returns 400 on malformed body', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${userAProgramId}/start?intent=normal`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { start_date: 'not-a-date', start_tz: 'UTC' },
    });
    expect(r.statusCode).toBe(400);
  });

  // 400 — invalid intent value
  it('returns 400 on intent=garbage', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${userAProgramId}/start?intent=garbage`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { start_date: '2026-06-01', start_tz: 'UTC' },
    });
    expect(r.statusCode).toBe(400);
  });

  // 201 — self-access
  it('returns 201 for self with intent=deload', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${userAProgramId}/start?intent=deload`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { start_date: '2026-09-01', start_tz: 'UTC' },
    });
    expect(r.statusCode).toBe(201);
  });

  // 404 — cross-user
  it('user A targeting user B program returns 404', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/user-programs/${userBProgramId}/start?intent=normal`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { start_date: '2026-06-01', start_tz: 'UTC' },
    });
    expect(r.statusCode).toBe(404);
  });
});
