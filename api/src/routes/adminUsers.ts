// W9 — user management. Q20: CF Access + role='admin'; the X-Admin-Key path is
// rejected because it sets no actor.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireCfAccessAdmin } from '../middleware/cfAccess.js';
import { csrfOrigin } from '../middleware/csrfOrigin.js';
import { InviteRequestSchema } from '../schemas/adminUsers.js';
import {
  inviteUser, resendInvite, LifecycleError, type Actor,
} from '../services/userLifecycle.js';
import { LockTimeoutError } from '../services/membershipLock.js';

function actorOf(req: FastifyRequest): Actor {
  return {
    userId: (req as { userId?: string }).userId!,
    email: (req as { userEmail?: string }).userEmail!,
    ip: req.ip ?? null,
  };
}

/** Translate service errors into HTTP without leaking internals. */
export function sendLifecycleError(reply: import('fastify').FastifyReply, err: unknown): unknown {
  if (err instanceof LifecycleError) {
    return reply.code(err.statusCode).send({ error: err.code, ...err.details });
  }
  if (err instanceof LockTimeoutError) {
    // A wedged holder fails fast rather than blocking the pool (Q16).
    return reply
      .code(503)
      .send({ error: 'lock_timeout', retry_after_seconds: 2 });
  }
  throw err;
}

export async function adminUsersRoutes(app: FastifyInstance) {
  app.post(
    '/admin/users/invite',
    { preHandler: [requireCfAccessAdmin(), csrfOrigin] },
    async (req, reply) => {
      const parsed = InviteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }
      const actor = actorOf(req);
      // Q13 — no operation may target yourself from the admin list.
      if (parsed.data.email === actor.email.toLowerCase()) {
        return reply.code(409).send({ error: 'self_target_forbidden' });
      }
      try {
        const out = await inviteUser(parsed.data.email, parsed.data.role, actor);
        // 201 ONLY when a row was created. Inferring this from `resent` /
        // `resynced` breaks as soon as a duplicate-invite branch legitimately
        // reports resent:false, which the synced-but-never-delivered retry
        // does.
        return reply.code(out.created ? 201 : 200).send(out);
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/users/:id/resend-invite',
    { preHandler: [requireCfAccessAdmin(), csrfOrigin] },
    async (req, reply) => {
      try {
        return reply.code(200).send(await resendInvite(req.params.id, actorOf(req)));
      } catch (err) {
        return sendLifecycleError(reply, err);
      }
    },
  );
}
