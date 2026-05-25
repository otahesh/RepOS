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

  // 2. Bearer token. Scope-gated per W1 reviewer matrix: set_logs routes
  //    require `set_logs:write` (added to VALID_SCOPES alongside the existing
  //    health:* scopes). Tests that need to assert cross-scope rejection mint
  //    a parallel wrong-scope bearer with mintBearer(...).
  //
  //    [FIX-28 / Task 12.5] Additive `health:recovery:read` so seeds that
  //    transitively hit /api/recovery-flags (e.g. seedUserOverreaching for the
  //    recovery_flag_events telemetry test) keep passing once Task 12.5's
  //    scope gate lands. Scope-rejection tests that need a bearer WITHOUT
  //    set_logs:write or WITHOUT health:recovery:read still mint parallel
  //    wrong-scope bearers via mintBearer(...).
  const { bearer } = await mintBearer({
    userId,
    scopes: ['set_logs:write', 'health:recovery:read'],
  });

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

  // 7. day_workout. week_idx is 1-indexed per the mesocycles schema (min 1) —
  // the volume rollup service iterates 1..nWeeks and would otherwise drop
  // this fixture's day_workouts when filtering by week_idx.
  const { rows: [dw] } = await db.query<{ id: string }>(
    `INSERT INTO day_workouts
       (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name)
     VALUES ($1, 1, 0, CURRENT_DATE, 'strength', 'Seed Day')
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
// addThreeDistinctSessions — inserts 2 additional (day_workouts, planned_sets)
// pairs on the same mesocycle_run as `seed`, pointing to the same exercise.
// Returns array of 3 sessions (the seeded one + 2 new) with their
// plannedSetId + dayWorkoutId. The caller inserts set_logs against these
// to build a multi-session history for evaluators (W3.1 stalled-PR).
//
// Existing seedUserWithMesocycle creates day_workout (week_idx=1, day_idx=0)
// because the volume-rollup service iterates week_idx 1..nWeeks. We add two
// more at (week_idx=1, day_idx=1) and (week_idx=1, day_idx=2) so the
// UNIQUE (mesocycle_run_id, week_idx, day_idx) constraint isn't violated and
// they sit on the same week as the seed.
// ---------------------------------------------------------------------------
export async function addThreeDistinctSessions(seed: SeedHandle): Promise<Array<{
  plannedSetId: string;
  dayWorkoutId: string;
}>> {
  const { mesocycleRunId, dayWorkoutId, plannedSetId } = seed;
  const sessions: Array<{ plannedSetId: string; dayWorkoutId: string }> = [
    { plannedSetId, dayWorkoutId },
  ];
  for (let i = 1; i < 3; i++) {
    const { rows: [dw] } = await db.query<{ id: string }>(
      `INSERT INTO day_workouts (mesocycle_run_id, week_idx, day_idx, scheduled_date, kind, name, status)
       SELECT $1, 1, $2::int, CURRENT_DATE + $2::int, kind, name, 'completed'
       FROM day_workouts WHERE id = $3
       RETURNING id`,
      [mesocycleRunId, i, dayWorkoutId],
    );
    const { rows: [ps] } = await db.query<{ id: string }>(
      `INSERT INTO planned_sets
         (day_workout_id, block_idx, set_idx, exercise_id,
          target_reps_low, target_reps_high, target_rir, rest_sec)
       SELECT $1, block_idx, set_idx, exercise_id,
              target_reps_low, target_reps_high, target_rir, rest_sec
       FROM planned_sets WHERE id = $2
       RETURNING id`,
      [dw.id, plannedSetId],
    );
    sessions.push({ plannedSetId: ps.id, dayWorkoutId: dw.id });
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// seedStalledPr — sets up a SeedHandle whose set_logs reflect one of 5
// patterns for the W3.1 stalled-PR evaluator to triage. Pattern semantics:
//
//   'stalled'      — 3 identical RIR-0 sessions (8 reps @ 225 lbs, 0 RIR)
//   'progressing'  — last session jumps load to 235 (PR fired, not stalled)
//   'rir-mixed'    — middle session has RIR=2 (not max effort)
//   'deload'       — mesocycle_runs.current_week === weeks (last week)
//   'low-rep'      — sessions at 3 reps (strength range, FIX-25 gates this)
//
// Non-deload patterns force weeks=4 + current_week=2 so the evaluator's
// deload guard (current_week >= weeks, see FIX-24 ADAPTED in
// stalledPrEvaluator) doesn't trip. The base seedUserWithMesocycle creates
// weeks=1 + current_week=1 which would always look like a deload.
// ---------------------------------------------------------------------------
export async function seedStalledPr(opts: {
  pattern: 'stalled' | 'progressing' | 'rir-mixed' | 'deload' | 'low-rep';
}): Promise<SeedHandle> {
  const seed = await seedUserWithMesocycle();
  const { userId, mesocycleRunId, exerciseId } = seed;

  if (opts.pattern === 'deload') {
    // [FIX-24 ADAPTED] Last week of mesocycle = deload. Force
    // current_week === weeks. The base seed already has weeks=1
    // current_week=1, so this is a no-op, but assert explicitly for clarity.
    await db.query(
      `UPDATE mesocycle_runs SET weeks = 4, current_week = 4 WHERE id = $1`,
      [mesocycleRunId],
    );
  } else {
    // Make sure we're NOT in the last week (current_week < weeks).
    await db.query(
      `UPDATE mesocycle_runs SET weeks = 4, current_week = 2 WHERE id = $1`,
      [mesocycleRunId],
    );
  }

  const sessions = await addThreeDistinctSessions(seed);

  const baseLoad = 225;
  const baseReps = opts.pattern === 'low-rep' ? 3 : 8;
  // Order: i=0 oldest (3 days ago), i=2 most recent (1 day ago).
  for (let i = 0; i < 3; i++) {
    let load = baseLoad;
    const reps = baseReps;
    let rir = 0;
    if (opts.pattern === 'progressing' && i === 2) load = 235;
    if (opts.pattern === 'rir-mixed' && i === 1) rir = 2;
    await db.query(
      `INSERT INTO set_logs
         (user_id, exercise_id, planned_set_id, client_request_id,
          performed_load_lbs, performed_reps, performed_rir,
          performed_at)
       VALUES ($1, $2, $3, gen_random_uuid(),
          $4, $5, $6,
          now() - ($7::int * INTERVAL '1 day'))`,
      [userId, exerciseId, sessions[i].plannedSetId, load, reps, rir, 3 - i],
    );
  }
  return seed;
}

// ---------------------------------------------------------------------------
// seedUserOverreaching — sets up a SeedHandle whose state satisfies BOTH
// conditions of the strict AND-gate overreaching evaluator:
//   (1) >= 3 RIR-0 sessions on COMPOUND exercises in the trailing 7d
//   (2) current-week performed_sets >= MAV for at least one worked muscle
//
// Compound = exercises.movement_pattern IN
//   ('squat','hinge','push_horizontal','push_vertical',
//    'pull_horizontal','pull_vertical').
// The base seedUserWithMesocycle picks `SELECT id FROM exercises LIMIT 1`,
// which is a compound (bench press et al. — they all use compound patterns;
// even isolation lifts like dumbbell-lateral-raise are tagged push_vertical
// in the enum because there's no canonical 'isolation' pattern). So the
// base seed already satisfies the compound check.
//
// MAV: with 6 set_logs × 3 sessions × 1.0 primary-muscle contribution = 18
// performed sets — enough to exceed the highest MAV landmark (side_delt=18).
// Most primary muscles have MAV <= 16, so 18 >= MAV reliably triggers.
//
// Timestamps are staggered (i+1 minutes ago) to avoid the
// set_logs_minute_dedupe_key UNIQUE index collision.
// ---------------------------------------------------------------------------
export async function seedUserOverreaching(): Promise<SeedHandle> {
  const seed = await seedUserWithMesocycle();
  // Ensure NOT in deload AND current_week aligns with the day_workouts'
  // week_idx so computeVolumeRollup → evaluator current-week lookup finds
  // populated volume. The base seed creates day_workouts at week_idx=1; the
  // overreaching evaluator looks up mesocycle_runs.current_week (=1) and
  // matches WeekVolume.week_idx=1. weeks=4 keeps current_week (1) < weeks
  // so the conservative "not deload" stance holds for parity with stalledPr.
  await db.query(
    `UPDATE mesocycle_runs SET weeks = 4, current_week = 1 WHERE id = $1`,
    [seed.mesocycleRunId],
  );
  const sessions = await addThreeDistinctSessions(seed);
  // 3 RIR-0 compound sessions in trailing 7d, each with enough sets to push
  // volume >= MAV on the primary muscle. Per-session minutes-ago is
  // (sessionIdx*10 + i) so the (planned_set_id, minute) dedupe key never
  // collides across the 6 sets within a session OR across the 3 sessions.
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 6; i++) {
      const minutesAgo = s * 10 + i + 1;
      await db.query(
        `INSERT INTO set_logs
           (user_id, exercise_id, planned_set_id, client_request_id,
            performed_load_lbs, performed_reps, performed_rir, performed_at)
         VALUES ($1, $2, $3, gen_random_uuid(),
            225, 8, 0,
            now() - ($4 || ' minutes')::interval)`,
        [seed.userId, seed.exerciseId, sessions[s].plannedSetId, String(minutesAgo)],
      );
    }
  }
  return seed;
}

// ---------------------------------------------------------------------------
// seedOverreachingPartial — sets up a SeedHandle that satisfies SOME but
// not ALL conditions of the overreaching evaluator. Used to test the
// strict AND-gate.
//
//   { rir0Sessions: 2 } — only 2 RIR-0 sessions (need 3); volume DOES hit MAV.
//   { exerciseType: 'isolation' } — 3 RIR-0 sessions but the planned_sets'
//                                   exercise is re-pointed to a non-compound
//                                   pattern (lunge/carry/rotation/etc.); the
//                                   evaluator's compound filter rejects it
//                                   even though volume + RIR still qualify.
//   { underMav: true } — 3 RIR-0 compound sessions but only 1 set per session
//                        (3 total) so volume stays well under any MAV.
// ---------------------------------------------------------------------------
export async function seedOverreachingPartial(opts: {
  rir0Sessions?: 2;
  exerciseType?: 'isolation';
  underMav?: true;
}): Promise<SeedHandle> {
  const seed = await seedUserWithMesocycle();
  await db.query(
    `UPDATE mesocycle_runs SET weeks = 4, current_week = 1 WHERE id = $1`,
    [seed.mesocycleRunId],
  );
  const sessions = await addThreeDistinctSessions(seed);

  // 'isolation' variant: re-point planned_sets + set_logs to an exercise whose
  // movement_pattern is NOT in the compound set. lunge/carry/rotation/etc.
  // exercises exist in seed (see api/src/seed/exercises.ts:625+).
  let exerciseIdForLogs = seed.exerciseId;
  if (opts.exerciseType === 'isolation') {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM exercises
       WHERE movement_pattern NOT IN
         ('squat','hinge','push_horizontal','push_vertical',
          'pull_horizontal','pull_vertical')
       LIMIT 1`,
    );
    if (rows.length === 0) {
      throw new Error(
        'seedOverreachingPartial: no non-compound exercise seeded — ' +
        'check api/src/seed/exercises.ts',
      );
    }
    exerciseIdForLogs = rows[0].id;
    for (const sess of sessions) {
      await db.query(
        `UPDATE planned_sets SET exercise_id = $1 WHERE id = $2`,
        [exerciseIdForLogs, sess.plannedSetId],
      );
    }
  }

  const numSessions = opts.rir0Sessions === 2 ? 2 : 3;
  const setsPerSession = opts.underMav ? 1 : 6;

  for (let s = 0; s < numSessions; s++) {
    for (let i = 0; i < setsPerSession; i++) {
      const minutesAgo = s * 10 + i + 1;
      await db.query(
        `INSERT INTO set_logs
           (user_id, exercise_id, planned_set_id, client_request_id,
            performed_load_lbs, performed_reps, performed_rir, performed_at)
         VALUES ($1, $2, $3, gen_random_uuid(),
            225, 8, 0,
            now() - ($4 || ' minutes')::interval)`,
        [seed.userId, exerciseIdForLogs, sessions[s].plannedSetId, String(minutesAgo)],
      );
    }
  }
  return seed;
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
