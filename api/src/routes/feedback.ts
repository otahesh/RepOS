// Beta W7 — in-app feedback ingest. Identity comes from the authenticated
// request (req.userId), never the body. The webhook is fired without awaiting
// so a slow/broken Discord never blocks the user's submit.
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';
import { FeedbackCreateSchema } from '../schemas/feedback.js';
import { deliverFeedbackWebhook } from '../lib/feedbackWebhook.js';

export async function feedbackRoutes(app: FastifyInstance) {
  app.post(
    '/feedback',
    { preHandler: [requireBearerOrCfAccess, csrfOrigin] },
    async (req, reply) => {
      const userId = (req as { userId?: string }).userId;
      if (!userId) return reply.code(500).send({ error: 'auth_state_missing' });

      const parsed = FeedbackCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }

      // The bearer path doesn't populate userEmail; re-read it (same precedent as
      // account.ts) so the row + Discord embed carry a human identifier.
      let email = (req as { userEmail?: string }).userEmail;
      if (!email) {
        const { rows } = await db.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [
          userId,
        ]);
        email = rows[0]?.email;
      }

      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO feedback (user_id, user_email_at_submit, body, route, app_sha, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          userId,
          email ?? null,
          parsed.data.body,
          parsed.data.route ?? null,
          process.env.APP_SHA ?? 'dev',
          req.headers['user-agent'] ?? null,
        ],
      );
      const id = rows[0].id;

      // Advisory: fire-and-forget. Errors are logged, never surfaced to the user.
      void deliverFeedbackWebhook(id).catch((err) =>
        req.log.error({ err }, 'feedback_webhook_failed'),
      );

      return reply.code(201).send({ id });
    },
  );
}
