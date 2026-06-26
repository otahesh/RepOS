// api/tests/integration/account-deletion-cascade.test.ts
//
// Beta W6 Task 9 — DELETE /api/me full-cascade integration.
//
// Spec note: the original task draft showed a `mintCfAccessJwt(email)` helper
// that doesn't exist as documented. The route is CF-Access-JWT-only (per
// C-SIGNOUT-CFACCESS-ONLY), same as Task 8's signout-everywhere — bearer auth
// must NEVER trigger account deletion. We use `setupTestJwks` (Task 5b + Task 8)
// to mint a real RS256 JWT against a local JWKS server and call DELETE via the
// CF_Authorization cookie path. PUBLIC_ORIGIN is set so the chained
// csrfOrigin preHandler passes (csrfOrigin fails closed when unset, even with
// X-RepOS-CSRF).
//
// Cases:
//   1. Happy path: 204, every CASCADE_WIPED_TABLES row for the user is gone,
//      account_events row SURVIVES with user_id NULL but user_id_at_event +
//      user_email_at_event preserved (D8).
//   2. Bearer rejected: Authorization: Bearer on DELETE /me returns 403 (per
//      requireCfAccessOnly), user row still exists, dependent rows untouched.
//   3. Bad confirm: wrong confirm phrase returns 400, no deletion.
//
// Seeded tables (verified against migrations under api/src/db/migrations):
//   - device_tokens                                (002)
//   - health_weight_samples                        (003)
//   - health_sync_status                           (004)
//   - user_programs → mesocycle_runs → day_workouts → planned_sets → set_logs (016/017/018/019/022/029)
//   - health_workouts                              (030)
//   - user_injuries                                (032)
//   - recovery_flag_dismissals                     (024)
//   - recovery_flag_events                         (033)
//   - account_events (explicit pre-delete row for D8 survival assertion)  (060)

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { setupTestJwks, type TestJwksHandle } from '../helpers/cf-access-jwt.js';

const TEST_EMAIL = `vitest.w6-delete-${Math.random().toString(36).slice(2, 10)}@repos.test`;

let app: Awaited<ReturnType<typeof buildApp>>;
let jwks: TestJwksHandle;
let userId: string;
let userJwt: string;
let savedPublicOrigin: string | undefined;
let templateId: string;
let mesocycleRunId: string;

// The tables we expect to be fully wiped for the user after DELETE /api/me.
// account_events is INTENTIONALLY excluded (D8 — survives with user_id=NULL).
const CASCADE_WIPED_TABLES = [
  'set_logs',
  'health_weight_samples',
  'health_sync_status',
  'health_workouts',
  'device_tokens',
  'user_programs',
  'mesocycle_runs',
  'user_injuries',
  'recovery_flag_dismissals',
  'recovery_flag_events',
] as const;

async function countForUser(table: string, uid: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int n FROM ${table} WHERE user_id=$1`,
    [uid],
  );
  return rows[0]?.n ?? 0;
}

async function seedUserContents(): Promise<void> {
  // 1. 30 health_weight_samples (distinct sample_date per UNIQUE constraint).
  for (let i = 0; i < 30; i++) {
    await db.query(
      `INSERT INTO health_weight_samples (user_id, sample_date, sample_time, weight_lbs, source)
       VALUES ($1, CURRENT_DATE - $2::int, '08:00:00', 180.0, 'Manual')`,
      [userId, i],
    );
  }

  // 2. health_sync_status — PK is user_id so one row max.
  await db.query(
    `INSERT INTO health_sync_status (user_id, source, last_fired_at)
     VALUES ($1, 'Apple Health', now())`,
    [userId],
  );

  // 3. 5 health_workouts (distinct started_at).
  for (let i = 0; i < 5; i++) {
    await db.query(
      `INSERT INTO health_workouts
         (user_id, started_at, ended_at, modality, duration_sec, source)
       VALUES ($1, now() - ($2 || ' hours')::interval,
               now() - ($2 || ' hours')::interval + interval '30 minutes',
               'walk', 1800, 'Manual')`,
      [userId, String(i + 1)],
    );
  }

  // 4. user_programs → mesocycle_runs → day_workouts → planned_sets → set_logs.
  const tplSlug = `delete-cascade-tpl-${randomUUID()}`;
  const {
    rows: [tpl],
  } = await db.query<{ id: string }>(
    `INSERT INTO program_templates
       (slug, name, weeks, days_per_week, structure, version, created_by)
     VALUES ($1, 'Delete Cascade Tpl', 1, 1, '{"_v":1,"days":[]}'::jsonb, 1, 'system')
     RETURNING id`,
    [tplSlug],
  );
  templateId = tpl.id;

  const {
    rows: [up],
  } = await db.query<{ id: string }>(
    `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
     VALUES ($1, $2, 1, 'Cascade Program', 'active') RETURNING id`,
    [userId, templateId],
  );

  const {
    rows: [mr],
  } = await db.query<{ id: string }>(
    `INSERT INTO mesocycle_runs
       (user_program_id, user_id, start_date, start_tz, weeks, current_week, status)
     VALUES ($1, $2, CURRENT_DATE, 'UTC', 1, 1, 'active')
     RETURNING id`,
    [up.id, userId],
  );
  mesocycleRunId = mr.id;

  const {
    rows: [dw],
  } = await db.query<{ id: string }>(
    `INSERT INTO day_workouts
       (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
     VALUES ($1, 1, 0, CURRENT_DATE, 'strength', 'Cascade Day')
     RETURNING id`,
    [mesocycleRunId],
  );

  // Pick any seeded exercise (matches seed-fixtures helper pattern).
  const { rows: ex } = await db.query<{ id: string }>(`SELECT id FROM exercises LIMIT 1`);
  if (ex.length === 0) {
    throw new Error('seed: no exercises in DB. Run `npm run seed` in api/.');
  }
  const exerciseId = ex[0].id;

  const {
    rows: [ps],
  } = await db.query<{ id: string }>(
    `INSERT INTO planned_sets
       (day_workout_id, block_idx, set_idx, exercise_id,
        target_reps_low, target_reps_high, target_rir, rest_sec)
     VALUES ($1, 0, 0, $2, 5, 8, 2, 120) RETURNING id`,
    [dw.id, exerciseId],
  );

  // 100 set_logs. Use crypto.randomUUID() (Node) for client_request_id so we
  // don't depend on pgcrypto's gen_random_uuid being installed; performed_at
  // staggered by minutes so set_logs_minute_dedupe_key doesn't trip.
  for (let i = 0; i < 100; i++) {
    await db.query(
      `INSERT INTO set_logs
         (user_id, exercise_id, planned_set_id, client_request_id,
          performed_load_lbs, performed_reps, performed_rir, performed_at)
       VALUES ($1, $2, $3, $4,
               200.0, 5, 2,
               now() - ($5 || ' minutes')::interval)`,
      [userId, exerciseId, ps.id, randomUUID(), String(i + 1)],
    );
  }

  // 5. user_injuries — one row.
  await db.query(
    `INSERT INTO user_injuries (user_id, joint, severity, notes)
     VALUES ($1, 'shoulder_left', 'mod', '')`,
    [userId],
  );

  // 6. recovery_flag_dismissals — one row.
  await db.query(
    `INSERT INTO recovery_flag_dismissals (user_id, flag, week_start)
     VALUES ($1, 'overreaching', date_trunc('week', current_date)::date)`,
    [userId],
  );

  // 7. recovery_flag_events — one row.
  await db.query(
    `INSERT INTO recovery_flag_events (user_id, flag, week_start, event_type)
     VALUES ($1, 'overreaching', date_trunc('week', current_date)::date, 'shown')`,
    [userId],
  );

  // 8. Two device_tokens via the admin path (so they're real, scope-valid rows
  // that future tests could call with). We don't keep the plaintext — only the
  // count needs to drop to zero after delete.
  for (const label of ['cascade-A', 'cascade-B']) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: userId, label, scopes: ['health:weight:write'] },
    });
    if (r.statusCode !== 201) {
      throw new Error(`token mint failed: ${r.statusCode} ${r.body}`);
    }
  }

  // 9. Pre-existing account_events row — D8 invariant says this SURVIVES the
  // cascade with user_id NULLed but the *_at_event snapshot columns preserved.
  await db.query(
    `INSERT INTO account_events
       (user_id, user_id_at_event, user_email_at_event, kind, ip, meta)
     VALUES ($1, $1, $2, 'profile_changed', '127.0.0.1', '{"fields":["display_name"]}'::jsonb)`,
    [userId, TEST_EMAIL],
  );
}

beforeAll(async () => {
  // csrfOrigin fails closed when PUBLIC_ORIGIN is unset on the cf_access path
  // even with the X-RepOS-CSRF header. Same pattern as the signout test.
  savedPublicOrigin = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = 'https://repos.test.example';

  jwks = await setupTestJwks();
  app = await buildApp();

  // Pre-create the user so admin-path /api/tokens mints work without going
  // through CF Access auto-provisioning. CF Access JWT path will then resolve
  // by email lookup to this same row.
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, timezone) VALUES ($1, 'UTC') RETURNING id`,
    [TEST_EMAIL],
  );
  userId = rows[0].id;

  await seedUserContents();
  userJwt = await jwks.mintJwt(TEST_EMAIL);
});

afterAll(async () => {
  // Belt-and-suspenders cleanup. If the happy-path case ran, most of this is
  // a no-op; if a case errored partway through, we still leave a clean corpus.
  await db.query(`DELETE FROM account_events WHERE user_id_at_event = $1`, [userId]);
  // mesocycle_runs cascades from user_programs, day_workouts/planned_sets/set_logs
  // cascade from mesocycle_runs, device_tokens/health_*/user_injuries/recovery_*
  // cascade from users — so DELETE users is enough except for the templates we
  // own.
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  if (templateId) {
    await db.query(`DELETE FROM program_templates WHERE id = $1`, [templateId]);
  }
  await app.close();
  await jwks.teardown();
  if (savedPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = savedPublicOrigin;
});

describe('DELETE /api/me — full cascade', () => {
  it('bad confirm phrase → 400, no deletion', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: {
        cookie: `CF_Authorization=${userJwt}`,
        'x-repos-csrf': '1',
        'content-type': 'application/json',
      },
      payload: { confirm: 'delete my account' }, // wrong case
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_confirm');

    // User row still exists, child rows untouched.
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE id=$1`,
      [userId],
    );
    expect(rows[0].n).toBe(1);
    expect(await countForUser('set_logs', userId)).toBe(100);
    expect(await countForUser('device_tokens', userId)).toBe(2);
  });

  it('Bearer token on DELETE /me is rejected (403), no deletion', async () => {
    // Mint a real bearer via admin path — it should NOT be honoured for
    // DELETE /me. requireCfAccessOnly 403s any Authorization: Bearer.
    const mint = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      body: { user_id: userId, label: 'bearer-reject', scopes: ['health:weight:write'] },
    });
    expect(mint.statusCode).toBe(201);
    const bearer = mint.json<{ token: string }>().token;

    const r = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      payload: { confirm: 'DELETE my account' },
    });
    expect([401, 403]).toContain(r.statusCode);
    expect(r.json().error).toBe('cf_access_required');

    // User row still exists.
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE id=$1`,
      [userId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('valid CF Access JWT + correct confirm → 204, full cascade, account_events survives', async () => {
    // Sanity precondition — all the seeded counts are non-zero before delete.
    expect(await countForUser('set_logs', userId)).toBe(100);
    expect(await countForUser('health_weight_samples', userId)).toBe(30);
    expect(await countForUser('health_sync_status', userId)).toBe(1);
    expect(await countForUser('health_workouts', userId)).toBe(5);
    expect(await countForUser('user_programs', userId)).toBe(1);
    expect(await countForUser('mesocycle_runs', userId)).toBe(1);
    expect(await countForUser('user_injuries', userId)).toBe(1);
    expect(await countForUser('recovery_flag_dismissals', userId)).toBe(1);
    expect(await countForUser('recovery_flag_events', userId)).toBe(1);
    // device_tokens — 3 total (2 from seed + 1 from the bearer-reject case).
    expect(await countForUser('device_tokens', userId)).toBe(3);

    const r = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: {
        cookie: `CF_Authorization=${userJwt}`,
        'x-repos-csrf': '1',
        'content-type': 'application/json',
      },
      payload: { confirm: 'DELETE my account' },
    });
    expect(r.statusCode).toBe(204);

    // Set-Cookie clears CF_Authorization — same shape as signout-everywhere.
    const setCookie = r.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('\n') : (setCookie ?? '');
    expect(cookieStr).toMatch(/CF_Authorization=;.*Max-Age=0/i);
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/Secure/i);
    expect(cookieStr).toMatch(/SameSite=Lax/i);
    expect(cookieStr).toMatch(/Path=\//i);

    // users row is gone.
    const { rows: u } = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM users WHERE id=$1`,
      [userId],
    );
    expect(u[0].n).toBe(0);

    // Every CASCADE_WIPED table is at zero rows for this user_id.
    for (const tbl of CASCADE_WIPED_TABLES) {
      expect(await countForUser(tbl, userId)).toBe(0);
    }

    // D8 — account_events SURVIVES with user_id=NULL but the snapshot columns
    // (user_id_at_event, user_email_at_event) still pointing at the original
    // identity. The pre-seeded profile_changed row is the witness.
    const { rows: ev } = await db.query<{
      user_id: string | null;
      user_id_at_event: string | null;
      user_email_at_event: string | null;
      kind: string;
    }>(
      `SELECT user_id::text, user_id_at_event::text, user_email_at_event, kind
         FROM account_events
        WHERE user_id_at_event = $1`,
      [userId],
    );
    // At minimum the profile_changed seed row should survive. (The route does
    // NOT itself emit a delete-cascade audit row before DROP — once `users` is
    // DELETEd the FK action runs synchronously and any same-txn INSERT we'd
    // make would itself be SET NULL'd. We keep the pre-existing row as the
    // forensic anchor.)
    expect(ev.length).toBeGreaterThanOrEqual(1);
    const survivor = ev.find((e) => e.kind === 'profile_changed');
    expect(survivor).toBeDefined();
    expect(survivor!.user_id).toBeNull();
    expect(survivor!.user_id_at_event).toBe(userId);
    expect(survivor!.user_email_at_event).toBe(TEST_EMAIL);
  });
});
