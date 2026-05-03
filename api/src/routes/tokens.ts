import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import argon2 from 'argon2';
import { db } from '../db/client.js';
import { requireAdminKeyOrCfAccess } from '../middleware/cfAccess.js';

// Token mint / list / revoke. Two auth modes:
//   - admin   : body/query supplies user_id (CLI, tests, ops scripts).
//               Gated by X-Admin-Key when ADMIN_API_KEY is set.
//   - cf_access: user_id derived from the verified CF Access JWT — body /
//                query user_id is ignored. The browser path.
// `requireAdminKeyOrCfAccess` sets req.authMode + req.userId accordingly.

function userIdFromReq(req: any, fallback: string | undefined): string | undefined {
  return req.authMode === 'cf_access' ? (req.userId as string) : fallback;
}

export async function tokenRoutes(app: FastifyInstance) {
  app.post<{ Body: { user_id?: string; label?: string } }>(
    '/tokens',
    { preHandler: requireAdminKeyOrCfAccess },
    async (req, reply) => {
      const userId = userIdFromReq(req, req.body.user_id);
      if (!userId) return reply.code(400).send({ error: 'user_id required' });

      const prefix = randomBytes(8).toString('hex');
      const secret = randomBytes(32).toString('hex');
      const plaintext = `${prefix}.${secret}`;
      const hash = await argon2.hash(secret);
      const storedHash = `${prefix}:${hash}`;

      const { rows } = await db.query(
        `INSERT INTO device_tokens (user_id, token_hash, label)
         VALUES ($1, $2, $3) RETURNING id, created_at`,
        [userId, storedHash, req.body.label ?? null],
      );

      return reply.code(201).send({ id: rows[0].id, token: plaintext, created_at: rows[0].created_at });
    },
  );

  app.get<{ Querystring: { user_id?: string } }>(
    '/tokens',
    { preHandler: requireAdminKeyOrCfAccess },
    async (req, reply) => {
      const userId = userIdFromReq(req, req.query.user_id);
      if (!userId) return reply.code(400).send({ error: 'user_id required' });

      const { rows } = await db.query(
        `SELECT id, label, created_at, last_used_at
         FROM device_tokens
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [userId],
      );
      return reply.send(rows);
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { user_id?: string } }>(
    '/tokens/:id',
    { preHandler: requireAdminKeyOrCfAccess },
    async (req, reply) => {
      const userId = userIdFromReq(req, req.query.user_id);
      if (!userId) return reply.code(400).send({ error: 'user_id required' });
      // The user_id+id pair guards against a leaked admin key revoking a
      // different user's tokens — the UPDATE only fires when both match.
      const { rowCount } = await db.query(
        `UPDATE device_tokens SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [req.params.id, userId],
      );
      if (!rowCount) return reply.code(404).send({ error: 'not found' });
      return reply.code(204).send();
    },
  );
}
