// Beta W4 e2e clinical [I-W4-E2E-CLINICAL + C-LANDMARKS-ACTIVE-RUN].
//
// Ties landmark edits to (a) explicit evaluator fire/no-fire behavior and
// (b) active-run isolation: a mid-run PATCH /me/landmarks must NOT change the
// running mesocycle's volume-rollup thresholds (they read landmarks_snapshot).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser, mkTemplate, mkUserProgram, cleanupTemplate } from '../helpers/program-fixtures.js';
import { overreachingEvaluator } from '../../src/services/overreachingEvaluator.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string; let token: string;
const templateIds: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  userId = (await mkUser({ prefix: 'vitest.w4-clin' })).id;
  const t = await app.inject({ method: 'POST', url: '/api/tokens',
    body: { user_id: userId, label: 'a', scopes: ['program:write'] } });
  token = t.json<{ token: string }>().token;
});
afterAll(async () => {
  await cleanupUser(userId);
  for (const id of templateIds) await cleanupTemplate(id);
  await app.close();
});

async function freshProgram(): Promise<string> {
  const tpl = await mkTemplate({
    prefix: 'vitest-w4-clin-tpl', weeks: 4,
    structure: { _v: 1, days: [
      { idx: 0, day_offset: 0, kind: 'strength', name: 'D', blocks: [
        { exercise_slug: 'barbell-bench-press', mev: 4, mav: 6, target_reps_low: 6, target_reps_high: 10, target_rir: 2, rest_sec: 180 },
      ]},
    ]},
  });
  templateIds.push(tpl.id);
  return (await mkUserProgram({ userId, templateId: tpl.id, templateVersion: 1 })).id;
}

describe('W4 clinical e2e [I-W4-E2E-CLINICAL]', () => {
  it('hostile-but-passing landmarks → start normal run → overreaching evaluator does NOT fire (no logged RIR-0 sessions)', async () => {
    // 1. PATCH /me/landmarks to the highest LEGAL chest values (right at the
    //    clinical ceiling): chest seed mrv=22 → ceiling min(50, ceil(22*1.5))=33.
    const patch = await app.inject({
      method: 'PATCH', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` },
      payload: { overrides: { chest: { mev: 14, mav: 24, mrv: 33 } } },
    });
    expect(patch.statusCode).toBe(200);

    // 2. Start a normal run (snapshot captures the override).
    const up = await freshProgram();
    const start = await app.inject({
      method: 'POST', url: `/api/user-programs/${up}/start?intent=normal`,
      headers: { authorization: `Bearer ${token}` },
      payload: { start_date: '2026-06-01', start_tz: 'UTC' },
    });
    expect(start.statusCode).toBe(201);
    const runId = start.json<{ mesocycle_run_id: string }>().mesocycle_run_id;

    // 3+4. No set_logs exist → overreaching Condition 1 (>=3 RIR-0 compound
    //      sessions in 7d) is NOT met → evaluator must NOT fire. Explicit
    //      no-fire tied to the current evaluator math.
    const r = await overreachingEvaluator.evaluate({ userId, runId });
    expect(r.triggered).toBe(false);

    await db.query(`UPDATE mesocycle_runs SET status='completed', finished_at=now() WHERE id=$1`, [runId]);
    // Reset chest landmarks for the next test.
    await db.query(`UPDATE users SET muscle_landmarks='{"_v":1}'::jsonb WHERE id=$1`, [userId]);
  });

  it('PATCH /me/landmarks mid-active-run → volume-rollup unchanged on active run [C-LANDMARKS-ACTIVE-RUN]', async () => {
    // 1. Set a distinct chest override, then materialize a run so the snapshot
    //    captures THIS value (chest mav=20).
    await app.inject({
      method: 'PATCH', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` },
      payload: { overrides: { chest: { mev: 12, mav: 20, mrv: 28 } } },
    });
    const up = await freshProgram();
    const start = await app.inject({
      method: 'POST', url: `/api/user-programs/${up}/start?intent=normal`,
      headers: { authorization: `Bearer ${token}` },
      payload: { start_date: '2026-06-01', start_tz: 'UTC' },
    });
    const runId = start.json<{ mesocycle_run_id: string }>().mesocycle_run_id;

    // 2. Capture the rollup's chest MAV (read from snapshot).
    const r1 = await app.inject({ method: 'GET', url: `/api/mesocycles/${runId}/volume-rollup`,
      headers: { authorization: `Bearer ${token}` } });
    expect(r1.statusCode).toBe(200);
    const w1 = r1.json<{ weeks: Array<{ week_idx: number; muscles: Array<{ muscle: string; mav: number }> }> }>();
    const chest1 = w1.weeks.find(w => w.week_idx === 1)?.muscles.find(m => m.muscle === 'chest');
    expect(chest1?.mav).toBe(20);

    // 3. PATCH chest.mav to a DIFFERENT value mid-run.
    await app.inject({
      method: 'PATCH', url: '/api/users/me/landmarks',
      headers: { authorization: `Bearer ${token}` },
      payload: { overrides: { chest: { mev: 12, mav: 16, mrv: 28 } } },
    });

    // 4. Re-read the rollup — chest MAV must STILL be the materialize-time 20,
    //    not the new 16 (snapshot is the source of truth for an active run).
    const r2 = await app.inject({ method: 'GET', url: `/api/mesocycles/${runId}/volume-rollup`,
      headers: { authorization: `Bearer ${token}` } });
    const w2 = r2.json<{ weeks: Array<{ week_idx: number; muscles: Array<{ muscle: string; mav: number }> }> }>();
    const chest2 = w2.weeks.find(w => w.week_idx === 1)?.muscles.find(m => m.muscle === 'chest');
    expect(chest2?.mav).toBe(20);
    expect(chest2?.mav).not.toBe(16);

    await db.query(`UPDATE mesocycle_runs SET status='completed', finished_at=now() WHERE id=$1`, [runId]);
    await db.query(`UPDATE users SET muscle_landmarks='{"_v":1}'::jsonb WHERE id=$1`, [userId]);
  });
});
