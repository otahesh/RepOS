import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { getTodayWorkout } from '../services/getTodayWorkout.js';
import { computeVolumeRollup } from '../services/volumeRollup.js';
import type {
  MesocycleDetailResponse,
  MesocycleAbandonResponse,
  VolumeRollupResponse,
  MesocycleRecapStatsResponse,
} from '../schemas/mesocycles.js';

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
      const detail: MesocycleDetailResponse = { ...run, day_workouts: days };
      return detail;
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
      const rollup: VolumeRollupResponse = await computeVolumeRollup(req.params.id);
      return rollup;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/mesocycles/:id/recap-stats',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;

      // Ownership + existence check; grab weeks while we're at it.
      const { rows: [run] } = await db.query<{ id: string; weeks: number; finished_at: string | null }>(
        `SELECT id, weeks, finished_at FROM mesocycle_runs WHERE id=$1 AND user_id=$2`,
        [req.params.id, userId],
      );
      if (!run) {
        reply.code(404);
        return { error: 'mesocycle_run not found', field: 'id' };
      }

      // Total working sets: every set_log row whose planned_set traces back to
      // this run's day_workouts. We don't filter by day_workouts.status because
      // a skipped day may still have set_logs if the user logged anyway; count
      // whatever was actually logged.
      const { rows: [setRow] } = await db.query<{ total_sets: string }>(
        `SELECT COUNT(sl.id) AS total_sets
         FROM set_logs sl
         JOIN planned_sets ps ON ps.id = sl.planned_set_id
         JOIN day_workouts dw ON dw.id = ps.day_workout_id
         WHERE dw.mesocycle_run_id = $1`,
        [run.id],
      );
      const total_sets = parseInt(setRow?.total_sets ?? '0', 10);

      // PR count: distinct exercises in this run where the user hit a new
      // all-time max performed_load_lbs. "All-time" means across all runs
      // for this user whose finished_at (or now()) is earlier than this run's
      // finished_at (or now()). We compare max per-exercise within this run
      // against max per-exercise in all prior runs. An exercise counts as a
      // PR if this-run max > prior max (or if there is no prior log at all).
      const runCutoff = run.finished_at ?? 'now()';
      const { rows: [prRow] } = await db.query<{ prs: string }>(
        `WITH this_run_maxes AS (
           SELECT ps.exercise_id, MAX(sl.performed_load_lbs) AS max_lbs
           FROM set_logs sl
           JOIN planned_sets ps ON ps.id = sl.planned_set_id
           JOIN day_workouts dw ON dw.id = ps.day_workout_id
           WHERE dw.mesocycle_run_id = $1
             AND sl.performed_load_lbs IS NOT NULL
           GROUP BY ps.exercise_id
         ),
         prior_maxes AS (
           SELECT ps2.exercise_id, MAX(sl2.performed_load_lbs) AS max_lbs
           FROM set_logs sl2
           JOIN planned_sets ps2 ON ps2.id = sl2.planned_set_id
           JOIN day_workouts dw2 ON dw2.id = ps2.day_workout_id
           JOIN mesocycle_runs mr2 ON mr2.id = dw2.mesocycle_run_id
           WHERE mr2.user_id = $2
             AND mr2.id <> $1
             AND sl2.performed_load_lbs IS NOT NULL
             AND COALESCE(mr2.finished_at, now()) < $3
           GROUP BY ps2.exercise_id
         )
         SELECT COUNT(*) AS prs
         FROM this_run_maxes trm
         WHERE NOT EXISTS (
           SELECT 1 FROM prior_maxes pm
           WHERE pm.exercise_id = trm.exercise_id
             AND pm.max_lbs >= trm.max_lbs
         )`,
        [run.id, userId, runCutoff],
      );
      const prs = parseInt(prRow?.prs ?? '0', 10);

      const recap: MesocycleRecapStatsResponse = {
        weeks: run.weeks,
        total_sets,
        prs,
      };
      return recap;
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
        const abandonResp: MesocycleAbandonResponse = {
          mesocycle_run_id: updated.id,
          status: updated.status as MesocycleAbandonResponse['status'],
          finished_at: updated.finished_at,
        };
        return abandonResp;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      } finally {
        client.release();
      }
    },
  );
}
