// api/src/services/recoveryFlags.ts
// Registry-shaped evaluator surface so #3 can plug in overreaching +
// stalled-PR evaluators without schema or surface changes.

import { db } from '../db/client.js';

export type RecoveryFlagContext = {
  userId: string;
  runId: string | null;
  weekIdx: number;
};

export type RecoveryFlagResult =
  | { triggered: false }
  | { triggered: true; message: string; payload?: Record<string, unknown> };

export type RecoveryFlagEvaluator = {
  key: string;
  version: number;
  evaluate: (ctx: RecoveryFlagContext) => Promise<RecoveryFlagResult>;
};

const REGISTRY = new Map<string, RecoveryFlagEvaluator>();

export function registerEvaluator(ev: RecoveryFlagEvaluator): void {
  REGISTRY.set(ev.key, ev);
}

export function getRegisteredFlagKeys(): string[] {
  return Array.from(REGISTRY.keys()).sort();
}

export type EvaluatedFlag =
  | { key: string; triggered: false }
  | { key: string; triggered: true; message: string; payload?: Record<string, unknown> };

export async function evaluateAll(ctx: RecoveryFlagContext): Promise<EvaluatedFlag[]> {
  const out: EvaluatedFlag[] = [];
  for (const ev of REGISTRY.values()) {
    try {
      const r = await ev.evaluate(ctx);
      if (r.triggered) out.push({ key: ev.key, triggered: true, message: r.message, payload: r.payload });
      else             out.push({ key: ev.key, triggered: false });
    } catch (err) {
      // Fail-closed so one evaluator failure doesn't drop the others.
      console.error(`[recoveryFlags] evaluator '${ev.key}' threw`, err);
      out.push({ key: ev.key, triggered: false });
    }
  }
  return out;
}

// For tests: clear registry between scenarios.
export function _resetRegistryForTest(): void { REGISTRY.clear(); }

/**
 * Trigger when the 7-day weight trend is ≤ -2.0 lb AND the active program's
 * goal is not 'cut'.
 *
 * Trend is computed as (recent-half mean − older-half mean) inside an 8-day
 * window. With inclusive date boundaries on each half, the partition is:
 *   recent: sample_date >= CURRENT_DATE - INTERVAL '3 days'  (today + 3 prior = 4 dates)
 *   older:  sample_date <  CURRENT_DATE - INTERVAL '3 days'
 *           AND sample_date >= CURRENT_DATE - INTERVAL '8 days'  (4 dates)
 * Negative trend means losing weight. ≤ -2.0 fires the flag.
 *
 * If no active mesocycle_run/user_program is found, the goal check defaults
 * to "≠ cut" (flag may fire). If the program's goal is explicitly 'cut',
 * the flag is suppressed.
 */
export const bodyweightCrashEvaluator: RecoveryFlagEvaluator = {
  key: 'bodyweight_crash',
  version: 1,
  evaluate: async (ctx) => {
    const { rows } = await db.query<{ trend: number | null }>(
      `WITH recent AS (
         SELECT weight_lbs, sample_date
         FROM health_weight_samples
         WHERE user_id=$1 AND sample_date >= CURRENT_DATE - INTERVAL '8 days'
         ORDER BY sample_date ASC
       )
       SELECT (
         (SELECT AVG(weight_lbs)::float FROM recent
            WHERE sample_date >= CURRENT_DATE - INTERVAL '3 days')
         -
         (SELECT AVG(weight_lbs)::float FROM recent
            WHERE sample_date <  CURRENT_DATE - INTERVAL '3 days'
              AND sample_date >= CURRENT_DATE - INTERVAL '8 days')
       ) AS trend`,
      [ctx.userId],
    );
    const trend = rows[0]?.trend;
    if (trend === null || trend === undefined) return { triggered: false };
    if (trend > -2.0) return { triggered: false };

    const { rows: [up] } = await db.query<{ goal: string | null }>(
      `SELECT (up.customizations->>'goal')::text AS goal
       FROM mesocycle_runs mr
       JOIN user_programs up ON up.id=mr.user_program_id
       WHERE mr.user_id=$1 AND mr.status='active'
       ORDER BY mr.created_at DESC LIMIT 1`,
      [ctx.userId],
    );
    if (up?.goal === 'cut') return { triggered: false };

    return {
      triggered: true,
      message: 'Weight dropping fast — under-fueling will stall progress.',
      payload: { trend_7d_lbs: Number(trend.toFixed(2)) },
    };
  },
};
