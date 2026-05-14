// Beta W1.2 — set_logs integration-test fixtures.
//
// CONCURRENCY: every helper mints fresh crypto.randomUUID()s (email, slug, run
// names) so parallel test files cannot collide on UNIQUE indexes. Callers
// push returned handles into a per-suite list and afterEach calls
// cleanupSeeded(list) — cascading DELETEs on users wipe child rows.
//
// Why we don't reuse mkUser+mkUserProgram from program-fixtures.ts: this
// helper additionally needs a (mesocycle_run, day_workout, planned_set) chain
// to attach set_logs to, plus a real bearer token. Inlining the SQL keeps the
// fixture self-contained and free of any HTTP/fork dependency — useful because
// W1.2 PATCH/DELETE/GET will lean on the same helpers and shouldn't need an
// `await app.inject` round-trip just to seed data.

import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../../src/db/client.js';

export interface SeedHandle {
  userId: string;
  bearer: string;
  userProgramId: string;
  mesocycleRunId: string;
  dayWorkoutId: string;
  plannedSetId: string;
  exerciseId: string;
}

export interface SeedHandleWithLog extends SeedHandle {
  setLogId: string;
}

export interface SeedHandleWithLogs extends SeedHandle {
  setLogIds: string[];
}

// ---------------------------------------------------------------------------
// mintBearer — INSERT a device_tokens row that the production auth middleware
// (api/src/middleware/auth.ts) will accept. Token format is
// "<16-hex-prefix>.<64-hex-secret>"; stored as "<prefix>:<argon2hash-of-secret>".
// ---------------------------------------------------------------------------
export async function mintBearer(opts: {
  userId: string;
  scopes?: string[];
  label?: string;
}): Promise<{ bearer: string; userId: string }> {
  const prefix = randomBytes(8).toString('hex'); // 16 hex chars
  const secret = randomBytes(32).toString('hex'); // 64 hex chars
  const bearer = `${prefix}.${secret}`;
  const hash = await argon2.hash(secret);
  const stored = `${prefix}:${hash}`;
  const scopes = opts.scopes ?? ['health:weight:write'];
  await db.query(
    `INSERT INTO device_tokens (user_id, token_hash, scopes, label)
     VALUES ($1, $2, $3::text[], $4)`,
    [opts.userId, stored, scopes, opts.label ?? 'seed-fixture'],
  );
  return { bearer, userId: opts.userId };
}

// ---------------------------------------------------------------------------
// seedUserAndMintBearer — minimal "user + bearer" seed for tests that don't
// need a mesocycle/program chain (e.g. scope-enforcement W1.4.0). Returns a
// SeedHandle-compatible shape (with empty program/meso/etc. ids) so the
// shared cleanupSeeded() can wipe it via the cascading DELETE on users.
// ---------------------------------------------------------------------------
export async function seedUserAndMintBearer(opts: {
  scopes: string[];
  label?: string;
}): Promise<{ bearer: string; userId: string; handle: SeedHandle }> {
  const userTag = randomUUID();
  const email = `scope-fixture.${userTag}@repos.test`;
  const { rows: [u] } = await db.query<{ id: string }>(
    `INSERT INTO users (email, timezone) VALUES ($1, 'UTC') RETURNING id`,
    [email],
  );
  const userId = u.id;
  const { bearer } = await mintBearer({
    userId,
    scopes: opts.scopes,
    label: opts.label ?? 'scope-fixture',
  });
  // cleanupSeeded only needs userId; everything else cascades or is unused.
  // The empty-string placeholders keep the SeedHandle shape without forcing
  // callers to invent UUIDs for fields they don't touch.
  const handle: SeedHandle = {
    userId,
    bearer,
    userProgramId: '',
    mesocycleRunId: '',
    dayWorkoutId: '',
    plannedSetId: '',
    exerciseId: '',
  };
  return { bearer, userId, handle };
}

// ---------------------------------------------------------------------------
// seedUserWithMesocycle — builds the full chain a set_log needs:
//   users → user_programs → mesocycle_runs → day_workouts → planned_sets
// The planned_set references a real seeded exercise (picked via
// SELECT id FROM exercises LIMIT 1 — stable across runs because the seed
// runner is idempotent and at least one exercise has existed since migration
// 013's seed_key backfill).
//
// Returns a bearer token already minted for the user so tests can hit the
// /api/set-logs route immediately.
// ---------------------------------------------------------------------------
export async function seedUserWithMesocycle(): Promise<SeedHandle> {
  const userTag = randomUUID();
  const email = `setlogs-fixture.${userTag}@repos.test`;

  // 1. User. Goal column was added in migration 026 with a NOT NULL default,
  //    so we don't have to specify it; same for timezone.
  const { rows: [u] } = await db.query<{ id: string }>(
    `INSERT INTO users (email, timezone) VALUES ($1, 'America/New_York')
     RETURNING id`,
    [email],
  );
  const userId = u.id;

  // 2. Bearer token. The route currently only checks the auth middleware (not
  //    scopes), but we still ask for the canonical scope so future scope-
  //    gating doesn't silently rebuild fixtures.
  const { bearer } = await mintBearer({ userId, scopes: ['health:weight:write'] });

  // 3. Pick any seeded exercise.
  const { rows: ex } = await db.query<{ id: string }>(
    `SELECT id FROM exercises LIMIT 1`,
  );
  if (ex.length === 0) {
    throw new Error(
      'seedUserWithMesocycle: no exercises in DB. Run `npm run seed` in api/.',
    );
  }
  const exerciseId = ex[0].id;

  // 4. program_template — minimal valid shape. The structure JSONB is unused
  //    by W1.2 routes (no fork happens here); we only need a row that
  //    user_programs.template_id can FK to.
  const slug = `setlogs-tpl-${userTag}`;
  const structure = { _v: 1, days: [] };
  const { rows: [tpl] } = await db.query<{ id: string }>(
    `INSERT INTO program_templates
       (slug, name, weeks, days_per_week, structure, version, created_by)
     VALUES ($1, $2, 1, 1, $3::jsonb, 1, 'system')
     RETURNING id`,
    [slug, `Seed ${userTag}`, JSON.stringify(structure)],
  );

  // 5. user_program.
  const { rows: [up] } = await db.query<{ id: string }>(
    `INSERT INTO user_programs (user_id, template_id, template_version, name, status)
     VALUES ($1, $2, 1, $3, 'active')
     RETURNING id`,
    [userId, tpl.id, `Seed Program ${userTag}`],
  );
  const userProgramId = up.id;

  // 6. mesocycle_run. Partial unique index allows multiple active runs per
  //    user only if filtered out, but here we have one user per fixture so
  //    a single 'active' is fine.
  const { rows: [mr] } = await db.query<{ id: string }>(
    `INSERT INTO mesocycle_runs
       (user_program_id, user_id, start_date, start_tz, weeks, current_week, status)
     VALUES ($1, $2, CURRENT_DATE, 'America/New_York', 1, 1, 'active')
     RETURNING id`,
    [userProgramId, userId],
  );
  const mesocycleRunId = mr.id;

  // 7. day_workout.
  const { rows: [dw] } = await db.query<{ id: string }>(
    `INSERT INTO day_workouts
       (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
     VALUES ($1, 0, 0, CURRENT_DATE, 'strength', 'Seed Day')
     RETURNING id`,
    [mesocycleRunId],
  );
  const dayWorkoutId = dw.id;

  // 8. planned_set. target_rir must be >= 1 (Q4 hard ban on RIR 0).
  const { rows: [ps] } = await db.query<{ id: string }>(
    `INSERT INTO planned_sets
       (day_workout_id, block_idx, set_idx, exercise_id,
        target_reps_low, target_reps_high, target_rir, rest_sec)
     VALUES ($1, 0, 0, $2, 5, 8, 2, 120)
     RETURNING id`,
    [dayWorkoutId, exerciseId],
  );
  const plannedSetId = ps.id;

  return {
    userId,
    bearer,
    userProgramId,
    mesocycleRunId,
    dayWorkoutId,
    plannedSetId,
    exerciseId,
  };
}

// ---------------------------------------------------------------------------
// seedUserWithLoggedSet — seedUserWithMesocycle plus a single pre-existing
// set_log on the planned_set. opts.minutesAgo controls performed_at so PATCH/
// DELETE tests can simulate "logged 25 minutes ago" vs "logged 25 hours ago"
// for the 24h audit-window contract (W1.2 PATCH/DELETE).
// ---------------------------------------------------------------------------
export async function seedUserWithLoggedSet(opts: {
  minutesAgo: number;
}): Promise<SeedHandleWithLog> {
  const base = await seedUserWithMesocycle();
  const { rows: [log] } = await db.query<{ id: string }>(
    `INSERT INTO set_logs
       (user_id, exercise_id, planned_set_id, client_request_id,
        performed_load_lbs, performed_reps, performed_rir,
        performed_at)
     VALUES ($1, $2, $3, gen_random_uuid(),
        200.0, 5, 2,
        now() - ($4 || ' minutes')::interval)
     RETURNING id`,
    [base.userId, base.exerciseId, base.plannedSetId, String(opts.minutesAgo)],
  );
  return { ...base, setLogId: log.id };
}

// ---------------------------------------------------------------------------
// seedThreeLogsOnSamePlannedSet — three set_logs on the same planned_set, at
// 1/2/3 minutes ago. Useful for the W1.2 GET list test (ordering, count).
// Each log gets a distinct client_request_id and a distinct minute bucket so
// the unique indices don't trip.
// ---------------------------------------------------------------------------
export async function seedThreeLogsOnSamePlannedSet(): Promise<SeedHandleWithLogs> {
  const base = await seedUserWithMesocycle();
  const ids: string[] = [];
  for (const minutesAgo of [1, 2, 3]) {
    const { rows: [r] } = await db.query<{ id: string }>(
      `INSERT INTO set_logs
         (user_id, exercise_id, planned_set_id, client_request_id,
          performed_load_lbs, performed_reps, performed_rir,
          performed_at)
       VALUES ($1, $2, $3, gen_random_uuid(),
          $4, 5, 2,
          now() - ($5 || ' minutes')::interval)
       RETURNING id`,
      [base.userId, base.exerciseId, base.plannedSetId, 100 + minutesAgo, String(minutesAgo)],
    );
    ids.push(r.id);
  }
  return { ...base, setLogIds: ids };
}

// ---------------------------------------------------------------------------
// cleanupSeeded — cascading DELETE on users removes everything that hangs off
// them (device_tokens, user_programs → mesocycle_runs → day_workouts →
// planned_sets → set_logs). We additionally drop the per-seed
// program_templates rows because templates aren't owned by users.
// ---------------------------------------------------------------------------
export async function cleanupSeeded(
  handles: SeedHandle | SeedHandle[],
): Promise<void> {
  const list = Array.isArray(handles) ? handles : [handles];
  if (list.length === 0) return;
  const userIds = list.map((h) => h.userId);
  const templateIds = await db.query<{ template_id: string | null }>(
    `SELECT template_id FROM user_programs WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  const tplIds = templateIds.rows
    .map((r) => r.template_id)
    .filter((x): x is string => !!x);
  if (tplIds.length > 0) {
    await db.query(`DELETE FROM program_templates WHERE id = ANY($1::uuid[])`, [
      tplIds,
    ]);
  }
}
