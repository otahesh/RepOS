import type { FastifyInstance } from 'fastify';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import { db } from '../db/client.js';
import {
  WorkoutIngestSchema,
  type WorkoutIngestResponse,
  type WorkoutRow,
} from '../schemas/healthWorkouts.js';

const MAX_WRITES_PER_DAY = 10;

// ---------------------------------------------------------------------------
// Validation helper — translate the first Zod issue into the
// { error, field } envelope shared with /api/health/weight so the API
// contract is consistent across the health domain.
// ---------------------------------------------------------------------------

function validate(body: unknown): { error: string; field: string } | null {
  const result = WorkoutIngestSchema.safeParse(body);
  if (result.success) return null;
  const issue = result.error.issues[0];
  const field = issue.path[0]?.toString() ?? 'unknown';
  return { error: issue.message, field };
}

// The shape pg returns from RETURNING. distance_m is NULL when omitted.
// `inserted` is the `(xmax = 0)` sentinel — true on fresh INSERTs, false on
// ON CONFLICT … DO UPDATE branches. node-pg maps Postgres boolean to JS
// boolean cleanly; if a future pg version flips this to 0/1 the route
// derives `deduped = !inserted` so a truthy 1 would still resolve correctly.
type UpsertRow = WorkoutRow & { inserted: boolean };

export async function workoutsRoutes(app: FastifyInstance) {
  app.post(
    '/workouts',
    {
      preHandler: [requireBearerOrCfAccess, requireScope('health:workouts:write')],
    },
    async (req, reply) => {
      const userId = req.userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const err = validate(req.body);
      if (err) return reply.code(400).send(err);

      const parsed = WorkoutIngestSchema.parse(req.body);

      // Day-key for rate-limit accounting is the wall-clock date of
      // started_at (CLAUDE.md: "store wall-clock time as display label only.
      // Do not derive UTC."). Zod's datetime({ offset: true }) already
      // validated that started_at is an ISO-8601 string whose first 10
      // characters are the local YYYY-MM-DD, so slice(0, 10) is exact.
      // A PST workout starting 23:30 local on May 11 stays a May 11 write —
      // no off-by-one 409 surprise near a user's wall-clock midnight.
      const logDate = parsed.started_at.slice(0, 10);

      // Rate-limit bump + INSERT must roll back together so a failed INSERT
      // (FK violation, CHECK violation, network blip mid-statement) doesn't
      // silently shrink the user's daily cap. Same transactional discipline
      // weight.ts:153-169 uses for backfill.
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Rate-limit FIRST so dedupes also count toward the cap (mirrors
        // weight.ts). 11th write/day per user returns 409.
        const {
          rows: [logRow],
        } = await client.query<{ write_count: number }>(
          `INSERT INTO workout_write_log (user_id, log_date, write_count)
           VALUES ($1, $2, 1)
           ON CONFLICT (user_id, log_date) DO UPDATE
             SET write_count = workout_write_log.write_count + 1
           RETURNING write_count`,
          [userId, logDate],
        );
        if (logRow.write_count > MAX_WRITES_PER_DAY) {
          await client.query('ROLLBACK');
          // Align with weight.ts's `rate_limited` envelope. The runbooks
          // previously documented two different strings; the alpha-shipped
          // /weight contract uses `rate_limited`, so workouts matches.
          return reply.code(409).send({ error: 'rate_limited' });
        }

        // Dedupe via DO NOTHING + fallback SELECT — same pattern as set_logs.
        // The prior DO UPDATE silently overwrote modality/distance/duration
        // on a (user_id, started_at, source) collision, mutating user data
        // under a `deduped:true` response. DO NOTHING preserves the first
        // ingest's payload; client correction goes through PATCH (W2+ scope).
        const { rows } = await client.query<UpsertRow>(
          `INSERT INTO health_workouts
             (user_id, started_at, ended_at, modality, distance_m, duration_sec, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, started_at, source) DO NOTHING
           RETURNING id, started_at, ended_at, modality, distance_m, duration_sec, source,
                     true AS inserted`,
          [
            userId,
            parsed.started_at,
            parsed.ended_at,
            parsed.modality,
            parsed.distance_m ?? null,
            parsed.duration_sec,
            parsed.source,
          ],
        );

        if (rows.length === 1) {
          await client.query('COMMIT');
          const { inserted: _drop, ...workout } = rows[0];
          const response: WorkoutIngestResponse = {
            workout: workout as WorkoutRow,
            deduped: false,
          };
          return reply.code(201).send(response);
        }

        // Conflict: fetch the prior row unchanged.
        const { rows: existing } = await client.query<WorkoutRow>(
          `SELECT id, started_at, ended_at, modality, distance_m, duration_sec, source
           FROM health_workouts
           WHERE user_id = $1 AND started_at = $2 AND source = $3`,
          [userId, parsed.started_at, parsed.source],
        );
        await client.query('COMMIT');
        const response: WorkoutIngestResponse = {
          workout: existing[0],
          deduped: true,
        };
        return reply.code(200).send(response);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  );
}
