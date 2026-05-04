import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';

export async function muscleRoutes(app: FastifyInstance) {
  app.get('/muscles', async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT id, slug, name, group_name, display_order
       FROM muscles ORDER BY display_order ASC`,
    );
    reply.header('cache-control', 'public, max-age=86400');
    return { muscles: rows };
  });
}
