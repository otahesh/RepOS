import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';

export async function userProgramRoutes(app: FastifyInstance) {
  app.get('/user-programs', { preHandler: requireBearerOrCfAccess }, async (req, _reply) => {
    const userId = (req as any).userId as string;
    const { rows } = await db.query(
      `SELECT id, template_id, template_version, name, customizations, status, created_at, updated_at
       FROM user_programs
       WHERE user_id=$1 AND status <> 'archived'
       ORDER BY created_at DESC`,
      [userId],
    );
    return { programs: rows };
  });
}
