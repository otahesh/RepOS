// api/tests/integration/contamination/account-deletion-contamination.test.ts
//
// G2 contribution — DELETE /api/me must wipe ONLY the calling user's data.
// User A's delete must never touch user B's rows.
//
// Spec note: the original task draft showed `Authorization: Bearer ${tokenA}`
// on the DELETE call. That contradicts C-SIGNOUT-CFACCESS-ONLY (the route is
// CF-Access-JWT-only — a stolen bearer must NEVER delete an account). The
// route's requireCfAccessOnly preHandler 403s any Bearer header before JWT
// validation. We mint a real CF Access JWT for user A's email via
// setupTestJwks (Task 5b + Task 8 + Task 9) and call DELETE via the cookie
// path. PUBLIC_ORIGIN is set so the chained csrfOrigin guard passes.
//
// Asserts:
//   1. After A's DELETE, A's user row + A's device_tokens are gone.
//   2. B's user row, B's device_tokens, and B's set_logs are untouched.
//   3. account_events row for B remains intact (A's cascade can't reach into B).

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { db } from '../../../src/db/client.js';
import { setupTestJwks, type TestJwksHandle } from '../../helpers/cf-access-jwt.js';

const EMAIL_A = `vitest.w6-del-cont-a-${Math.random().toString(36).slice(2, 10)}@repos.test`;
const EMAIL_B = `vitest.w6-del-cont-b-${Math.random().toString(36).slice(2, 10)}@repos.test`;

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: TestJwksHandle;
let userA: string;
let userB: string;
let jwtA: string;
let savedPublicOrigin: string | undefined;
let exerciseId: string;
let plannedSetB: string;
let templateB: string;

beforeAll(async () => {
  savedPublicOrigin = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = 'https://repos.test.example';

  jwks = await setupTestJwks();
  app = await buildApp();

  // Pre-create both users.
  const a = await db.query<{ id: string }>(
    `INSERT INTO users (email, timezone) VALUES ($1, 'UTC') RETURNING id`,
    [EMAIL_A],
  );
  userA = a.rows[0].id;
  const b = await db.query<{ id: string }>(
    `INSERT INTO users (email, timezone) VALUES ($1, 'UTC') RETURNING id`,
    [EMAIL_B],
  );
  userB = b.rows[0].id;

  // Mint a real bearer for each user. Both bearers should remain valid for
  // their own user; only A's data is wiped after A's delete. (A's bearer
  // becomes invalid because device_tokens row goes away.)
  await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userA, label: 'A-desktop', scopes: ['health:weight:write'] },
  });
  await app.inject({
    method: 'POST',
    url: '/api/tokens',
    body: { user_id: userB, label: 'B-mobile', scopes: ['health:weight:write'] },
  });

  // Seed B with a deeper trail (program + set_log + account_event) so the
  // contamination check has real bytes to verify against. Reuses the same
  // template/exercise pattern as the cascade test.
  const { rows: ex } = await db.query<{ id: string }>(`SELECT id FROM exercises LIMIT 1`);
  if (ex.length === 0) {
    throw new Error('seed: no exercises in DB. Run `npm run seed` in api/.');
  }
  exerciseId = ex[0].id;

  const tplSlug = `del-cont-tpl-${randomUUID()}`;
  const {
    rows: [tpl],
  } = await db.query<{ id: string }>(
    `INSERT INTO program_templates
       (slug, name, weeks, days_per_week, structure, version, created_by)
     VALUES ($1, 'Del Cont Tpl', 1, 1, '{"_v":1,"days":[]}'::jsonb, 1, 'system')
     RETURNING id`,
    [tplSlug],
  );
  templateB = tpl.id;
  const {
    rows: [up],
  } = await db.query<{ id: string }>(
    `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
     VALUES ($1, $2, 1, 'B Program', 'active') RETURNING id`,
    [userB, templateB],
  );
  const {
    rows: [mr],
  } = await db.query<{ id: string }>(
    `INSERT INTO mesocycle_runs
       (user_program_id, user_id, start_date, start_tz, weeks, current_week, status)
     VALUES ($1, $2, CURRENT_DATE, 'UTC', 1, 1, 'active') RETURNING id`,
    [up.id, userB],
  );
  const {
    rows: [dw],
  } = await db.query<{ id: string }>(
    `INSERT INTO day_workouts
       (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
     VALUES ($1, 1, 0, CURRENT_DATE, 'strength', 'B Day') RETURNING id`,
    [mr.id],
  );
  const {
    rows: [ps],
  } = await db.query<{ id: string }>(
    `INSERT INTO planned_sets
       (day_workout_id, block_idx, set_idx, exercise_id,
        target_reps_low, target_reps_high, target_rir, rest_sec)
     VALUES ($1, 0, 0, $2, 5, 8, 2, 120) RETURNING id`,
    [dw.id, exerciseId],
  );
  plannedSetB = ps.id;
  await db.query(
    `INSERT INTO set_logs
       (user_id, exercise_id, planned_set_id, client_request_id,
        performed_load_lbs, performed_reps, performed_rir, performed_at)
     VALUES ($1, $2, $3, $4, 200.0, 5, 2, now())`,
    [userB, exerciseId, plannedSetB, randomUUID()],
  );
  await db.query(
    `INSERT INTO account_events
       (user_id, user_id_at_event, user_email_at_event, kind, ip, meta)
     VALUES ($1, $1, $2, 'profile_changed', '8.8.8.8', '{"fields":["display_name"]}'::jsonb)`,
    [userB, EMAIL_B],
  );

  // Also seed a few of A's own rows so we have something to verify is gone.
  await db.query(
    `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
     VALUES ($1, CURRENT_DATE, '08:00:00', 180.0, 'Manual')`,
    [userA],
  );

  jwtA = await jwks.mintJwt(EMAIL_A);
});

afterAll(async () => {
  // A is most likely already deleted; B and its template still need cleanup.
  await db.query(
    `DELETE FROM account_events WHERE user_id IN ($1,$2) OR user_id_at_event IN ($1,$2)`,
    [userA, userB],
  );
  await db.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
  if (templateB) {
    await db.query(`DELETE FROM program_templates WHERE id=$1`, [templateB]);
  }
  await app.close();
  await jwks.teardown();
  if (savedPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = savedPublicOrigin;
});

describe('DELETE /api/me contamination — G2', () => {
  it("A's CF Access delete wipes A only — B's user, tokens, set_logs, events intact", async () => {
    // Precondition — both users exist with their seeded content.
    const preA = await db.query<{ n: number }>(`SELECT count(*)::int n FROM users WHERE id=$1`, [
      userA,
    ]);
    expect(preA.rows[0].n).toBe(1);
    const preB = await db.query<{ n: number }>(`SELECT count(*)::int n FROM users WHERE id=$1`, [
      userB,
    ]);
    expect(preB.rows[0].n).toBe(1);

    // A deletes their account via the CF Access cookie path.
    const r = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: {
        cookie: `CF_Authorization=${jwtA}`,
        'x-repos-csrf': '1',
        'content-type': 'application/json',
      },
      payload: { confirm: 'DELETE my account' },
    });
    expect(r.statusCode).toBe(204);

    // A is gone — user row, device_tokens, health_weight_samples.
    const { rows: aUser } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE id=$1`,
      [userA],
    );
    expect(aUser[0].n).toBe(0);
    const { rows: aTok } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM device_tokens WHERE user_id=$1`,
      [userA],
    );
    expect(aTok[0].n).toBe(0);
    const { rows: aSamples } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM health_weight_samples WHERE user_id=$1`,
      [userA],
    );
    expect(aSamples[0].n).toBe(0);

    // B is untouched — user row, device_tokens, set_logs, account_events all
    // still there. This is the contamination invariant: A's cascade must not
    // reach across the user_id boundary.
    const { rows: bUser } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE id=$1`,
      [userB],
    );
    expect(bUser[0].n).toBe(1);
    const { rows: bTok } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM device_tokens WHERE user_id=$1 AND revoked_at IS NULL`,
      [userB],
    );
    expect(bTok[0].n).toBe(1);
    const { rows: bLogs } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM set_logs WHERE user_id=$1`,
      [userB],
    );
    expect(bLogs[0].n).toBe(1);
    const { rows: bEvents } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM account_events WHERE user_id=$1`,
      [userB],
    );
    expect(bEvents[0].n).toBe(1);
  });
});
