import type { FastifyInstance } from 'fastify';
import { requireUserId } from '../utils/requestIdentity.js';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { computeUserLocalDate } from '../services/userLocalDate.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import { UuidParamSchema } from '../schemas/idParams.js';
import {
  PlannedSetPatchRequestSchema,
  PlannedSetSubstituteRequestSchema,
  type PlannedSetPatchResponse,
  type PlannedSetSubstituteResponse,
} from '../schemas/plannedSets.js';

// Shared ownership prefetch for both handlers: the 3-join IDOR guard
// (ps → dw → mr, filtered on mr.user_id) plus the columns the past-day guard
// needs. `extraPsCols` appends handler-specific ps.* columns. Returns the row
// or null (caller 404s — never leak existence of another user's set).
interface OwnedPlannedSetRow {
  id: string;
  scheduled_date: string;
  mesocycle_run_id: string;
  start_tz: string;
  [extra: string]: unknown;
}

async function loadOwnedPlannedSet(
  id: string,
  userId: string,
  extraPsCols = '',
): Promise<OwnedPlannedSetRow | null> {
  const { rows } = await db.query(
    `SELECT ps.id, to_char(dw.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            dw.mesocycle_run_id, mr.start_tz${extraPsCols ? `, ${extraPsCols}` : ''}
     FROM planned_sets ps
     JOIN day_workouts dw ON dw.id = ps.day_workout_id
     JOIN mesocycle_runs mr ON mr.id = dw.mesocycle_run_id
     WHERE ps.id = $1 AND mr.user_id = $2`,
    [id, userId],
  );
  return rows[0] ?? null;
}

// Both handlers share the past_day_readonly contract: 409 with the same body
// shape when the set's day is already in the user's local past; null = writable.
function pastDayConflict(setRow: { scheduled_date: string; start_tz: string }) {
  const todayLocal = computeUserLocalDate(setRow.start_tz);
  if (setRow.scheduled_date < todayLocal) {
    return {
      error: 'past_day_readonly',
      scheduled_date: setRow.scheduled_date,
      today_local: todayLocal,
    };
  }
  return null;
}

export async function plannedSetRoutes(app: FastifyInstance) {
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/planned-sets/:id',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'planned_set not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const parsed = PlannedSetPatchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }

      // Fix #2 error message extraction: ZodError for refinement has no path
      // (already handled above — first issue message is returned)

      const setRow = await loadOwnedPlannedSet(
        req.params.id,
        userId,
        `ps.target_reps_low AS cur_reps_low, ps.target_reps_high AS cur_reps_high,
         ps.target_duration_low_sec AS cur_dur_low`,
      );
      if (!setRow) {
        reply.code(404);
        return { error: 'planned_set not found', field: 'id' };
      }
      const conflict = pastDayConflict(setRow);
      if (conflict) {
        reply.code(409);
        return conflict;
      }

      const b = parsed.data;

      // Measurement-mismatch guard (measurement model): a duration-targeted
      // row (reps pair NULL) must not receive reps targets — the COALESCE
      // UPDATE below would otherwise trip planned_sets_measurement_xor_check
      // as an unhandled 500. Duration targets are not PATCHable yet (no
      // authoring UI); when they become so, mirror this guard for reps rows.
      const isDurationRow = setRow.cur_reps_low == null && setRow.cur_dur_low != null;
      if (isDurationRow && (b.target_reps_low != null || b.target_reps_high != null)) {
        reply.code(422);
        return {
          error: 'measurement_mismatch',
          field: 'target_reps_low',
          detail: 'this set is duration-targeted; reps targets do not apply',
        };
      }

      // Fix #4 — Cross-row rep range guard: validate merged values against DB current values
      // (cast matches the pre-helper untyped-row behavior: null coerces in >)
      const newLow = (b.target_reps_low ?? setRow.cur_reps_low) as number;
      const newHigh = (b.target_reps_high ?? setRow.cur_reps_high) as number;
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
                     target_reps_low, target_reps_high,
                     target_duration_low_sec, target_duration_high_sec,
                     target_rir, target_load_hint,
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
          [
            setRow.mesocycle_run_id,
            JSON.stringify({
              kind: 'patch',
              planned_set_id: req.params.id,
              changes: b,
              scheduled_date: setRow.scheduled_date,
            }),
          ],
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return updated as PlannedSetPatchResponse;
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/planned-sets/:id/substitute',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      if (!UuidParamSchema.safeParse(req.params).success) {
        reply.code(404);
        return { error: 'planned_set not found', field: 'id' };
      }
      const userId = requireUserId(req);
      const parsed = PlannedSetSubstituteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }

      // Prefetch + ownership + scheduled_date + start_tz + current exercise_id
      const setRow = await loadOwnedPlannedSet(req.params.id, userId, 'ps.exercise_id');
      if (!setRow) {
        reply.code(404);
        return { error: 'planned_set not found', field: 'id' };
      }
      const conflict = pastDayConflict(setRow);
      if (conflict) {
        reply.code(409);
        return conflict;
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
        const {
          rows: [updated],
        } = await client.query(
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
          [
            setRow.mesocycle_run_id,
            JSON.stringify({
              kind: 'substitute',
              planned_set_id: req.params.id,
              from_exercise_id: fromExerciseId,
              to_exercise_id: parsed.data.to_exercise_id,
              scheduled_date: setRow.scheduled_date,
            }),
          ],
        );
        await client.query('COMMIT');
        return updated as PlannedSetSubstituteResponse;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
