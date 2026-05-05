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
}
