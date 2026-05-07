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

  app.post<{ Params: { id: string } }>(
    '/mesocycles/:id/abandon',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows: [run] } = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM mesocycle_runs
           WHERE id=$1 AND user_id=$2 FOR UPDATE`,
          [req.params.id, userId],
        );
        if (!run) {
          await client.query('ROLLBACK');
          reply.code(404);
          return { error: 'mesocycle_run not found', field: 'id' };
        }
        if (run.status !== 'active') {
          await client.query('ROLLBACK');
          reply.code(409);
          return { error: 'not_active', current_status: run.status };
        }
        const { rows: [updated] } = await client.query<{
          id: string; status: string; finished_at: string; user_program_id: string;
        }>(
          `UPDATE mesocycle_runs
              SET status='abandoned', finished_at=now(), updated_at=now()
            WHERE id=$1
            RETURNING id, status, finished_at, user_program_id`,
          [run.id],
        );
        // Flip the owning user_program to 'abandoned' so the library can
        // filter it out of the default active view. The row is preserved so
        // the user can find it in the Past tab and restart.
        await client.query(
          `UPDATE user_programs SET status='abandoned', updated_at=now()
           WHERE id=$1`,
          [updated.user_program_id],
        );
        await client.query(
          `INSERT INTO mesocycle_run_events (run_id, event_type, payload)
           VALUES ($1, 'abandoned', '{}'::jsonb)`,
          [run.id],
        );
        await client.query('COMMIT');
        return {
          mesocycle_run_id: updated.id,
          status: updated.status,
          finished_at: updated.finished_at,
        };
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      } finally {
        client.release();
      }
    },
  );
}
