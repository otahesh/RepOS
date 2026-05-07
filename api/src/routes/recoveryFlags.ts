// api/src/routes/recoveryFlags.ts
// GET /api/recovery-flags
// Evaluates recovery flags for the authenticated user and returns triggered,
// non-dismissed flags for the current ISO week.
//
// POST /api/recovery-flags/dismiss
// Records a dismissal for (user, flag, week_start). Re-fires next week.

import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import {
  evaluateAll,
  bodyweightCrashEvaluator,
  registerEvaluator,
  type EvaluatedFlag,
} from '../services/recoveryFlags.js';
import { isDismissed, recordDismissal } from '../services/recoveryFlagDismissals.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import {
  KNOWN_FLAGS,
  RecoveryFlagDismissRequestSchema,
  type RecoveryFlagListResponse,
} from '../schemas/recoveryFlags.js';

export async function recoveryFlagRoutes(app: FastifyInstance) {
  // Register evaluators inside the setup function (not at module scope) so that
  // the unit-test _resetRegistryForTest() beforeEach doesn't stomp this registration.
  registerEvaluator(bodyweightCrashEvaluator);

  app.get('/recovery-flags', { preHandler: requireBearerOrCfAccess }, async (req) => {
    const userId = (req as any).userId as string;

    // v1 only ships bodyweight_crash which doesn't read run context; future
    // evaluators (overreaching, stalled_pr) will populate these from active mesocycle_run.
    const ctx = {
      userId,
      runId: null as string | null,
      weekIdx: 1,
    };

    // Compute current ISO-week Monday for dismissal lookup (TZ-stable via Postgres)
    const { rows: [{ week_start }] } = await db.query<{ week_start: string }>(
      `SELECT to_char(date_trunc('week', current_date)::date, 'YYYY-MM-DD') AS week_start`,
    );

    const triggered = (await evaluateAll(ctx))
      .filter((f): f is Extract<EvaluatedFlag, { triggered: true }> => f.triggered);

    const flags: RecoveryFlagListResponse['flags'] = [];
    for (const f of triggered) {
      const dismissed = await isDismissed({ userId, flag: f.key, weekStart: week_start });
      if (dismissed) continue;
      flags.push({
        flag: f.key as RecoveryFlagListResponse['flags'][number]['flag'],
        message: f.message,
        ...(typeof f.payload?.trend_7d_lbs === 'number'
          ? { trend_7d_lbs: f.payload.trend_7d_lbs }
          : {}),
      });
    }

    const flagsResp: RecoveryFlagListResponse = { flags };
    return flagsResp;
  });

  app.post<{ Body: unknown }>(
    '/recovery-flags/dismiss',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;

      const parsed = RecoveryFlagDismissRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }

      // Compute current ISO-week Monday (TZ-stable via Postgres, same formula as GET)
      const { rows: [{ week_start }] } = await db.query<{ week_start: string }>(
        `SELECT to_char(date_trunc('week', current_date)::date, 'YYYY-MM-DD') AS week_start`,
      );

      await recordDismissal({ userId, flag: parsed.data.flag, weekStart: week_start });

      reply.code(204);
      return null;
    },
  );
}
