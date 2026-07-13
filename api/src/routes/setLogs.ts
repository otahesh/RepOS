import type { FastifyInstance } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import { db } from '../db/client.js';
import {
  SetLogPostSchema,
  SetLogPatchSchema,
  SetLogListQuerySchema,
  IdParamSchema,
  type SetLogRow,
} from '../schemas/setLogs.js';

// ---------------------------------------------------------------------------
// Beta W1.2 — set_logs routes.
//
// Auth: requireBearerOrCfAccess populates req.userId; requireScope enforces
// that bearer tokens carry `set_logs:write`. CF Access JWTs (the webapp path)
// pass through requireScope because tokenScopes is undefined — whole-host
// CF Access already gates identity at the edge.
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
  performed_duration_sec     AS duration_sec,
  performed_rir              AS rir,
  rpe, performed_at, notes, created_at, updated_at
`;

export async function setLogsRoutes(app: FastifyInstance) {
  app.post(
    '/set-logs',
    { preHandler: [requireBearerOrCfAccess, requireScope('set_logs:write')] },
    async (req, reply) => {
      const userId = req.userId;
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
         performed_load_lbs, performed_reps, performed_duration_sec, performed_rir, rpe,
         performed_at, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
        [
          userId,
          exerciseId,
          body.planned_set_id,
          body.client_request_id,
          body.weight_lbs ?? null,
          body.reps ?? null,
          body.duration_sec ?? null,
          body.rir ?? null,
          body.rpe ?? null,
          body.performed_at,
          body.notes ?? null,
        ],
      );

      if (insert.rows.length === 1) {
        // Sequence-workouts: the FIRST set log against a day workout flips it
        // planned → in_progress. Scoped to a fresh insert only (not the
        // conflict/dedupe path below) so idempotent replays don't re-touch
        // status — the WHERE status='planned' guard makes this harmless
        // either way, but keeping it here avoids firing an UPDATE on every
        // deduped replay. Only fires from 'planned'; a set log against an
        // in_progress/completed/skipped day workout leaves status untouched
        // (the completed case is the backfill scenario).
        //
        // Failure is swallowed deliberately: the set_log INSERT above has
        // already committed, so throwing here would 500 a request whose
        // write actually persisted — a spurious failure for the user. The
        // flip is a best-effort status hint that self-heals: the next set
        // log against the same day_workout re-runs this UPDATE (the
        // WHERE status='planned' guard keeps the retry idempotent).
        try {
          await db.query(
            `UPDATE day_workouts dw SET status = 'in_progress'
           FROM planned_sets ps
           WHERE ps.id = $1 AND dw.id = ps.day_workout_id AND dw.status = 'planned'`,
            [body.planned_set_id],
          );
        } catch (err) {
          req.log.warn(
            { err, planned_set_id: body.planned_set_id },
            'day_workout status flip failed',
          );
        }
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
          OR (user_id = $1
              AND planned_set_id = $3
              AND date_trunc('minute', performed_at, 'UTC')
                = date_trunc('minute', $4::timestamptz, 'UTC'))
       LIMIT 1`,
        [userId, body.client_request_id, body.planned_set_id, body.performed_at],
      );
      return reply.code(200).send({ deduped: true, set_log: existing.rows[0] });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/set-logs/:id — mutate a logged set inside the 24h audit window.
  //
  // The audit window is the only post-write mutation gate. After 24 hours a
  // set_log is immutable so historical analytics (PR trends, MAV/MRV state)
  // can't be silently rewritten. The window is computed in SQL via
  // `now() - INTERVAL '24 hours'` rather than at the API layer so any
  // clock-skew between Node and Postgres can't reopen the gate.
  //
  // Ownership + window check happen in the same SELECT as the row load so
  // there's no TOCTOU between checking ownership and running the UPDATE.
  //
  // IDOR: a set_log belonging to another user returns 404 — same shape as
  // "no such id" — so the response can't be used to enumerate other users'
  // set_log IDs.
  // -------------------------------------------------------------------------
  app.patch(
    '/set-logs/:id',
    { preHandler: [requireBearerOrCfAccess, requireScope('set_logs:write')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const idParse = IdParamSchema.safeParse(req.params);
      if (!idParse.success) {
        const issue = idParse.error.issues[0];
        return reply
          .code(400)
          .send({ error: issue.message, field: issue.path[0]?.toString() ?? 'unknown' });
      }
      const { id } = idParse.data;
      const parse = SetLogPatchSchema.safeParse(req.body);
      if (!parse.success) {
        const issue = parse.error.issues[0];
        const field = issue.path[0]?.toString() ?? 'unknown';
        return reply.code(400).send({ error: issue.message, field });
      }

      // Atomic load: ownership + audit window in one SQL pass. The
      // `audit_window_ok` boolean is computed from Postgres's clock; if the
      // row's performed_at is more than 24h in Postgres-time the gate trips
      // regardless of whatever the Node process thinks the time is.
      // audit_window_ok uses strict `>`, so max_edit_at is the boundary
      // *at which* editing becomes forbidden — when this 409 fires,
      // max_edit_at is <= now() by definition.
      const { rows: existing } = await db.query<{
        id: string;
        user_id: string;
        performed_at: Date;
        audit_window_ok: boolean;
        max_edit_at: Date;
      }>(
        `SELECT id, user_id, performed_at,
              performed_at > now() - INTERVAL '24 hours' AS audit_window_ok,
              performed_at + INTERVAL '24 hours'         AS max_edit_at
       FROM set_logs WHERE id = $1`,
        [id],
      );

      // IDOR: "not found" and "not yours" collapse to the same 404 — anything
      // else lets an attacker probe which IDs exist on other accounts.
      if (existing.length === 0 || existing[0].user_id !== userId) {
        return reply.code(404).send({ error: 'not found' });
      }
      if (!existing[0].audit_window_ok) {
        return reply.code(409).send({
          error: 'audit_window_expired',
          performed_at: existing[0].performed_at,
          max_edit_at: existing[0].max_edit_at,
        });
      }

      // Build SET clause dynamically. API field names map to DB column names
      // (the historical performed_load_lbs/performed_reps/performed_rir
      // mismatch from POST applies here too). The schema's .refine guarantees
      // at least one field is set, so setParts is never empty.
      const fields = parse.data;
      const map = {
        weight_lbs: 'performed_load_lbs',
        reps: 'performed_reps',
        duration_sec: 'performed_duration_sec',
        rir: 'performed_rir',
        rpe: 'rpe',
        notes: 'notes',
      } as const;
      const setParts: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      // SQL-injection safety: keys in `fields` are post-Zod, so they are
      // necessarily in the `map` literal — `map[k]` resolves to a hardcoded
      // column name. Values flow through $-params.
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        setParts.push(`${map[k as keyof typeof map]} = $${p++}`);
        params.push(v);
      }
      params.push(id);

      // Migration 029's BEFORE UPDATE trigger bumps updated_at — no need to
      // touch it here. RETURNING uses SELECT_COLUMNS so weight_lbs comes back
      // as a JS number (the ::float cast) instead of NUMERIC-as-string.
      const beforeRow = existing[0];
      const { rows } = await db.query<SetLogRow>(
        `UPDATE set_logs SET ${setParts.join(', ')} WHERE id = $${p}
       RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      // Write-audit log for PATCH. The "who deleted/changed my PR?" incident
      // hook — a future support query against logs should be able to recover
      // {who, when, before→after}. Auth headers are already scrubbed by the
      // app-level Pino redact config (api/src/app.ts), so this line is safe.
      req.log.info(
        {
          event: 'set_log_patched',
          userId,
          setLogId: id,
          performedAt: beforeRow.performed_at,
          changedFields: Object.keys(fields).filter(
            (k) => fields[k as keyof typeof fields] !== undefined,
          ),
        },
        'set_log mutated',
      );
      return reply.code(200).send({ set_log: rows[0] });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/set-logs/:id — same 24h window + 404-IDOR semantics as PATCH.
  // Deletes are subject to the audit gate so historical analytics (PR trends,
  // MAV/MRV state) can't be silently retroactively wiped. Hard delete — no
  // soft-delete column in this iteration.
  // -------------------------------------------------------------------------
  app.delete(
    '/set-logs/:id',
    { preHandler: [requireBearerOrCfAccess, requireScope('set_logs:write')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const idParse = IdParamSchema.safeParse(req.params);
      if (!idParse.success) {
        const issue = idParse.error.issues[0];
        return reply
          .code(400)
          .send({ error: issue.message, field: issue.path[0]?.toString() ?? 'unknown' });
      }
      const { id } = idParse.data;

      // Atomic load: ownership + audit window in one SQL pass. Same boundary
      // semantics as PATCH (strict `>`; max_edit_at is the boundary at which
      // editing/deleting becomes forbidden). See PATCH handler above for the
      // full rationale on why the window is SQL-computed.
      const { rows: existing } = await db.query<{
        id: string;
        user_id: string;
        performed_at: Date;
        audit_window_ok: boolean;
        max_edit_at: Date;
      }>(
        `SELECT id, user_id, performed_at,
              performed_at > now() - INTERVAL '24 hours' AS audit_window_ok,
              performed_at + INTERVAL '24 hours'         AS max_edit_at
       FROM set_logs WHERE id = $1`,
        [id],
      );

      if (existing.length === 0 || existing[0].user_id !== userId) {
        return reply.code(404).send({ error: 'not found' });
      }
      if (!existing[0].audit_window_ok) {
        return reply.code(409).send({
          error: 'audit_window_expired',
          performed_at: existing[0].performed_at,
          max_edit_at: existing[0].max_edit_at,
        });
      }

      await db.query(`DELETE FROM set_logs WHERE id = $1`, [id]);

      // Write-audit log for DELETE. See PATCH handler above for rationale.
      req.log.info(
        {
          event: 'set_log_deleted',
          userId,
          setLogId: id,
          performedAt: existing[0].performed_at,
        },
        'set_log deleted',
      );
      return reply.code(200).send({ deleted: true });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/set-logs?planned_set_id=<uuid> — list this user's set_logs for a
  // planned_set, most-recent performed_at first.
  //
  // IDOR: ownership is enforced inside the WHERE clause via JOIN to
  // mesocycle_runs.user_id. A planned_set owned by another user produces an
  // empty result set, NOT a 404 — different shape from PATCH/DELETE because
  // a list query's empty result is semantically valid and doesn't function
  // as an existence oracle for other users' planned_set IDs.
  //
  // No audit-window gate (read-only), no pagination (out of scope for W1.2).
  // The SELECT is inline rather than reusing SELECT_COLUMNS because the JOIN
  // needs `sl.`-prefixed column references; the ::float cast still applies so
  // weight_lbs comes back as a JS number rather than NUMERIC-as-string.
  // -------------------------------------------------------------------------
  app.get(
    '/set-logs',
    { preHandler: [requireBearerOrCfAccess, requireScope('set_logs:write')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const parse = SetLogListQuerySchema.safeParse(req.query);
      if (!parse.success) {
        const issue = parse.error.issues[0];
        const field = issue.path[0]?.toString() ?? 'unknown';
        return reply.code(400).send({ error: issue.message, field });
      }

      const { rows } = await db.query<SetLogRow>(
        `SELECT
         sl.id, sl.user_id, sl.exercise_id, sl.planned_set_id, sl.client_request_id,
         sl.performed_load_lbs::float AS weight_lbs,
         sl.performed_reps             AS reps,
         sl.performed_duration_sec     AS duration_sec,
         sl.performed_rir              AS rir,
         sl.rpe, sl.performed_at, sl.notes, sl.created_at, sl.updated_at
       FROM set_logs sl
       JOIN planned_sets    ps ON ps.id = sl.planned_set_id
       JOIN day_workouts    dw ON dw.id = ps.day_workout_id
       JOIN mesocycle_runs  mr ON mr.id = dw.mesocycle_run_id
       WHERE sl.planned_set_id = $1
         AND mr.user_id = $2
       ORDER BY sl.performed_at DESC`,
        [parse.data.planned_set_id, userId],
      );
      return reply.code(200).send({ set_logs: rows });
    },
  );
}
