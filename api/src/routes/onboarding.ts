// api/src/routes/onboarding.ts
// Beta W2.2 — onboarding-complete writer. Idempotent on completed_at
// (first-write wins via COALESCE), but goal can be updated on later
// calls because the wizard's GoalStep is the canonical entry point for
// users.goal in v1 (see migration 026; goal default is 'maintain').
//
// Mount path: /api/me/onboarding/complete (panel C-MOUNT-PATH).
// Scope: account:write (panel C-SCOPE).
// Account event: 'onboarding_completed' via recordAccountEventTx (panel D8;
// W6 owns the enum value, already merged, so emitted in-transaction).
// Auth-missing handling: empty UPDATE...RETURNING → 500 auth_state_missing
// (panel I-AUTH-MISSING).
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import {
  OnboardingCompleteRequestSchema,
  type OnboardingCompleteResponse,
} from '../schemas/onboarding.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import { recordAccountEventTx } from '../services/accountEvents.js';
import { clientIp } from '../utils/clientIp.js';

export async function onboardingRoutes(app: FastifyInstance) {
  app.post(
    '/me/onboarding/complete',
    { preHandler: [requireBearerOrCfAccess, requireScope('account:write')] },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      const ip = clientIp(req) ?? '';
      const parsed = OnboardingCompleteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ onboarding_completed_at: string; email: string }>(
          `UPDATE users
              SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
                  goal = $2
            WHERE id = $1
            RETURNING
              to_char(onboarding_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS onboarding_completed_at,
              email`,
          [userId, parsed.data.goal],
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          reply.code(500);
          return { error: 'auth_state_missing' };
        }
        const row = rows[0];

        await recordAccountEventTx(client, {
          userId,
          userEmail: row.email,
          kind: 'onboarding_completed',
          ip: ip || null,
          meta: {
            version: 1,
            goal: parsed.data.goal,
          },
        });

        await client.query('COMMIT');
        const resp: OnboardingCompleteResponse = {
          onboarding_completed_at: row.onboarding_completed_at,
        };
        return resp;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        client.release();
      }
    },
  );
}
