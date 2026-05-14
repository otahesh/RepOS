import type { FastifyRequest, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { db } from '../db/client.js';

// Token format: "<16-hex-prefix>.<64-hex-secret>"
// Stored in device_tokens.token_hash as "<prefix>:<argon2hash-of-secret>"
// The prefix is used for a fast indexed lookup; argon2 only runs once per request.

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send();
  }
  const token = header.slice(7);

  // Parse prefix from the bearer token
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) {
    return reply.code(401).send();
  }
  const prefix = token.slice(0, dotIdx);
  const secret = token.slice(dotIdx + 1);

  // Look up by prefix — at most one row; no table scan. `scopes` is pulled
  // alongside id/user_id so requireScope (api/src/middleware/scope.ts) can
  // gate writes without a second DB round-trip.
  const { rows } = await db.query(
    `SELECT id, user_id, token_hash, scopes
     FROM device_tokens
     WHERE token_hash LIKE $1 AND revoked_at IS NULL`,
    [`${prefix}:%`],
  );

  if (rows.length === 0) {
    return reply.code(401).send();
  }

  const row = rows[0];
  // Strip the "<prefix>:" prefix from the stored composite to get the bare argon2 hash
  const storedHash = row.token_hash.slice(prefix.length + 1);

  if (!(await argon2.verify(storedHash, secret))) {
    return reply.code(401).send();
  }

  await db.query(
    `UPDATE device_tokens SET last_used_at = now(), last_used_ip = $1 WHERE id = $2`,
    [req.ip, row.id],
  );
  (req as any).userId = row.user_id as string;
  // Empty array (rather than undefined) on the bearer path so requireScope
  // can distinguish "bearer with zero scopes" (403) from "no bearer used,
  // CF Access took over" (pass-through).
  (req as any).tokenScopes = (row.scopes as string[] | null) ?? [];
}
