import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';

export async function programRoutes(app: FastifyInstance) {
  app.get('/program-templates', async (_req, reply) => {
    const { rows } = await db.query(`
      SELECT id, slug, name, description, weeks, days_per_week, version, created_at
      FROM program_templates
      WHERE archived_at IS NULL
      ORDER BY slug ASC
    `);
    reply.header('cache-control', 'public, max-age=300');
    return { templates: rows };
  });

  app.get<{ Params: { slug: string } }>('/program-templates/:slug', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT id, slug, name, description, weeks, days_per_week, structure, version,
              seed_key, seed_generation, created_at
       FROM program_templates
       WHERE slug=$1 AND archived_at IS NULL`,
      [req.params.slug],
    );
    if (rows.length === 0) {
      reply.code(404);
      return { error: 'template not found', field: 'slug' };
    }
    reply.header('cache-control', 'public, max-age=300');
    return rows[0];
  });

  app.post<{ Params: { slug: string } }>(
    '/program-templates/:slug/fork',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const { rows: [tmpl] } = await db.query(
        `SELECT id, version, name FROM program_templates
         WHERE slug=$1 AND archived_at IS NULL`,
        [req.params.slug],
      );
      if (!tmpl) {
        reply.code(404);
        return { error: 'template not found', field: 'slug' };
      }
      const { rows: [up] } = await db.query(
        `INSERT INTO user_programs
         (user_id, template_id, template_version, name, customizations, status)
         VALUES ($1, $2, $3, $4, '{}'::jsonb, 'draft')
         RETURNING id, template_id, template_version, name, customizations, status, created_at`,
        [userId, tmpl.id, tmpl.version, tmpl.name],
      );
      reply.code(201);
      return up;
    },
  );
}
