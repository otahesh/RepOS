// api/src/routes/recoveryFlags.ts
// GET /api/recovery-flags
// Evaluates recovery flags for the authenticated user and returns triggered,
// non-dismissed flags for the current ISO week.
//
// POST /api/recovery-flags/dismiss
// Records a dismissal for (user, flag, week_start). Re-fires next week.
//
// W3.1 additions:
//   - Registers stalledPrEvaluator + overreachingEvaluator alongside the
//     existing bodyweightCrashEvaluator.
//   - Populates ctx.runId from the user's active mesocycle_run so the
//     stalled-PR + overreaching evaluators (which read run-anchored state)
//     can fire. bodyweightCrash ignores runId so existing behavior is
//     preserved when no active run exists.
//   - Writes recovery_flag_events telemetry on every shown emit and on each
//     dismiss, for the post-cohort tuning pass on W3 thresholds.

import type { FastifyInstance } from 'fastify';
import { requireUserId } from '../utils/requestIdentity.js';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { requireScope } from '../middleware/scope.js';
import {
  evaluateAll,
  bodyweightCrashEvaluator,
  registerEvaluator,
  type EvaluatedFlag,
} from '../services/recoveryFlags.js';
import { stalledPrEvaluator } from '../services/stalledPrEvaluator.js';
import { overreachingEvaluator } from '../services/overreachingEvaluator.js';
import { isDismissed, recordDismissal } from '../services/recoveryFlagDismissals.js';
import { recordFlagShown, recordFlagDismissed } from '../services/recoveryFlagEvents.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import {
  RecoveryFlagDismissRequestSchema,
  type RecoveryFlagKey,
  type RecoveryFlagListResponse,
} from '../schemas/recoveryFlags.js';

export async function recoveryFlagRoutes(app: FastifyInstance) {
  // Register evaluators inside the setup function (not at module scope) so that
  // the unit-test _resetRegistryForTest() beforeEach doesn't stomp this registration.
  registerEvaluator(bodyweightCrashEvaluator);
  registerEvaluator(stalledPrEvaluator);
  registerEvaluator(overreachingEvaluator);

  app.get(
    '/recovery-flags',
    {
      preHandler: [requireBearerOrCfAccess, requireScope('health:recovery:read')],
    },
    async (req) => {
      const userId = requireUserId(req);

      // Resolve the user's active mesocycle_run so run-anchored evaluators
      // (stalled_pr, overreaching) can read current_week + program context.
      // bodyweightCrash ignores runId so absence is harmless.
      const { rows: runRows } = await db.query<{ id: string; current_week: number }>(
        `SELECT id, current_week FROM mesocycle_runs
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );
      const ctx = {
        userId,
        runId: runRows[0]?.id ?? null,
        weekIdx: runRows[0]?.current_week ?? 1,
      };

      // Compute current ISO-week Monday for dismissal lookup (TZ-stable via Postgres)
      const {
        rows: [{ week_start }],
      } = await db.query<{ week_start: string }>(
        `SELECT to_char(date_trunc('week', current_date)::date, 'YYYY-MM-DD') AS week_start`,
      );

      const triggered = (await evaluateAll(ctx)).filter(
        (f): f is Extract<EvaluatedFlag, { triggered: true }> => f.triggered,
      );

      const flags: RecoveryFlagListResponse['flags'] = [];
      const visibleKeys: RecoveryFlagKey[] = [];
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
        visibleKeys.push(f.key as RecoveryFlagKey);
      }

      // [FIX-6] EvaluatedFlag's discriminator is `key` (not `flag`). We track
      // f.key into visibleKeys above so the telemetry write here uses the
      // evaluator key directly. Append-only on first emit per (user, flag,
      // week); subsequent polls dedupe via the partial unique index.
      for (const key of visibleKeys) {
        await recordFlagShown({ userId, flag: key });
      }

      const flagsResp: RecoveryFlagListResponse = { flags };
      return flagsResp;
    },
  );

  app.post<{ Body: unknown }>(
    '/recovery-flags/dismiss',
    { preHandler: [requireBearerOrCfAccess, requireScope('health:recovery:read')] },
    async (req, reply) => {
      const userId = requireUserId(req);

      const parsed = RecoveryFlagDismissRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return zodToFieldError(parsed.error);
      }

      // Compute current ISO-week Monday (TZ-stable via Postgres, same formula as GET)
      const {
        rows: [{ week_start }],
      } = await db.query<{ week_start: string }>(
        `SELECT to_char(date_trunc('week', current_date)::date, 'YYYY-MM-DD') AS week_start`,
      );

      await recordDismissal({ userId, flag: parsed.data.flag, weekStart: week_start });
      await recordFlagDismissed({ userId, flag: parsed.data.flag });

      reply.code(204);
      return null;
    },
  );
}
