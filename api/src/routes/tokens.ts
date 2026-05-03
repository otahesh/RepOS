import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import argon2 from 'argon2';
import { db } from '../db/client.js';

export async function tokenRoutes(app: FastifyInstance) {
  // Mint a new device token for a user
  app.post<{ Body: { user_id: string; label?: string } }>('/tokens', async (req, reply) => {
    const { user_id, label } = req.body;
    if (!user_id) return reply.code(400).send({ error: 'user_id required' });

    const plaintext = randomBytes(32).toString('hex');
    const hash = await argon2.hash(plaintext);

    const { rows } = await db.query(
      `INSERT INTO device_tokens (user_id, token_hash, label)
       VALUES ($1, $2, $3) RETURNING id, created_at`,
      [user_id, hash, label ?? null],
    );

    return reply.code(201).send({ id: rows[0].id, token: plaintext, created_at: rows[0].created_at });
  });

  // Revoke a token
  app.delete<{ Params: { id: string } }>('/tokens/:id', async (req, reply) => {
    const { rowCount } = await db.query(
      `UPDATE device_tokens SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [req.params.id],
    );
    if (!rowCount) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
