import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/client.js';

export async function syncRoutes(app: FastifyInstance) {
  app.get('/sync/status', { preHandler: requireAuth }, async (req, reply) => {
    const { rows: [row] } = await db.query(
      `SELECT source, last_success_at,
         CASE
           WHEN consecutive_failures >= 3 THEN 'broken'
           WHEN last_success_at IS NULL THEN 'broken'
           WHEN last_success_at > now() - interval '36 hours' THEN 'fresh'
           WHEN last_success_at > now() - interval '72 hours' THEN 'stale'
           ELSE 'broken'
         END AS state
       FROM health_sync_status WHERE user_id = $1`,
      [(req as any).userId],
    );

    reply.header('Cache-Control', 'max-age=60');
    return row ?? { source: null, last_success_at: null, state: 'broken' };
  });
}
