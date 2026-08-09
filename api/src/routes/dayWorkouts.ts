import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { db } from '../db/client.js';
import { computeUserLocalDate } from '../services/userLocalDate.js';
import { DayWorkoutCompleteSchema } from '../schemas/dayWorkouts.js';
import { UuidParamSchema } from '../schemas/idParams.js';

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
// Atomicity: every handler runs its load + mutation + run-lifecycle writes in
// ONE transaction (precedent: /mesocycles/:id/abandon). The load takes
// FOR UPDATE on both the day_workout and its run, so concurrent mutations on
// the same workout/run serialize at the load and the status checks below it
// are race-free (no check-then-act window).
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

const NOT_FOUND = { error: 'day_workout not found' } as const;
const ANOTHER_ACTIVE = {
  error: 'another program is active — abandon it first',
  field: 'run',
} as const;

/** Load the day workout + its run FOR UPDATE (both rows locked), or null when
 *  the id is unknown OR owned by someone else (callers translate null to the
 *  single 404 shape). Must run inside a transaction. */
async function loadDayWorkoutForUpdate(
  client: PoolClient,
  id: string,
  userId: string,
): Promise<DayWorkoutJoinRow | null> {
  const {
    rows: [row],
  } = await client.query<DayWorkoutJoinRow>(
    `SELECT dw.id, dw.status, dw.completed_at, dw.mesocycle_run_id,
            mr.status AS run_status, mr.start_tz,
            to_char(mr.start_date, 'YYYY-MM-DD') AS start_date,
            mr.user_program_id, mr.user_id
     FROM day_workouts dw
     JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
     WHERE dw.id = $1
     FOR UPDATE OF dw, mr`,
    [id],
  );
  if (!row || row.user_id !== userId) return null;
  return row;
}

/** Close the run iff no open (planned/in_progress) workouts remain, flipping
 *  the owning user_program with it. Runs on the handler's transaction client
 *  so the workout mutation, the run flip, and the program flip commit (or
 *  roll back) together. Returns true when THIS call closed the run.
 *
 *  Also invoked from the idempotent early-return branches of complete/skip:
 *  a crash after a previous request's workout UPDATE but before its run
 *  close would otherwise strand an active run with zero open workouts — the
 *  retry lands on the idempotent branch and heals it here. */
async function closeRunIfSequenceDone(
  client: PoolClient,
  run: Pick<DayWorkoutJoinRow, 'mesocycle_run_id' | 'user_program_id'>,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE mesocycle_runs
        SET status='completed', finished_at=now(), updated_at=now()
      WHERE id = $1 AND status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM day_workouts
          WHERE mesocycle_run_id = $1 AND status IN ('planned','in_progress')
        )`,
    [run.mesocycle_run_id],
  );
  if (rowCount !== 1) return false;
  await client.query(
    `UPDATE user_programs SET status='completed', updated_at=now() WHERE id = $1`,
    [run.user_program_id],
  );
  return true;
}

/** Safe rollback for catch paths — a dead connection's ROLLBACK failure must
 *  not mask the original error (matches the abandon handler's pattern). */
async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* already rolled back / connection dead */
  }
}

function sendStatus(
  reply: FastifyReply,
  row: { id: string; status: string; completed_at: Date | string | null },
  runCompleted: boolean,
) {
  return reply.code(200).send({
    id: row.id,
    status: row.status,
    completed_at: row.completed_at,
    run_completed: runCompleted,
  });
}

export async function dayWorkoutsRoutes(app: FastifyInstance) {
  app.post(
    '/day-workouts/:id/complete',
    { preHandler: [requireBearerOrCfAccess] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
      const idParse = UuidParamSchema.safeParse(req.params);
      if (!idParse.success) return reply.code(404).send(NOT_FOUND);

      const parse = DayWorkoutCompleteSchema.safeParse(req.body ?? {});
      if (!parse.success) {
        const issue = parse.error.issues[0];
        return reply
          .code(400)
          .send({ error: issue.message, field: issue.path[0]?.toString() ?? 'completed_on' });
      }
      const completedOn = parse.data.completed_on;

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const row = await loadDayWorkoutForUpdate(client, idParse.data.id, userId);
        if (!row) {
          await client.query('ROLLBACK');
          return reply.code(404).send(NOT_FOUND);
        }

        // Idempotent: already completed → return the existing row unchanged.
        // completed_at does NOT move even if a different completed_on is
        // sent. Still run the lifecycle close (self-heal, see helper doc).
        if (row.status === 'completed') {
          const runCompleted = await closeRunIfSequenceDone(client, row);
          await client.query('COMMIT');
          return sendStatus(reply, row, runCompleted);
        }

        if (completedOn) {
          // Range checks in the run's own timezone — a device in another tz
          // must not shift what "today" or "the program start" means.
          const todayLocal = computeUserLocalDate(row.start_tz);
          if (completedOn > todayLocal) {
            await client.query('ROLLBACK');
            return reply
              .code(400)
              .send({ error: 'completed_on cannot be in the future', field: 'completed_on' });
          }
          if (completedOn < row.start_date) {
            await client.query('ROLLBACK');
            return reply.code(400).send({
              error: 'completed_on is before the program started',
              field: 'completed_on',
            });
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
          ? await client.query<{ id: string; status: string; completed_at: Date }>(
              `UPDATE day_workouts
                  SET status='completed',
                      completed_at = ($2 || ' 12:00:00')::timestamp AT TIME ZONE $3
                WHERE id = $1
                RETURNING id, status, completed_at`,
              [row.id, completedOn, row.start_tz],
            )
          : await client.query<{ id: string; status: string; completed_at: Date }>(
              `UPDATE day_workouts SET status='completed', completed_at = now()
                WHERE id = $1
                RETURNING id, status, completed_at`,
              [row.id],
            );

        const runCompleted = await closeRunIfSequenceDone(client, row);
        await client.query('COMMIT');
        return sendStatus(reply, updated, runCompleted);
      } catch (e) {
        await rollbackQuietly(client);
        throw e;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/day-workouts/:id/skip',
    { preHandler: [requireBearerOrCfAccess] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
      const idParse = UuidParamSchema.safeParse(req.params);
      if (!idParse.success) return reply.code(404).send(NOT_FOUND);

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const row = await loadDayWorkoutForUpdate(client, idParse.data.id, userId);
        if (!row) {
          await client.query('ROLLBACK');
          return reply.code(404).send(NOT_FOUND);
        }

        // Idempotent — and self-healing, same as complete's branch.
        if (row.status === 'skipped') {
          const runCompleted = await closeRunIfSequenceDone(client, row);
          await client.query('COMMIT');
          return sendStatus(reply, row, runCompleted);
        }
        if (row.status === 'completed') {
          // Completion carries data (a stamp, possibly logs) — silently
          // downgrading it to skipped would orphan that. Force the explicit
          // reopen path first. Race-free: the row is locked FOR UPDATE.
          await client.query('ROLLBACK');
          return reply
            .code(409)
            .send({ error: 'already completed — reopen first', field: 'status' });
        }

        const {
          rows: [updated],
        } = await client.query<{ id: string; status: string; completed_at: Date | null }>(
          `UPDATE day_workouts SET status='skipped'
            WHERE id = $1
            RETURNING id, status, completed_at`,
          [row.id],
        );

        const runCompleted = await closeRunIfSequenceDone(client, row);
        await client.query('COMMIT');
        return sendStatus(reply, updated, runCompleted);
      } catch (e) {
        await rollbackQuietly(client);
        throw e;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/day-workouts/:id/reopen',
    { preHandler: [requireBearerOrCfAccess] },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });
      const idParse = UuidParamSchema.safeParse(req.params);
      if (!idParse.success) return reply.code(404).send(NOT_FOUND);

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const row = await loadDayWorkoutForUpdate(client, idParse.data.id, userId);
        if (!row) {
          await client.query('ROLLBACK');
          return reply.code(404).send(NOT_FOUND);
        }

        // Idempotent: planned/in_progress are already open — nothing to write.
        if (row.status === 'planned' || row.status === 'in_progress') {
          await client.query('ROLLBACK');
          return sendStatus(reply, row, false);
        }

        // Reopen + (maybe) run re-activation are atomic: reopening the only
        // workout of a completed run and NOT re-activating the run would
        // strand a planned row on a closed run.
        await client.query(
          `UPDATE day_workouts SET status='planned', completed_at=NULL WHERE id = $1`,
          [row.id],
        );

        if (row.run_status === 'completed') {
          // The lifecycle flip closed this run; reopening a workout un-closes
          // it — but only if the one-active-run-per-user slot is free.
          const { rows: others } = await client.query(
            `SELECT 1 FROM mesocycle_runs
             WHERE user_id = $1 AND status = 'active' AND id <> $2 LIMIT 1`,
            [row.user_id, row.mesocycle_run_id],
          );
          if (others.length > 0) {
            await client.query('ROLLBACK');
            return reply.code(409).send(ANOTHER_ACTIVE);
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
        return sendStatus(reply, { id: row.id, status: 'planned', completed_at: null }, false);
      } catch (err) {
        await rollbackQuietly(client);
        // A run activated between our existence-check and the UPDATE trips
        // idx_meso_one_active_per_user — same user-facing condition as the
        // explicit check above, so same 409.
        const pgErr = err as { code?: string; constraint?: string };
        if (pgErr.code === '23505' && pgErr.constraint === 'idx_meso_one_active_per_user') {
          return reply.code(409).send(ANOTHER_ACTIVE);
        }
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
