// api/src/routes/authSignout.ts
//
// Beta W6 Task 8 — POST /api/auth/signout-everywhere.
//
// Revokes every non-revoked device_token for the authenticated user, records a
// single `signout_everywhere` audit event, and clears the CF Access cookie via
// Set-Cookie. Always returns 204 on success (idempotent — a second call with
// zero rows still 204s and still writes an audit event with revoked_count=0).
//
// Auth: CF-Access-JWT-only (per C-SIGNOUT-CFACCESS-ONLY) — a stolen bearer
// must NEVER be able to lock the legitimate user out of their own account.
// `requireCfAccessOnly` 403s on any Authorization: Bearer header before JWT
// validation, and stamps `authMode='cf_access'` so the chained `csrfOrigin`
// preHandler enforces the Origin guard.
//
// Atomicity: UPDATE device_tokens + INSERT account_events run inside a single
// BEGIN/COMMIT txn against a pooled client. On error we ROLLBACK and 500
// `signout_failed` — never leave the audit row without the matching revoke,
// or vice versa.

import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireCfAccessOnly } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';
import { clientIp } from '../utils/clientIp.js';

export async function authSignoutRoutes(app: FastifyInstance) {
  app.post(
    '/auth/signout-everywhere',
    { preHandler: [requireCfAccessOnly, csrfOrigin] },
    async (req, reply) => {
      const userId = (req as { userId?: string }).userId;
      const userEmail = (req as { userEmail?: string }).userEmail;
      if (!userId || !userEmail) {
        return reply.code(500).send({ error: 'auth_state_missing' });
      }

      const client = await db.connect();
      let rowCount: number;
      try {
        await client.query('BEGIN');
        const res = await client.query(
          `UPDATE device_tokens
              SET revoked_at = now(), revoke_reason = 'signout_everywhere'
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        rowCount = res.rowCount ?? 0;
        await client.query(
          `INSERT INTO account_events (user_id, user_id_at_event, user_email_at_event, kind, ip, meta)
           VALUES ($1, $1, $2, 'signout_everywhere', $3, $4::jsonb)`,
          [userId, userEmail, clientIp(req), JSON.stringify({ revoked_count: rowCount })],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        req.log.error({ err }, 'signout_everywhere_failed');
        return reply.code(500).send({ error: 'signout_failed' });
      } finally {
        client.release();
      }

      // Clear the CF Access cookie on the browser. The CF Access edge also
      // owns its own session — this Set-Cookie is the local-RepOS half of the
      // signout. Attributes mirror what CF Access sets on first login.
      reply.header(
        'Set-Cookie',
        'CF_Authorization=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      );
      req.log.info(
        { event: 'signout_everywhere', userId, revoked_count: rowCount, ip: clientIp(req) },
        'signout_everywhere',
      );
      return reply.code(204).send();
    },
  );
}
