import type { FastifyInstance } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { db } from '../db/client.js';
import { SetLogPostSchema, type SetLogRow } from '../schemas/setLogs.js';

// ---------------------------------------------------------------------------
// Beta W1.2 — set_logs routes.
//
// Auth: requireBearerOrCfAccess populates req.userId; identical contract to
// weight.ts. No new auth surface.
//
// IDOR: ownership of planned_set_id is verified via the planned_sets →
// day_workouts → mesocycle_runs.user_id chain. "Not found" and "not yours"
// collapse to the same 404 so the response can't be used as an existence
// oracle for another user's resource IDs.
//
// Idempotency: a single INSERT ... ON CONFLICT DO NOTHING covers both
// uniqueness probes from W1.1:
//   - set_logs_user_id_client_request_id_key — offline-queue replay safety
//   - set_logs_minute_dedupe_key (planned_set_id, date_trunc('minute',
//     performed_at, 'UTC')) — double-tap "I hit log twice" safety
// No probe-then-insert TOCTOU. On conflict the fallback SELECT walks both
// unique indices to surface whichever row matched.
// ---------------------------------------------------------------------------

// SELECT projection used by both the INSERT RETURNING and the conflict-path
// SELECT. The numeric(5,1) `performed_load_lbs` is cast to float because
// node-pg's default text parser hands NUMERIC back as a string and the API
// contract returns a JS number. SMALLINT performed_reps/performed_rir come
// back as numbers natively.
const SELECT_COLUMNS = `
  id, user_id, exercise_id, planned_set_id, client_request_id,
  performed_load_lbs::float AS weight_lbs,
  performed_reps             AS reps,
  performed_rir              AS rir,
  rpe, performed_at, notes, created_at, updated_at
`;

export async function setLogsRoutes(app: FastifyInstance) {
  app.post('/set-logs', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

    const parse = SetLogPostSchema.safeParse(req.body);
    if (!parse.success) {
      const issue = parse.error.issues[0];
      const field = issue.path[0]?.toString() ?? 'unknown';
      return reply.code(400).send({ error: issue.message, field });
    }
    const body = parse.data;

    // Ownership + exercise_id derivation. The join walks planned_sets →
    // day_workouts → mesocycle_runs to find the owning user. The check
    // collapses "no such planned_set" and "planned_set owned by someone else"
    // into a single 404 — anything else would let an attacker enumerate IDs.
    const { rows: psRows } = await db.query<{ exercise_id: string; user_id: string }>(
      `SELECT ps.exercise_id, mr.user_id
       FROM planned_sets ps
       JOIN day_workouts dw   ON dw.id = ps.day_workout_id
       JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
       WHERE ps.id = $1`,
      [body.planned_set_id],
    );
    if (psRows.length === 0 || psRows[0].user_id !== userId) {
      return reply.code(404).send({ error: 'planned_set not found' });
    }
    const exerciseId = psRows[0].exercise_id;

    // Atomic insert. RETURNING gets the new row on a clean insert; an empty
    // result-set on ON CONFLICT DO NOTHING means one of the two unique
    // indices fired.
    const insert = await db.query<SetLogRow>(
      `INSERT INTO set_logs (
         user_id, exercise_id, planned_set_id, client_request_id,
         performed_load_lbs, performed_reps, performed_rir, rpe,
         performed_at, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        userId,
        exerciseId,
        body.planned_set_id,
        body.client_request_id,
        body.weight_lbs ?? null,
        body.reps ?? null,
        body.rir ?? null,
        body.rpe ?? null,
        body.performed_at,
        body.notes ?? null,
      ],
    );

    if (insert.rows.length === 1) {
      return reply.code(201).send({ deduped: false, set_log: insert.rows[0] });
    }

    // Conflict path: find whichever existing row tripped the unique index.
    // The date_trunc args MUST match the index expression byte-for-byte —
    // the W1.1 index uses 3-arg date_trunc('minute', performed_at, 'UTC')
    // (not the 2-arg session-TZ-dependent variant) because Postgres requires
    // IMMUTABLE expressions in unique-index keys. Matching that here lets
    // the planner use the index instead of a scan.
    const existing = await db.query<SetLogRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM set_logs
       WHERE (user_id = $1 AND client_request_id = $2)
          OR (planned_set_id = $3
              AND date_trunc('minute', performed_at, 'UTC')
                = date_trunc('minute', $4::timestamptz, 'UTC'))
       LIMIT 1`,
      [userId, body.client_request_id, body.planned_set_id, body.performed_at],
    );
    return reply.code(200).send({ deduped: true, set_log: existing.rows[0] });
  });
}
