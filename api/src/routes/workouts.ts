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

      // Derive the rate-limit day key from the workout's started_at, in UTC.
      // The plan's 409 test pins started_at with Date.UTC(...).toISOString(),
      // so 'YYYY-MM-DD' from the ISO string matches the test's expectation
      // ('2026-05-12'). Using wall-clock here would race DST.
      const logDate = new Date(parsed.started_at).toISOString().slice(0, 10);

      // Rate-limit FIRST so dedupes also count toward the cap (mirrors
      // weight.ts). 11th write/day per user returns 409.
      const { rows: [logRow] } = await db.query<{ write_count: number }>(
        `INSERT INTO workout_write_log (user_id, log_date, write_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, log_date) DO UPDATE
           SET write_count = workout_write_log.write_count + 1
         RETURNING write_count`,
        [userId, logDate],
      );
      if (logRow.write_count > MAX_WRITES_PER_DAY) {
        return reply.code(409).send({ error: 'rate_limit_exceeded' });
      }

      // Upsert + insert-vs-update sentinel in one round-trip.
      //   xmax = 0  → fresh INSERT (no prior tuple, no transaction ID slot
      //               was used to lock an existing row).
      //   xmax != 0 → ON CONFLICT fired and an existing row was updated.
      // This is the canonical Postgres pattern for distinguishing the two
      // branches from a single UPSERT; cited in the pg docs and used widely.
      const { rows } = await db.query<UpsertRow>(
        `INSERT INTO health_workouts
           (user_id, started_at, ended_at, modality, distance_m, duration_sec, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, started_at, source) DO UPDATE
           SET ended_at = EXCLUDED.ended_at,
               modality = EXCLUDED.modality,
               distance_m = EXCLUDED.distance_m,
               duration_sec = EXCLUDED.duration_sec,
               updated_at = now()
         RETURNING id, started_at, ended_at, modality, distance_m, duration_sec, source,
                   (xmax = 0) AS inserted`,
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

      const { inserted, ...workout } = rows[0];
      const response: WorkoutIngestResponse = {
        workout: workout as WorkoutRow,
        deduped: !inserted,
      };
      return reply.code(inserted ? 201 : 200).send(response);
    },
  );
}
