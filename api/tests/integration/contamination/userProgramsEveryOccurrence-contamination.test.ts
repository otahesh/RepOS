/**
 * G2 contribution — cross-user contamination test for the new
 * `swap_exercise_all` op on PATCH /api/user-programs/:id (W4.1).
 *
 * The op rewrites multiple entries inside ONE user_programs.customizations
 * JSONB. Ownership is checked at the parent-row level (FOR UPDATE on
 * (id, user_id)). This test asserts the full 401/400/200/404 matrix per
 * [I-CONTAM-MATRIX-COMPLETE].
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { mkUser, cleanupUser, mkTemplate, mkUserProgram, cleanupTemplate } from '../../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userA: string; let tokenA: string;
let userB: string; let userBProgramId: string;
const templateIds: string[] = [];

function mkStruct() {
  return { _v: 1, days: [
    { idx: 0, day_offset: 0, kind: 'strength', name: 'D', blocks: [
      { exercise_slug: 'bb-bench-press', mev: 2, mav: 3, target_reps_low: 6, target_reps_high: 10, target_rir: 2, rest_sec: 180 },
    ]},
  ]};
}

beforeAll(async () => {
  app = await buildApp();
  userA = (await mkUser({ prefix: 'vitest.w4-eo-a' })).id;
  userB = (await mkUser({ prefix: 'vitest.w4-eo-b' })).id;
  const tpl = await mkTemplate({ prefix: 'vitest-w4-eo-tpl', weeks: 4, structure: mkStruct() });
  templateIds.push(tpl.id);
  const upB = await mkUserProgram({ userId: userB, templateId: tpl.id, templateVersion: 1 });
  userBProgramId = upB.id;
  const t = await app.inject({ method: 'POST', url: '/api/tokens',
    body: { user_id: userA, label: 'a', scopes: ['program:write'] } });
  tokenA = t.json<{ token: string }>().token;
});
afterAll(async () => {
  await cleanupUser(userA);
  await cleanupUser(userB);
  for (const id of templateIds) await cleanupTemplate(id);
  await app.close();
});

async function mkProgramForA(): Promise<string> {
  const tpl = await mkTemplate({ prefix: 'vitest-w4-eo-a-tpl', weeks: 4, structure: mkStruct() });
  templateIds.push(tpl.id);
  return (await mkUserProgram({ userId: userA, templateId: tpl.id, templateVersion: 1 })).id;
}

describe('swap_exercise_all contamination — G2 [I-CONTAM-MATRIX-COMPLETE]', () => {
  // 401 — missing bearer
  it('PATCH without bearer returns 401', async () => {
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${userBProgramId}`,
      payload: { op: 'swap_exercise_all', from_slug: 'bb-bench-press', to_exercise_slug: 'db-bench-press' },
    });
    expect([401, 403]).toContain(r.statusCode);
  });

  // 400 — malformed body
  it('PATCH with malformed body returns 400', async () => {
    const upA = await mkProgramForA();
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${upA}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { op: 'swap_exercise_all', from_slug: 'not a slug!', to_exercise_slug: 'db-bench-press' },
    });
    expect(r.statusCode).toBe(400);
  });

  // 200 — self-access (PATCH returns 200 — there is no 201 on this route)
  it('user A patching user A program returns 200', async () => {
    const upA = await mkProgramForA();
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${upA}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { op: 'swap_exercise_all', from_slug: 'bb-bench-press', to_exercise_slug: 'db-bench-press' },
    });
    expect(r.statusCode).toBe(200);
  });

  // 404 — cross-user
  it('user A patching user B program returns 404', async () => {
    const r = await app.inject({
      method: 'PATCH', url: `/api/user-programs/${userBProgramId}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { op: 'swap_exercise_all', from_slug: 'bb-bench-press', to_exercise_slug: 'db-bench-press' },
    });
    expect(r.statusCode).toBe(404);
  });
});
