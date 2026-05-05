import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { computeUserLocalDate } from '../services/userLocalDate.js';

const PatchSchema = z.object({
  target_reps_low: z.number().int().min(1).max(50).optional(),
  target_reps_high: z.number().int().min(1).max(50).optional(),
  target_rir: z.number().int().min(1).max(10).optional(),
  target_load_hint: z.string().max(200).optional().nullable(),
  rest_sec: z.number().int().min(0).max(900).optional(),
  override_reason: z.string().max(200).optional(),
}).refine(
  (b) => b.target_reps_low == null || b.target_reps_high == null || b.target_reps_low <= b.target_reps_high,
  { message: 'target_reps_low must be <= target_reps_high' },
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
      const { rows } = await db.query(
        `SELECT ps.id, to_char(dw.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
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
      const b = parsed.data;
      const { rows: [updated] } = await db.query(
        `UPDATE planned_sets SET
           target_reps_low = COALESCE($1, target_reps_low),
           target_reps_high = COALESCE($2, target_reps_high),
           target_rir = COALESCE($3, target_rir),
           target_load_hint = COALESCE($4, target_load_hint),
           rest_sec = COALESCE($5, rest_sec),
           overridden_at = now(),
           override_reason = COALESCE($6, override_reason)
         WHERE id = $7
         RETURNING id, day_workout_id, block_idx, set_idx, exercise_id,
                   target_reps_low, target_reps_high, target_rir, target_load_hint,
                   rest_sec, overridden_at, override_reason, substituted_from_exercise_id`,
        [
          b.target_reps_low ?? null,
          b.target_reps_high ?? null,
          b.target_rir ?? null,
          b.target_load_hint ?? null,
          b.rest_sec ?? null,
          b.override_reason ?? null,
          req.params.id,
        ],
      );
      await db.query(
        `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
         VALUES ($1, 'set_overridden', $2::jsonb)`,
        [setRow.mesocycle_run_id, JSON.stringify({
          planned_set_id: req.params.id,
          changes: b,
          scheduled_date: setRow.scheduled_date,
        })],
      );
      return updated;
    },
  );
}
