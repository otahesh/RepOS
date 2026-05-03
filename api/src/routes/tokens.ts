import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import argon2 from 'argon2';
import { db } from '../db/client.js';

// Admin key guard: when ADMIN_API_KEY is set, the X-Admin-Key header must match.
// When unset (local dev / test environments), the check is skipped.
// In production, always set ADMIN_API_KEY to a high-entropy secret.
async function requireAdminKey(req: FastifyRequest, reply: FastifyReply) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return; // unset → open (dev/test only)
  if (req.headers['x-admin-key'] !== adminKey) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

export async function tokenRoutes(app: FastifyInstance) {
  // Mint a new device token — protected by admin API key in production
  app.post<{ Body: { user_id: string; label?: string } }>(
    '/tokens',
    { preHandler: requireAdminKey },
    async (req, reply) => {
      const { user_id, label } = req.body;
      if (!user_id) return reply.code(400).send({ error: 'user_id required' });

      // Token format: "<16-hex-prefix>.<64-hex-secret>"
      // Stored as "<prefix>:<argon2hash>" so auth can do a fast indexed lookup
      // instead of scanning the full table and running argon2 on every row.
      const prefix = randomBytes(8).toString('hex'); // 16 hex chars
      const secret = randomBytes(32).toString('hex'); // 64 hex chars
      const plaintext = `${prefix}.${secret}`;
      const hash = await argon2.hash(secret);
      const storedHash = `${prefix}:${hash}`;

      const { rows } = await db.query(
        `INSERT INTO device_tokens (user_id, token_hash, label)
         VALUES ($1, $2, $3) RETURNING id, created_at`,
        [user_id, storedHash, label ?? null],
      );

      return reply.code(201).send({ id: rows[0].id, token: plaintext, created_at: rows[0].created_at });
    },
  );

  // List active tokens for a user — protected by admin API key in production
  app.get<{ Querystring: { user_id?: string } }>(
    '/tokens',
    { preHandler: requireAdminKey },
    async (req, reply) => {
      const { user_id } = req.query;
      if (!user_id) return reply.code(400).send({ error: 'user_id required' });

      const { rows } = await db.query(
        `SELECT id, label, created_at, last_used_at
         FROM device_tokens
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [user_id],
      );
      return reply.send(rows);
    },
  );

  // Revoke a token — protected by admin API key in production
  app.delete<{ Params: { id: string } }>(
    '/tokens/:id',
    { preHandler: requireAdminKey },
    async (req, reply) => {
      const { rowCount } = await db.query(
        `UPDATE device_tokens SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [req.params.id],
      );
      if (!rowCount) return reply.code(404).send({ error: 'not found' });
      return reply.code(204).send();
    },
  );
}
