import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { getTodayWorkout } from '../services/getTodayWorkout.js';
import { computeVolumeRollup } from '../services/volumeRollup.js';

export async function mesocycleRoutes(app: FastifyInstance) {
  // /today must be registered before /:id so the literal path wins over the param.
  app.get(
    '/mesocycles/today',
    { preHandler: requireBearerOrCfAccess },
    async (req, _reply) => {
      const userId = (req as any).userId as string;
      return getTodayWorkout(userId);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/mesocycles/:id',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const { rows: [run] } = await db.query(
        `SELECT id, user_program_id, user_id,
                to_char(start_date, 'YYYY-MM-DD') AS start_date,
                start_tz, weeks, current_week, status, finished_at, created_at, updated_at
         FROM mesocycle_runs WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      if (!run) {
        reply.code(404);
        return { error: 'mesocycle_run not found', field: 'id' };
      }
      const { rows: days } = await db.query(
        `SELECT id, week_idx, day_idx,
                to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
                kind, name, status, completed_at
         FROM day_workouts
         WHERE mesocycle_run_id=$1
         ORDER BY week_idx, day_idx`,
        [run.id],
      );
      return { ...run, day_workouts: days };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/mesocycles/:id/volume-rollup',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const { rows } = await db.query(
        `SELECT id FROM mesocycle_runs WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      if (rows.length === 0) {
        reply.code(404);
        return { error: 'mesocycle_run not found', field: 'id' };
      }
      return computeVolumeRollup(req.params.id);
    },
  );
}
