import type { FastifyInstance } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import { db } from '../db/client.js';
import {
  CardioLogPostSchema,
  CardioLogPatchSchema,
  CardioLogListQuerySchema,
  IdParamSchema,
  type CardioLogRow,
} from '../schemas/cardioLogs.js';

// ---------------------------------------------------------------------------
// cardio_logs routes (measurement model phase 2) — the completion path for
// planned_cardio_blocks, which were prescribed + rendered since W1 but never
// completable. Deliberately mirrors setLogs.ts:
//
// Auth: requireBearerOrCfAccess + requireScope('cardio_logs:write'). The
// webapp (CF Access) is the only cardio-logging client today; CF Access JWTs
// pass requireScope because tokenScopes is undefined. Any future bearer
// integration mints with the cardio_logs:write scope.
//
// IDOR: ownership of planned_cardio_block_id is verified via the
// planned_cardio_blocks → day_workouts → mesocycle_runs.user_id chain;
// "not found" and "not yours" collapse to 404.
//
// Idempotency: single INSERT ... ON CONFLICT DO NOTHING over the same two
// unique-index shapes as set_logs (per-user client_request_id + per-block
// UTC-minute dedupe).
//
// 24h audit window on PATCH/DELETE, computed in SQL — same immutability
// rationale as set_logs (weekly cardio minutes feed recovery analytics).
// ---------------------------------------------------------------------------

const SELECT_COLUMNS = `
  id, user_id, exercise_id, planned_cardio_block_id, client_request_id,
  performed_duration_sec AS duration_sec,
  performed_distance_m   AS distance_m,
  avg_hr, max_hr, energy_kcal, srpe, source,
  performed_at, notes, created_at, updated_at
`;

export async function cardioLogsRoutes(app: FastifyInstance) {
  app.post(
    '/cardio-logs',
    { preHandler: [requireBearerOrCfAccess, requireScope('cardio_logs:write')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const parse = CardioLogPostSchema.safeParse(req.body);
      if (!parse.success) {
        const issue = parse.error.issues[0];
        const field = issue.path[0]?.toString() ?? 'unknown';
        return reply.code(400).send({ error: issue.message, field });
      }
      const body = parse.data;

      const { rows: pcRows } = await db.query<{ exercise_id: string; user_id: string }>(
        `SELECT pc.exercise_id, mr.user_id
       FROM planned_cardio_blocks pc
       JOIN day_workouts dw   ON dw.id = pc.day_workout_id
       JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
       WHERE pc.id = $1`,
        [body.planned_cardio_block_id],
      );
      if (pcRows.length === 0 || pcRows[0].user_id !== userId) {
        return reply.code(404).send({ error: 'planned_cardio_block not found' });
      }
      const exerciseId = pcRows[0].exercise_id;

      const insert = await db.query<CardioLogRow>(
        `INSERT INTO cardio_logs (
         user_id, exercise_id, planned_cardio_block_id, client_request_id,
         performed_duration_sec, performed_distance_m, avg_hr, max_hr,
         energy_kcal, srpe, performed_at, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
        [
          userId,
          exerciseId,
          body.planned_cardio_block_id,
          body.client_request_id,
          body.duration_sec,
          body.distance_m ?? null,
          body.avg_hr ?? null,
          body.max_hr ?? null,
          body.energy_kcal ?? null,
          body.srpe ?? null,
          body.performed_at,
          body.notes ?? null,
        ],
      );

      if (insert.rows.length === 1) {
        // Same best-effort planned → in_progress hint as set logs: a logged
        // cardio block also means the workout is underway.
        try {
          await db.query(
            `UPDATE day_workouts dw SET status = 'in_progress'
           FROM planned_cardio_blocks pc
           WHERE pc.id = $1 AND dw.id = pc.day_workout_id AND dw.status = 'planned'`,
            [body.planned_cardio_block_id],
          );
        } catch (err) {
          req.log.warn(
            { err, planned_cardio_block_id: body.planned_cardio_block_id },
            'day_workout status flip failed',
          );
        }
        return reply.code(201).send({ deduped: false, cardio_log: insert.rows[0] });
      }

      // Conflict path — same byte-for-byte date_trunc expression as the index.
      const existing = await db.query<CardioLogRow>(
        `SELECT ${SELECT_COLUMNS}
       FROM cardio_logs
       WHERE (user_id = $1 AND client_request_id = $2)
          OR (user_id = $1
              AND planned_cardio_block_id = $3
              AND date_trunc('minute', performed_at, 'UTC')
                = date_trunc('minute', $4::timestamptz, 'UTC'))
       LIMIT 1`,
        [userId, body.client_request_id, body.planned_cardio_block_id, body.performed_at],
      );
      return reply.code(200).send({ deduped: true, cardio_log: existing.rows[0] });
    },
  );

  app.get('/cardio-logs', { preHandler: [requireBearerOrCfAccess] }, async (req, reply) => {
    const userId = req.userId;
    if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

    const parse = CardioLogListQuerySchema.safeParse(req.query);
    if (!parse.success) {
      const issue = parse.error.issues[0];
      return reply
        .code(400)
        .send({ error: issue.message, field: issue.path[0]?.toString() ?? 'unknown' });
    }

    // Own-rows-only by construction; another user's block id yields an
    // empty list (not 404) — same list semantics as GET /set-logs.
    const { rows } = await db.query<CardioLogRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM cardio_logs
       WHERE user_id = $1 AND planned_cardio_block_id = $2
       ORDER BY performed_at DESC`,
      [userId, parse.data.planned_cardio_block_id],
    );
    return reply.send({ cardio_logs: rows });
  });

  app.patch(
    '/cardio-logs/:id',
    { preHandler: [requireBearerOrCfAccess, requireScope('cardio_logs:write')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const idParse = IdParamSchema.safeParse(req.params);
      if (!idParse.success) {
        return reply.code(404).send({ error: 'cardio_log not found' });
      }
      const { id } = idParse.data;
      const parse = CardioLogPatchSchema.safeParse(req.body);
      if (!parse.success) {
        const issue = parse.error.issues[0];
        return reply
          .code(400)
          .send({ error: issue.message, field: issue.path[0]?.toString() ?? 'unknown' });
      }

      // Ownership + audit window in one SQL pass (no TOCTOU); Postgres clock
      // owns the gate.
      const { rows } = await db.query<{ audit_window_ok: boolean; max_edit_at: string }>(
        `SELECT performed_at > now() - INTERVAL '24 hours' AS audit_window_ok,
              performed_at + INTERVAL '24 hours'         AS max_edit_at
       FROM cardio_logs WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'cardio_log not found' });
      }
      if (!rows[0].audit_window_ok) {
        return reply
          .code(409)
          .send({ error: 'audit_window_expired', max_edit_at: rows[0].max_edit_at });
      }

      const map = {
        duration_sec: 'performed_duration_sec',
        distance_m: 'performed_distance_m',
        avg_hr: 'avg_hr',
        max_hr: 'max_hr',
        energy_kcal: 'energy_kcal',
        srpe: 'srpe',
        notes: 'notes',
      } as const;
      const setParts: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      for (const [field, column] of Object.entries(map)) {
        const v = (parse.data as Record<string, unknown>)[field];
        if (v !== undefined) {
          setParts.push(`${column} = $${p++}`);
          params.push(v);
        }
      }
      params.push(id, userId);
      const updated = await db.query<CardioLogRow>(
        `UPDATE cardio_logs SET ${setParts.join(', ')}
       WHERE id = $${p++} AND user_id = $${p}
       RETURNING ${SELECT_COLUMNS}`,
        params,
      );
      return reply.send({ cardio_log: updated.rows[0] });
    },
  );

  app.delete(
    '/cardio-logs/:id',
    { preHandler: [requireBearerOrCfAccess, requireScope('cardio_logs:write')] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const idParse = IdParamSchema.safeParse(req.params);
      if (!idParse.success) {
        return reply.code(404).send({ error: 'cardio_log not found' });
      }
      const { id } = idParse.data;

      const { rows } = await db.query<{ audit_window_ok: boolean; max_edit_at: string }>(
        `SELECT performed_at > now() - INTERVAL '24 hours' AS audit_window_ok,
              performed_at + INTERVAL '24 hours'         AS max_edit_at
       FROM cardio_logs WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'cardio_log not found' });
      }
      if (!rows[0].audit_window_ok) {
        return reply
          .code(409)
          .send({ error: 'audit_window_expired', max_edit_at: rows[0].max_edit_at });
      }

      await db.query(`DELETE FROM cardio_logs WHERE id = $1 AND user_id = $2`, [id, userId]);
      return reply.send({ deleted: true });
    },
  );
}
