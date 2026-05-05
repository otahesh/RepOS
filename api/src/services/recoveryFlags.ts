// api/src/services/recoveryFlags.ts
// Registry-shaped evaluator surface so #3 can plug in overreaching +
// stalled-PR evaluators without schema or surface changes.

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
    const r = await ev.evaluate(ctx);
    if (r.triggered) out.push({ key: ev.key, triggered: true, message: r.message, payload: r.payload });
    else             out.push({ key: ev.key, triggered: false });
  }
  return out;
}

// For tests: clear registry between scenarios.
export function _resetRegistryForTest(): void { REGISTRY.clear(); }

import { db } from '../db/client.js';

/**
 * Trigger when the 7-day rolling trend is ≤ -2.0 lb AND the active program's
 * goal is not 'cut'. Goal lookup: user_programs.customizations.goal of the
 * user's active mesocycle_run, falling back to 'unspecified' (which is
 * treated as ≠ cut, so the flag may fire).
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
