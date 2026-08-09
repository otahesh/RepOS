/**
 * Frontend client for /api/cardio-logs (measurement model phase 2).
 * Manually kept in sync with api/src/schemas/cardioLogs.ts — see
 * api/src/schemas/README.md for the cross-package type mirror strategy.
 *
 * Deliberate scope decision (plan Task 18): cardio logging does NOT ride the
 * idbQueue offline pipeline — completing a cardio block is a single
 * post-session tap (not 20 mid-set taps), the POST is idempotent per
 * client_request_id so retry-by-tap is always safe, and failure surfaces an
 * inline retry affordance instead of a background queue. Offline parity is a
 * stated deferral, not an oversight.
 */

import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export { ApiError } from './_http';

export interface CardioLogPost {
  client_request_id: string;
  planned_cardio_block_id: string;
  duration_sec: number;
  distance_m?: number;
  srpe?: number;
  performed_at: string;
  notes?: string;
}

export interface CardioLogRow {
  id: string;
  planned_cardio_block_id: string;
  duration_sec: number;
  distance_m: number | null;
  srpe: number | null;
  source: 'manual' | 'apple_health';
  performed_at: string;
}

export async function postCardioLog(
  body: CardioLogPost,
): Promise<{ deduped: boolean; cardio_log: CardioLogRow }> {
  const res = await apiFetch('/api/cardio-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}
