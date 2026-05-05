// api/src/routes/recoveryFlags.ts
// GET /api/recovery-flags
// Evaluates recovery flags for the authenticated user and returns triggered,
// non-dismissed flags for the current ISO week.

import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import {
  evaluateAll,
  bodyweightCrashEvaluator,
  registerEvaluator,
} from '../services/recoveryFlags.js';
import { isDismissed } from '../services/recoveryFlagDismissals.js';

export async function recoveryFlagRoutes(app: FastifyInstance) {
  // Register evaluators inside the setup function (not at module scope) so that
  // the unit-test _resetRegistryForTest() beforeEach doesn't stomp this registration.
  registerEvaluator(bodyweightCrashEvaluator);

  app.get('/recovery-flags', { preHandler: requireBearerOrCfAccess }, async (req) => {
    const userId = (req as any).userId as string;

    // Resolve active run context (type requires runId + weekIdx even if unused by evaluator)
    const { rows: [run] } = await db.query<{ id: string; current_week: number }>(
      `SELECT id, current_week FROM mesocycle_runs WHERE user_id=$1 AND status='active' LIMIT 1`,
      [userId],
    );
    const ctx = {
      userId,
      runId: run?.id ?? null,
      weekIdx: run?.current_week ?? 1,
    };

    // Compute current ISO-week Monday for dismissal lookup (TZ-stable via Postgres)
    const { rows: [{ week_start }] } = await db.query<{ week_start: string }>(
      `SELECT to_char(date_trunc('week', current_date)::date, 'YYYY-MM-DD') AS week_start`,
    );

    const all = await evaluateAll(ctx);
    const triggered = all.filter(f => f.triggered === true);

    const flags: Array<{ flag: string; message: string; trend_7d_lbs?: number }> = [];
    for (const f of triggered) {
      if (!f.triggered) continue; // narrow type
      const dismissed = await isDismissed({ userId, flag: f.key, weekStart: week_start });
      if (dismissed) continue;
      flags.push({
        flag: f.key,
        message: f.message,
        ...(typeof f.payload?.trend_7d_lbs === 'number'
          ? { trend_7d_lbs: f.payload.trend_7d_lbs }
          : {}),
      });
    }

    return { flags };
  });
}
