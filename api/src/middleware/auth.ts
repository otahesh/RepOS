import type { FastifyRequest, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { db } from '../db/client.js';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send();
  }
  const token = header.slice(7);

  const { rows } = await db.query(
    `SELECT id, user_id, token_hash, revoked_at
     FROM device_tokens
     WHERE revoked_at IS NULL`,
  );

  for (const row of rows) {
    if (await argon2.verify(row.token_hash, token)) {
      await db.query(
        `UPDATE device_tokens SET last_used_at = now(), last_used_ip = $1 WHERE id = $2`,
        [req.ip, row.id],
      );
      (req as any).userId = row.user_id as string;
      return;
    }
  }

  return reply.code(401).send();
}
