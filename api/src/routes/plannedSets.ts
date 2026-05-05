import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { computeUserLocalDate } from '../services/userLocalDate.js';

const SubstituteSchema = z.object({
  to_exercise_id: z.string().uuid(),
});

const PatchSchema = z.object({
  target_reps_low: z.number().int().min(1).max(50).optional(),
  target_reps_high: z.number().int().min(1).max(50).optional(),
  target_rir: z.number().int().min(1).max(10).optional(),
  target_load_hint: z.string().max(200).optional().nullable(),
  rest_sec: z.number().int().min(0).max(900).optional(),
  override_reason: z.string().max(200).nullable().optional(),
}).refine(
  (b) => b.target_reps_low == null || b.target_reps_high == null || b.target_reps_low <= b.target_reps_high,
  { message: 'target_reps_low must be <= target_reps_high' },
).refine(
  (b) => Object.keys(b).length > 0,
  { message: 'patch body cannot be empty' },
);

export async function plannedSetRoutes(app: FastifyInstance) {
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/planned-sets/:id',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const parsed = PatchSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: parsed.error.message, field: parsed.error.issues[0]?.path?.join('.') };
      }

      // Fix #2 error message extraction: ZodError for refinement has no path
      // (already handled above — first issue message is returned)

      const { rows } = await db.query(
        `SELECT ps.id, to_char(dw.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
                dw.mesocycle_run_id, mr.start_tz,
                ps.target_reps_low AS cur_reps_low, ps.target_reps_high AS cur_reps_high
         FROM planned_sets ps
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
         WHERE ps.id = $1 AND mr.user_id = $2`,
        [req.params.id, userId],
      );
      if (rows.length === 0) {
        reply.code(404);
        return { error: 'planned_set not found', field: 'id' };
      }
      const setRow = rows[0];
      const todayLocal = computeUserLocalDate(setRow.start_tz);
      if (setRow.scheduled_date < todayLocal) {
        reply.code(409);
        return { error: 'past_day_readonly', scheduled_date: setRow.scheduled_date, today_local: todayLocal };
      }

      const b = parsed.data;

      // Fix #4 — Cross-row rep range guard: validate merged values against DB current values
      const newLow = b.target_reps_low ?? setRow.cur_reps_low;
      const newHigh = b.target_reps_high ?? setRow.cur_reps_high;
      if (newLow > newHigh) {
        reply.code(400);
        return {
          error: 'target_reps_low must be <= target_reps_high',
          field: 'target_reps_low',
          current: { target_reps_low: setRow.cur_reps_low, target_reps_high: setRow.cur_reps_high },
        };
      }

      // Fix #3 — override_reason sentinel: distinguish "omit" (undefined = no change)
      // from "explicit null" (clear the field).
      const overrideReasonProvided = Object.prototype.hasOwnProperty.call(b, 'override_reason');
      const sqlOverrideReason = overrideReasonProvided ? (b.override_reason ?? null) : null;
      const sqlOverrideReasonSet = overrideReasonProvided;

      // Fix #1 — Wrap UPDATE + audit INSERT in a single transaction
      const client = await db.connect();
      let updated: Record<string, unknown>;
      try {
        await client.query('BEGIN');

        const result = await client.query(
          `UPDATE planned_sets SET
             target_reps_low = COALESCE($1, target_reps_low),
             target_reps_high = COALESCE($2, target_reps_high),
             target_rir = COALESCE($3, target_rir),
             target_load_hint = COALESCE($4, target_load_hint),
             rest_sec = COALESCE($5, rest_sec),
             overridden_at = now(),
             override_reason = CASE WHEN $7::boolean THEN $6::text ELSE override_reason END
           WHERE id = $8
           RETURNING id, day_workout_id, block_idx, set_idx, exercise_id,
                     target_reps_low, target_reps_high, target_rir, target_load_hint,
                     rest_sec, overridden_at, override_reason, substituted_from_exercise_id`,
          [
            b.target_reps_low ?? null,
            b.target_reps_high ?? null,
            b.target_rir ?? null,
            b.target_load_hint ?? null,
            b.rest_sec ?? null,
            sqlOverrideReason,
            sqlOverrideReasonSet,
            req.params.id,
          ],
        );
        updated = result.rows[0];

        await client.query(
          `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
           VALUES ($1, 'set_overridden', $2::jsonb)`,
          [setRow.mesocycle_run_id, JSON.stringify({
            planned_set_id: req.params.id,
            changes: b,
            scheduled_date: setRow.scheduled_date,
          })],
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return updated;
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/planned-sets/:id/substitute',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const parsed = SubstituteSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: parsed.error.message, field: parsed.error.issues[0]?.path?.join('.') };
      }

      // Prefetch + ownership + scheduled_date + start_tz + current exercise_id
      const { rows } = await db.query(
        `SELECT ps.id, ps.exercise_id,
                to_char(dw.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
                dw.mesocycle_run_id, mr.start_tz
         FROM planned_sets ps
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
         WHERE ps.id = $1 AND mr.user_id = $2`,
        [req.params.id, userId],
      );
      if (rows.length === 0) {
        reply.code(404);
        return { error: 'planned_set not found', field: 'id' };
      }
      const setRow = rows[0];
      const todayLocal = computeUserLocalDate(setRow.start_tz);
      if (setRow.scheduled_date < todayLocal) {
        reply.code(409);
        return { error: 'past_day_readonly', scheduled_date: setRow.scheduled_date, today_local: todayLocal };
      }

      // Verify the target exercise is real + non-archived
      const { rows: targetRows } = await db.query(
        `SELECT id FROM exercises WHERE id=$1 AND archived_at IS NULL`,
        [parsed.data.to_exercise_id],
      );
      if (targetRows.length === 0) {
        reply.code(400);
        return { error: 'unknown to_exercise_id', field: 'to_exercise_id' };
      }

      const fromExerciseId = setRow.exercise_id;
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows: [updated] } = await client.query(
          `UPDATE planned_sets SET
             exercise_id = $1,
             substituted_from_exercise_id = COALESCE(substituted_from_exercise_id, $2),
             overridden_at = now()
           WHERE id = $3
           RETURNING id, exercise_id, substituted_from_exercise_id, overridden_at`,
          [parsed.data.to_exercise_id, fromExerciseId, req.params.id],
        );
        await client.query(
          `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
           VALUES ($1, 'set_overridden', $2::jsonb)`,
          [setRow.mesocycle_run_id, JSON.stringify({
            kind: 'substitute',
            planned_set_id: req.params.id,
            from_exercise_id: fromExerciseId,
            to_exercise_id: parsed.data.to_exercise_id,
            scheduled_date: setRow.scheduled_date,
          })],
        );
        await client.query('COMMIT');
        return updated;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
