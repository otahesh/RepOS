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
