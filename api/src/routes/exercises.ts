import type { FastifyInstance } from 'fastify';
import { requireUserId } from '../utils/requestIdentity.js';
import { db } from '../db/client.js';
import { findSubstitutions } from '../services/substitutions.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import type { ExerciseListResponse, SubstitutionResponse } from '../schemas/exercises.js';
import type { ExerciseGuideResponse } from '../schemas/exerciseGuide.js';

export async function exerciseRoutes(app: FastifyInstance) {
  app.get('/exercises', async (_req, reply) => {
    const { rows } = await db.query(`
      SELECT
        e.id, e.slug, e.name, e.movement_pattern, e.peak_tension_length,
        m.slug AS primary_muscle, m.name AS primary_muscle_name,
        e.skill_complexity, e.loading_demand, e.systemic_fatigue,
        e.required_equipment,
        COALESCE(json_object_agg(em.muscle_slug, em.contribution)
                 FILTER (WHERE em.muscle_slug IS NOT NULL), '{}') AS muscle_contributions
      FROM exercises e
      JOIN muscles m ON m.id = e.primary_muscle_id
      LEFT JOIN (
        SELECT emc.exercise_id, m2.slug AS muscle_slug, emc.contribution
        FROM exercise_muscle_contributions emc
        JOIN muscles m2 ON m2.id = emc.muscle_id
      ) em ON em.exercise_id = e.id
      WHERE e.archived_at IS NULL
      GROUP BY e.id, m.slug, m.name
      ORDER BY e.slug ASC
    `);
    reply.header('cache-control', 'public, max-age=300, stale-while-revalidate=86400');
    const listResp: ExerciseListResponse = { exercises: rows as ExerciseListResponse['exercises'] };
    return listResp;
  });

  app.get<{ Params: { slug: string } }>('/exercises/:slug', async (req, reply) => {
    const { rows } = await db.query(
      `
      SELECT
        e.*,
        m.slug AS primary_muscle, m.name AS primary_muscle_name,
        COALESCE(json_object_agg(em.muscle_slug, em.contribution)
                 FILTER (WHERE em.muscle_slug IS NOT NULL), '{}') AS muscle_contributions
      FROM exercises e
      JOIN muscles m ON m.id = e.primary_muscle_id
      LEFT JOIN (
        SELECT emc.exercise_id, m2.slug AS muscle_slug, emc.contribution
        FROM exercise_muscle_contributions emc
        JOIN muscles m2 ON m2.id = emc.muscle_id
      ) em ON em.exercise_id = e.id
      WHERE e.slug=$1 AND e.archived_at IS NULL
      GROUP BY e.id, m.slug, m.name
    `,
      [req.params.slug],
    );
    if (rows.length === 0) {
      reply.code(404);
      return { error: 'exercise not found', field: 'slug' };
    }
    reply.header('cache-control', 'public, max-age=300, stale-while-revalidate=86400');
    return rows[0];
  });

  // Setup-card content (W2 logging redesign). Static authored prose — public
  // cache like /exercises/:slug. 404 when no active guide: the UI hides ⓘ.
  app.get<{ Params: { slug: string } }>('/exercises/:slug/guide', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT e.slug, g.setup_callout, g.setup_facts, g.cues, g.donts, g.media
       FROM exercise_guides g
       JOIN exercises e ON e.id = g.exercise_id
       WHERE e.slug=$1 AND e.archived_at IS NULL AND g.archived_at IS NULL`,
      [req.params.slug],
    );
    if (rows.length === 0) {
      reply.code(404);
      return { error: 'guide not found', field: 'slug' };
    }
    reply.header('cache-control', 'public, max-age=300, stale-while-revalidate=86400');
    return rows[0] as ExerciseGuideResponse;
  });

  app.get<{ Params: { slug: string }; Querystring: { limit?: string } }>(
    '/exercises/:slug/history',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = requireUserId(req);
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '8', 10) || 8, 1), 20);
      const {
        rows: [ex],
      } = await db.query<{ id: string }>(
        `SELECT id FROM exercises WHERE slug=$1 AND archived_at IS NULL`,
        [req.params.slug],
      );
      if (!ex) {
        reply.code(404);
        return { error: 'exercise not found', field: 'slug' };
      }

      // One session = one calendar day of logs for this user+exercise.
      // Day boundaries resolve in the user's own timezone (users.timezone,
      // same convention computeUserLocalDate applies in getTodayWorkout) —
      // a 7:30pm Chicago set must not land on the next UTC day, and a
      // workout crossing UTC midnight must not split into two sessions.
      // Set order carries created_at + id tiebreakers so offline-queue
      // flushes that share a performed_at second stay deterministic.
      const { rows } = await db.query<{
        date: string;
        // set_logs weight/reps columns are nullable and this query doesn't
        // filter nulls — a reps-only bodyweight log emits weight_lbs: null.
        sets: {
          weight_lbs: number | null;
          reps: number | null;
          duration_sec: number | null;
          rir: number | null;
        }[];
      }>(
        `SELECT to_char((sl.performed_at AT TIME ZONE COALESCE(u.timezone, 'UTC'))::date, 'YYYY-MM-DD') AS date,
                json_agg(json_build_object(
                  'weight_lbs', sl.performed_load_lbs::float,
                  'reps', sl.performed_reps,
                  'duration_sec', sl.performed_duration_sec,
                  'rir', sl.performed_rir
                ) ORDER BY sl.performed_at ASC, sl.created_at ASC, sl.id ASC) AS sets
         FROM set_logs sl
         JOIN users u ON u.id = sl.user_id
         WHERE sl.user_id = $1 AND sl.exercise_id = $2
         GROUP BY (sl.performed_at AT TIME ZONE COALESCE(u.timezone, 'UTC'))::date
         ORDER BY (sl.performed_at AT TIME ZONE COALESCE(u.timezone, 'UTC'))::date DESC
         LIMIT $3`,
        [userId, ex.id, limit],
      );
      reply.header('cache-control', 'private, max-age=60');
      reply.header('vary', 'Authorization');
      // All-time longest hold for this user+exercise (measurement model):
      // powers the logger's "new best hold" toast. NULL when the exercise has
      // no duration logs — reps exercises pay one cheap indexed aggregate.
      const {
        rows: [best],
      } = await db.query<{ best_duration_sec: number | null }>(
        `SELECT MAX(performed_duration_sec)::int AS best_duration_sec
         FROM set_logs WHERE user_id = $1 AND exercise_id = $2`,
        [userId, ex.id],
      );
      return { sessions: rows, best_duration_sec: best?.best_duration_sec ?? null };
    },
  );

  app.get<{ Params: { slug: string } }>(
    '/exercises/:slug/substitutions',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = requireUserId(req);
      const { rows } = await db.query<{ equipment_profile: Record<string, unknown> }>(
        `SELECT equipment_profile FROM users WHERE id=$1`,
        [userId],
      );
      if (rows.length === 0) {
        reply.code(404);
        return { error: 'user not found' };
      }
      // Beta W3.2 — pass userId so findSubstitutions invokes the injuryRanker
      // and tags candidates whose joint_stress_profile overlaps the caller's
      // recorded user_injuries.
      const result = await findSubstitutions(req.params.slug, rows[0].equipment_profile, userId);
      if (!result) {
        reply.code(404);
        return { error: 'exercise not found', field: 'slug' };
      }
      reply.header('cache-control', 'private, max-age=60');
      reply.header('vary', 'Authorization');
      const subResp: SubstitutionResponse = result as SubstitutionResponse;
      return subResp;
    },
  );
}
