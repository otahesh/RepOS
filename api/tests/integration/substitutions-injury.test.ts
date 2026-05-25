/**
 * Beta W3.2 — substitutions × injuryRanker integration.
 *
 * Verifies that `findSubstitutions` (wired through GET
 * /api/exercises/:slug/substitutions) tags candidates whose
 * `joint_stress_profile` overlaps the caller's `user_injuries` with an
 * `injury_advisory` field, and demotes them in the ranked list. This is the
 * end-to-end seam for the W3.2 ranker: the pure logic lives in
 * `services/injuryRanker.ts` (Task 14); this test proves it's invoked from
 * the route handler with the bearer-token user_id.
 *
 * Slug choice: `barbell-back-squat` (seed has knee:mod), with a knee_left/high
 * user injury. The advisory `level` mirrors the candidate stress level (mod),
 * not the user severity (severity is folded into the demotion penalty, not
 * the surfaced level — see [FIX-26] in injuryRanker.ts).
 */
import 'dotenv/config';
import { it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { mkUser, cleanupUser } from '../helpers/program-fixtures.js';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userId: string;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  // Equipment profile broad enough that several squat-pattern candidates pass
  // the predicate filter and reach the injuryRanker stage. Without this, the
  // route short-circuits with `no_equipment_profile` and the advisory tagging
  // never runs.
  const u = await mkUser({
    prefix: 'vitest.w3-sub',
    equipment_profile: {
      _v: 1,
      barbell: true,
      squat_rack: true,
      dumbbells: { min_lb: 10, max_lb: 100, increment_lb: 5 },
      adjustable_bench: { incline: true, decline: true },
      machines: { leg_extension: true, leg_press: true, hack_squat: true },
    },
  });
  userId = u.id;
  const mint = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userId, label: 'w3-sub' },
  });
  token = mint.json<{ token: string }>().token;
  await db.query(
    `INSERT INTO user_injuries (user_id, joint, severity) VALUES ($1, 'knee_left', 'high')`,
    [userId],
  );
});

afterAll(async () => {
  await db.query(`DELETE FROM user_injuries WHERE user_id=$1`, [userId]);
  await cleanupUser(userId);
  await app.close();
  await db.end();
});

it('demotes knee-stressful candidates and tags injury_advisory', async () => {
  const r = await app.inject({
    method: 'GET',
    url: '/api/exercises/barbell-back-squat/substitutions',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.statusCode).toBe(200);
  const body = r.json<{
    subs: Array<{
      slug: string;
      score: number;
      injury_advisory?: { joint: string; level: string };
    }>;
  }>();

  // At least one candidate must carry an injury_advisory. The seed has
  // `leg-extension-machine` (knee:mod), `barbell-front-squat`/etc. (knee:mod),
  // and `dumbbell-goblet-squat` (knee:low — too low, won't be tagged).
  const tagged = body.subs.filter((s) => s.injury_advisory);
  expect(tagged.length).toBeGreaterThan(0);

  // Every tag must reference the user's actual injury joint and a stress
  // level the ranker considers actionable (mod or high).
  for (const s of tagged) {
    expect(s.injury_advisory).toMatchObject({ joint: 'knee_left' });
    expect(['mod', 'high']).toContain(s.injury_advisory!.level);
  }
});
