import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  mkUser,
  cleanupUser,
  mkTemplate,
  mkUserProgram,
  cleanupTemplate,
} from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string;
let token: string;
// program_templates are created_by='system' — cleanupUser does NOT cascade to
// them, so track + clean up here to avoid polluting the global template-count
// test in tests/programs.test.ts.
const templateIds: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  userId = (await mkUser({ prefix: 'vitest.w4-swapall' })).id;
  const t = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'a', scopes: ['program:write'] },
  });
  token = t.json<{ token: string }>().token;
});
afterAll(async () => {
  // Delete the user FIRST — cascades to user_programs, which RESTRICT-reference
  // program_templates via user_programs_template_id_fkey. Templates must be
  // dropped only after their referencing user_programs are gone.
  await cleanupUser(userId);
  for (const id of templateIds) await cleanupTemplate(id);
  await app.close();
});

describe('PATCH /user-programs/:id op=swap_exercise_all', () => {
  it('rewrites every block carrying from_slug across all weeks of the program', async () => {
    // Build a template with bench-press on day 0/block 0 AND day 2/block 0
    const tpl = await mkTemplate({
      prefix: 'vitest-w4-tpl',
      weeks: 4,
      structure: {
        _v: 1,
        days: [
          {
            idx: 0,
            day_offset: 0,
            kind: 'strength',
            name: 'Push',
            blocks: [
              {
                exercise_slug: 'bb-bench-press',
                mev: 2,
                mav: 3,
                target_reps_low: 6,
                target_reps_high: 10,
                target_rir: 2,
                rest_sec: 180,
              },
            ],
          },
          {
            idx: 1,
            day_offset: 1,
            kind: 'strength',
            name: 'Pull',
            blocks: [
              {
                exercise_slug: 'bb-row',
                mev: 2,
                mav: 3,
                target_reps_low: 6,
                target_reps_high: 10,
                target_rir: 2,
                rest_sec: 180,
              },
            ],
          },
          {
            idx: 2,
            day_offset: 3,
            kind: 'strength',
            name: 'Push2',
            blocks: [
              {
                exercise_slug: 'bb-bench-press',
                mev: 2,
                mav: 3,
                target_reps_low: 6,
                target_reps_high: 10,
                target_rir: 2,
                rest_sec: 180,
              },
            ],
          },
        ],
      },
    });
    templateIds.push(tpl.id);
    const up = await mkUserProgram({ userId, templateId: tpl.id, templateVersion: 1 });

    const r = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${up.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        op: 'swap_exercise_all',
        from_slug: 'bb-bench-press',
        to_exercise_slug: 'db-bench-press',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      customizations: { swaps_all: { from_slug: string; to_slug: string }[]; swaps: any[] };
    }>();
    const all = body.customizations.swaps_all ?? [];
    expect(all).toEqual(
      expect.arrayContaining([{ from_slug: 'bb-bench-press', to_slug: 'db-bench-press' }]),
    );
    // Both matching blocks (day 0 + day 2) get a week_idx:1 swap entry.
    const swaps = body.customizations.swaps ?? [];
    const benchSwaps = swaps.filter(
      (s) => s.from_slug === 'bb-bench-press' && s.to_slug === 'db-bench-press',
    );
    expect(benchSwaps).toHaveLength(2);
    expect(benchSwaps.map((s) => s.day_idx).sort()).toEqual([0, 2]);
  });

  it('returns 400 when from_slug never appears in the template', async () => {
    const tpl = await mkTemplate({
      prefix: 'vitest-w4-tpl2',
      weeks: 4,
      structure: {
        _v: 1,
        days: [
          {
            idx: 0,
            day_offset: 0,
            kind: 'strength',
            name: 'Push',
            blocks: [
              {
                exercise_slug: 'bb-bench-press',
                mev: 2,
                mav: 3,
                target_reps_low: 6,
                target_reps_high: 10,
                target_rir: 2,
                rest_sec: 180,
              },
            ],
          },
        ],
      },
    });
    templateIds.push(tpl.id);
    const up = await mkUserProgram({ userId, templateId: tpl.id, templateVersion: 1 });
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/user-programs/${up.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { op: 'swap_exercise_all', from_slug: 'lat-pulldown', to_exercise_slug: 'db-row' },
    });
    expect(r.statusCode).toBe(400);
  });
});
