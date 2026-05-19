/**
 * logBuffer — HTTP flusher built on top of idbQueue.
 *
 * Wraps the durable IndexedDB queue (W1.3.1) with:
 *   • POST /api/set-logs transport
 *   • Exponential backoff with ±25% jitter, cap 30s
 *   • Status mapping: 200/201 → markSynced, 409 audit_window_expired and 404
 *     planned_set_deleted → markRejected, 5xx + network errors → leave pending
 *     and bump attempt_count, 401 + CFAccess → leave pending without bumping
 *     and emit a window event so W1.3.7 can surface the re-auth banner.
 *
 * Attempt cap discipline: rows with attempt_count >= 5 are SKIPPED (not
 * auto-rejected). User-entered training data is sacred; the W1.3.5
 * LogBufferRecovery banner will surface stalled rows so the user can decide.
 *
 * Reentrancy: flush() is guarded by a module-private isFlushing flag so the
 * online-event listener firing twice (or enqueue+online racing) collapses to a
 * single tick. Retries do NOT happen inside flush() — the next external invoker
 * (online event, periodic poll, next enqueue) drives the retry.
 */

import { idbQueue, QueueFullError, type PendingSetLog } from './idbQueue';

export interface EnqueueFields {
  weight_lbs: number | null;
  reps: number | null;
  rir: number | null;
  rpe?: number | null;
  performed_at: string; // ISO with offset
  notes?: string | null;
}

const ENDPOINT = '/api/set-logs';
const MAX_ATTEMPTS = 5;
const BACKOFF_CAP_SECONDS = 30;

function mintClientRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Exponential backoff with ±25% jitter.
 *   delay = min(2^attempt, 30) seconds, then ±25% jitter.
 * Exported for direct unit testing.
 */
export function computeBackoffMs(attemptCount: number): number {
  const baseSec = Math.min(Math.pow(2, attemptCount), BACKOFF_CAP_SECONDS);
  const baseMs = baseSec * 1000;
  const jitter = (Math.random() * 0.5 - 0.25) * baseMs; // [-25%, +25%]
  return Math.round(baseMs + jitter);
}

async function postSetLog(row: PendingSetLog): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      client_request_id: row.client_request_id,
      planned_set_id: row.planned_set_id,
      weight_lbs: row.weight_lbs,
      reps: row.reps,
      rir: row.rir,
      rpe: row.rpe,
      performed_at: row.performed_at,
      notes: row.notes,
    }),
  });
}

function isCFAccess401(res: Response): boolean {
  if (res.status !== 401) return false;
  const wwwAuth = res.headers?.get?.('WWW-Authenticate') ?? '';
  return /CFAccess/i.test(wwwAuth);
}

function emitCFAccessExpired(): void {
  window.dispatchEvent(new CustomEvent('cf-access-expired'));
}

async function bumpAttempt(row: PendingSetLog): Promise<void> {
  // next_attempt_at is set BEFORE attempt_count bump so the backoff math uses
  // the current attempt's window.
  const nextAt = Date.now() + computeBackoffMs(row.attempt_count);
  await idbQueue.enqueue({
    ...row,
    attempt_count: row.attempt_count + 1,
    next_attempt_at: nextAt,
    updated_at: Date.now(),
  });
}

let isFlushing = false;

async function flushOnce(): Promise<void> {
  const pending = await idbQueue.peekPending();
  const now = Date.now();
  // FIFO, gated by next_attempt_at and the soft attempt cap.
  const eligible = pending.filter(
    r => r.next_attempt_at <= now && r.attempt_count < MAX_ATTEMPTS,
  );

  for (const row of eligible) {
    let res: Response;
    try {
      res = await postSetLog(row);
    } catch {
      // Network error — treat as 5xx.
      await bumpAttempt(row);
      continue;
    }

    if (res.ok) {
      // 200 (deduped) or 201 (created) — row done.
      await idbQueue.markSynced(row.client_request_id);
      continue;
    }

    if (res.status === 404) {
      await idbQueue.markRejected(row.client_request_id, 'planned_set_deleted');
      continue;
    }

    if (res.status === 409) {
      // Spec: 409 from POST /api/set-logs is audit_window_expired.
      // We still parse the body defensively in case the server adds other 409
      // codes later — only treat audit_window_expired as a terminal rejection.
      const body = await res.text().catch(() => '');
      let parsed: { error?: string } = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { /* keep empty */ }
      if (parsed.error === 'audit_window_expired') {
        await idbQueue.markRejected(row.client_request_id, 'audit_window_expired');
      } else {
        // Unknown 409 — retry as if transient.
        await bumpAttempt(row);
      }
      continue;
    }

    if (isCFAccess401(res)) {
      // Session is the problem, not the row. Leave attempt_count untouched so
      // the user's data doesn't burn retries while they're logged out.
      emitCFAccessExpired();
      // Stop the tick — every other row will hit the same 401.
      break;
    }

    // 5xx or anything else → transient, retry next tick.
    await bumpAttempt(row);
  }
}

export const logBuffer = {
  async enqueue(
    plannedSetId: string,
    fields: EnqueueFields,
    queueOwnerUserId: string,
  ): Promise<string> {
    const id = mintClientRequestId();
    const now = Date.now();
    const row: PendingSetLog = {
      client_request_id: id,
      queue_owner_user_id: queueOwnerUserId,
      planned_set_id: plannedSetId,
      performed_at: fields.performed_at,
      weight_lbs: fields.weight_lbs,
      reps: fields.reps,
      rir: fields.rir,
      rpe: fields.rpe ?? null,
      notes: fields.notes ?? null,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: 0,
      created_at: now,
      updated_at: now,
    };
    // QueueFullError propagates — UI surfaces O6 banner.
    await idbQueue.enqueue(row);
    if (navigator.onLine) {
      // Fire-and-forget; the reentrancy guard collapses overlapping flushes.
      void logBuffer.flush();
    }
    return id;
  },

  async flush(): Promise<void> {
    if (isFlushing) return;
    if (!navigator.onLine) return;
    isFlushing = true;
    try {
      await flushOnce();
    } finally {
      isFlushing = false;
    }
  },

  onReconnect(): () => void {
    const handler = (): void => { void logBuffer.flush(); };
    window.addEventListener('online', handler);
    return () => { window.removeEventListener('online', handler); };
  },
};

// Re-export for callers that need to differentiate quota errors.
export { QueueFullError };
