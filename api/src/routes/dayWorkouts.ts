import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { db } from '../db/client.js';
import { computeUserLocalDate } from '../services/userLocalDate.js';
import { DayWorkoutCompleteSchema, IdParamSchema } from '../schemas/dayWorkouts.js';

// ---------------------------------------------------------------------------
// Sequence-workouts Task 2 — day-workout status routes.
//
// POST /day-workouts/:id/complete  → status='completed', completed_at stamped
// POST /day-workouts/:id/skip      → status='skipped' (409 if completed)
// POST /day-workouts/:id/reopen    → status='planned', completed_at cleared
//
// Auth: requireBearerOrCfAccess populates req.userId. No requireScope gate —
// like the mesocycle abandon route, these are webapp-first mutations; CF
// Access gates identity at the edge on the cookie path.
//
// IDOR: ownership is verified via the day_workouts → mesocycle_runs.user_id
// join. "Not found" and "not yours" collapse to the same 404 so the response
// can't be used as an existence oracle for another user's day_workout IDs
// (same contract as setLogs.ts). A malformed :id also 404s — a non-UUID can
// never name an existing row, and a distinct 400 would only add a shape to
// probe.
//
// Run lifecycle: when a complete/skip leaves the run with zero
// planned/in_progress rows, the run flips to status='completed'
// (finished_at=now()) and the owning user_program follows — this frees the
// idx_meso_one_active_per_user slot so the next mesocycle can start.
// Reopening a workout of a completed run re-activates it, unless another
// active run has taken the slot (409 — abandon that one first).
// ---------------------------------------------------------------------------

type DayWorkoutJoinRow = {
  id: string;
  status: 'planned' | 'in_progress' | 'completed' | 'skipped';
  completed_at: Date | null;
  mesocycle_run_id: string;
  run_status: string;
  start_tz: string;
  start_date: string; // YYYY-MM-DD
  user_program_id: string;
  user_id: string;
};

type StatusResponse = {
  id: string;
  status: string;
  completed_at: Date | string | null;
  run_completed: boolean;
};

/** Load the day workout + its run, or null when the id is unknown OR owned by
 *  someone else (callers translate null to the single 404 shape). */
async function loadDayWorkout(id: string, userId: string): Promise<DayWorkoutJoinRow | null> {
  const {
    rows: [row],
  } = await db.query<DayWorkoutJoinRow>(
    `SELECT dw.id, dw.status, dw.completed_at, dw.mesocycle_run_id,
            mr.status AS run_status, mr.start_tz,
            to_char(mr.start_date, 'YYYY-MM-DD') AS start_date,
            mr.user_program_id, mr.user_id
     FROM day_workouts dw
     JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
     WHERE dw.id = $1`,
    [id],
  );
  if (!row || row.user_id !== userId) return null;
  return row;
}

/** After a complete/skip: close the run iff no open (planned/in_progress)
 *  workouts remain. The NOT EXISTS guard lives inside the UPDATE so the
 *  count-check and the flip are a single atomic statement — two concurrent
 *  "last workout" mutations can't both miss the zero-count. Returns true when
 *  THIS call closed the run. */
async function closeRunIfSequenceDone(runId: string, userProgramId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE mesocycle_runs
        SET status='completed', finished_at=now(), updated_at=now()
      WHERE id = $1 AND status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM day_workouts
          WHERE mesocycle_run_id = $1 AND status IN ('planned','in_progress')
        )`,
    [runId],
  );
  if (rowCount !== 1) return false;
  await db.query(`UPDATE user_programs SET status='completed', updated_at=now() WHERE id = $1`, [
    userProgramId,
  ]);
  return true;
}

/** Shared prologue: auth state + :id validation + ownership load. Returns the
 *  row, or null after having written the error response. */
async function resolveDayWorkout(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<DayWorkoutJoinRow | null> {
  const userId = req.userId;
  if (!userId) {
    await reply.code(500).send({ error: 'auth_state_missing' });
    return null;
  }
  const idParse = IdParamSchema.safeParse(req.params);
  if (!idParse.success) {
    await reply.code(404).send({ error: 'day_workout not found' });
    return null;
  }
  const row = await loadDayWorkout(idParse.data.id, userId);
  if (!row) {
    await reply.code(404).send({ error: 'day_workout not found' });
    return null;
  }
  return row;
}

export async function dayWorkoutsRoutes(app: FastifyInstance) {
  app.post(
    '/day-workouts/:id/complete',
    { preHandler: [requireBearerOrCfAccess] },
    async (req, reply) => {
      const row = await resolveDayWorkout(req, reply);
      if (!row) return;

      // Idempotent: already completed → return the existing row unchanged.
      // completed_at does NOT move even if a different completed_on is sent.
      if (row.status === 'completed') {
        return reply.code(200).send({
          id: row.id,
          status: row.status,
          completed_at: row.completed_at,
          run_completed: false,
        } satisfies StatusResponse);
      }

      const parse = DayWorkoutCompleteSchema.safeParse(req.body ?? {});
      if (!parse.success) {
        const issue = parse.error.issues[0];
        return reply
          .code(400)
          .send({ error: issue.message, field: issue.path[0]?.toString() ?? 'completed_on' });
      }
      const completedOn = parse.data.completed_on;

      if (completedOn) {
        // Range checks in the run's own timezone — a device in another tz
        // must not shift what "today" or "the program start" means.
        const todayLocal = computeUserLocalDate(row.start_tz);
        if (completedOn > todayLocal) {
          return reply
            .code(400)
            .send({ error: 'completed_on cannot be in the future', field: 'completed_on' });
        }
        if (completedOn < row.start_date) {
          return reply
            .code(400)
            .send({ error: 'completed_on is before the program started', field: 'completed_on' });
        }
      }

      // Noon-local storage for backfilled dates: `timestamp AT TIME ZONE tz`
      // interprets the naive noon wall-clock in the run's tz and yields a
      // timestamptz — round-tripping through computeUserLocalDate always
      // lands back on the requested calendar date (midnight would straddle
      // DST/TZ edges).
      const {
        rows: [updated],
      } = completedOn
        ? await db.query<{ id: string; status: string; completed_at: Date }>(
            `UPDATE day_workouts
                SET status='completed',
                    completed_at = ($2 || ' 12:00:00')::timestamp AT TIME ZONE $3
              WHERE id = $1
              RETURNING id, status, completed_at`,
            [row.id, completedOn, row.start_tz],
          )
        : await db.query<{ id: string; status: string; completed_at: Date }>(
            `UPDATE day_workouts SET status='completed', completed_at = now()
              WHERE id = $1
              RETURNING id, status, completed_at`,
            [row.id],
          );

      const runCompleted = await closeRunIfSequenceDone(row.mesocycle_run_id, row.user_program_id);
      return reply.code(200).send({
        id: updated.id,
        status: updated.status,
        completed_at: updated.completed_at,
        run_completed: runCompleted,
      } satisfies StatusResponse);
    },
  );

  app.post(
    '/day-workouts/:id/skip',
    { preHandler: [requireBearerOrCfAccess] },
    async (req, reply) => {
      const row = await resolveDayWorkout(req, reply);
      if (!row) return;

      if (row.status === 'skipped') {
        return reply.code(200).send({
          id: row.id,
          status: row.status,
          completed_at: row.completed_at,
          run_completed: false,
        } satisfies StatusResponse);
      }
      if (row.status === 'completed') {
        // Completion carries data (a stamp, possibly logs) — silently
        // downgrading it to skipped would orphan that. Force the explicit
        // reopen path first.
        return reply.code(409).send({ error: 'already completed — reopen first', field: 'status' });
      }

      const {
        rows: [updated],
      } = await db.query<{ id: string; status: string; completed_at: Date | null }>(
        `UPDATE day_workouts SET status='skipped'
          WHERE id = $1
          RETURNING id, status, completed_at`,
        [row.id],
      );

      const runCompleted = await closeRunIfSequenceDone(row.mesocycle_run_id, row.user_program_id);
      return reply.code(200).send({
        id: updated.id,
        status: updated.status,
        completed_at: updated.completed_at,
        run_completed: runCompleted,
      } satisfies StatusResponse);
    },
  );

  app.post(
    '/day-workouts/:id/reopen',
    { preHandler: [requireBearerOrCfAccess] },
    async (req, reply) => {
      const row = await resolveDayWorkout(req, reply);
      if (!row) return;

      // Idempotent: planned/in_progress are already open.
      if (row.status === 'planned' || row.status === 'in_progress') {
        return reply.code(200).send({
          id: row.id,
          status: row.status,
          completed_at: row.completed_at,
          run_completed: false,
        } satisfies StatusResponse);
      }

      // Reopen + (maybe) run re-activation must be atomic: reopening the only
      // workout of a completed run and NOT re-activating the run would strand
      // a planned row on a closed run.
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        // Lock the run row so a concurrent reopen/complete on the same run
        // serializes here.
        const {
          rows: [run],
        } = await client.query<{ status: string }>(
          `SELECT status FROM mesocycle_runs WHERE id = $1 FOR UPDATE`,
          [row.mesocycle_run_id],
        );

        await client.query(
          `UPDATE day_workouts SET status='planned', completed_at=NULL WHERE id = $1`,
          [row.id],
        );

        if (run.status === 'completed') {
          // The lifecycle flip closed this run; reopening a workout un-closes
          // it — but only if the one-active-run-per-user slot is free.
          const { rows: others } = await client.query(
            `SELECT 1 FROM mesocycle_runs
             WHERE user_id = $1 AND status = 'active' AND id <> $2 LIMIT 1`,
            [row.user_id, row.mesocycle_run_id],
          );
          if (others.length > 0) {
            await client.query('ROLLBACK');
            return reply
              .code(409)
              .send({ error: 'another program is active — abandon it first', field: 'run' });
          }
          await client.query(
            `UPDATE mesocycle_runs
                SET status='active', finished_at=NULL, updated_at=now()
              WHERE id = $1`,
            [row.mesocycle_run_id],
          );
          await client.query(
            `UPDATE user_programs SET status='active', updated_at=now() WHERE id = $1`,
            [row.user_program_id],
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        // A run activated between our existence-check and the UPDATE trips
        // idx_meso_one_active_per_user — same user-facing condition as the
        // explicit check above, so same 409.
        const pgErr = err as { code?: string; constraint?: string };
        if (pgErr.code === '23505' && pgErr.constraint === 'idx_meso_one_active_per_user') {
          return reply
            .code(409)
            .send({ error: 'another program is active — abandon it first', field: 'run' });
        }
        throw err;
      } finally {
        client.release();
      }

      return reply.code(200).send({
        id: row.id,
        status: 'planned',
        completed_at: null,
        run_completed: false,
      } satisfies StatusResponse);
    },
  );
}
