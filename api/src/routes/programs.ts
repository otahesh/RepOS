import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';

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
}
