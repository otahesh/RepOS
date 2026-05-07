import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import type { MuscleListResponse } from '../schemas/muscles.js';

export async function muscleRoutes(app: FastifyInstance) {
  app.get('/muscles', async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT id, slug, name, group_name, display_order
       FROM muscles ORDER BY display_order ASC`,
    );
    reply.header('cache-control', 'public, max-age=86400');
    const resp: MuscleListResponse = { muscles: rows as MuscleListResponse['muscles'] };
    return resp;
  });
}
