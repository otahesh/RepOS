// Beta W7 — admin triage surface. Admin-gated (X-Admin-Key OR CF Access +
// REPOS_ADMIN_EMAILS). List is untriaged-first, newest-first.
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireAdminKeyOrCfAccess } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';

const SELECT_COLS = `
  id, body, route, app_sha, user_email_at_submit,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  to_char(triaged_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS triaged_at,
  to_char(webhook_delivered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS webhook_delivered_at`;

export async function adminFeedbackRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>(
    '/admin/feedback',
    { preHandler: requireAdminKeyOrCfAccess() },
    async (req, reply) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 200);
      const { rows } = await db.query(
        `SELECT ${SELECT_COLS} FROM feedback ORDER BY triaged_at NULLS FIRST, created_at DESC LIMIT $1`,
        [limit],
      );
      return reply.send({ items: rows });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/feedback/:id/triage',
    { preHandler: [requireAdminKeyOrCfAccess(), csrfOrigin] },
    async (req, reply) => {
      const { id } = req.params;
      if (!/^\d+$/.test(id)) return reply.code(404).send({ error: 'not_found' });
      const { rows } = await db.query(
        `UPDATE feedback SET triaged_at = COALESCE(triaged_at, now()) WHERE id=$1 RETURNING ${SELECT_COLS}`,
        [id],
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'not_found' });
      return reply.send(rows[0]);
    },
  );
}
