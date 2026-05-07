import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { findSubstitutions } from '../services/substitutions.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import type {
  ExerciseListResponse,
  SubstitutionResponse,
} from '../schemas/exercises.js';

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
    const { rows } = await db.query(`
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
    `, [req.params.slug]);
    if (rows.length === 0) {
      reply.code(404);
      return { error: 'exercise not found', field: 'slug' };
    }
    reply.header('cache-control', 'public, max-age=300, stale-while-revalidate=86400');
    return rows[0];
  });

  app.get<{ Params: { slug: string } }>(
    '/exercises/:slug/substitutions',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const { rows } = await db.query<{ equipment_profile: Record<string, unknown> }>(
        `SELECT equipment_profile FROM users WHERE id=$1`, [userId]
      );
      if (rows.length === 0) { reply.code(404); return { error: 'user not found' }; }
      const result = await findSubstitutions(req.params.slug, rows[0].equipment_profile);
      if (!result) { reply.code(404); return { error: 'exercise not found', field: 'slug' }; }
      reply.header('cache-control', 'private, max-age=60');
      reply.header('vary', 'Authorization');
      const subResp: SubstitutionResponse = result as SubstitutionResponse;
      return subResp;
    },
  );
}
