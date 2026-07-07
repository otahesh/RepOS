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
 *
 * Status `'syncing'` from `PendingSetLog['status']` is intentionally unused here —
 * logBuffer keeps rows at `'pending'` end-to-end. Reserved for future at-most-once
 * enforcement.
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
  // IDB rows carry null for unset fields, but the API write schema is
  // optional-absent (z.number().optional()) — "rpe": null is a 400, so nulls
  // are stripped at the wire instead of serialized.
  const payload: Record<string, unknown> = {
    client_request_id: row.client_request_id,
    planned_set_id: row.planned_set_id,
    performed_at: row.performed_at,
  };
  if (row.weight_lbs != null) payload.weight_lbs = row.weight_lbs;
  if (row.reps != null) payload.reps = row.reps;
  if (row.rir != null) payload.rir = row.rir;
  if (row.rpe != null) payload.rpe = row.rpe;
  if (row.notes != null) payload.notes = row.notes;
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
}

// NOTE: production CF Access may issue a 302 redirect rather than 401 with this
// header on XHR. Verify against the live tunnel before W1.3.7 banner consumes
// the cf-access-expired event — if 302 is what we actually see, the detection
// logic needs to move to a `fetch.redirected` check or a global 401 interceptor.
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
    (r) => r.next_attempt_at <= now && r.attempt_count < MAX_ATTEMPTS,
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
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        /* keep empty */
      }
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
    // Watchdog: if `flushOnce` hangs (e.g. Dexie connection wedged, fetch
    // never resolves due to a broken polyfill), the 2s AppShell retry tick
    // would become a permanent no-op and the queue would silently stop
    // draining. The watchdog races flushOnce against a 60s timeout and
    // force-releases the lock either way so the next tick can try again.
    const FLUSH_WATCHDOG_MS = 60_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        flushOnce(),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            try {
              // eslint-disable-next-line no-console
              console.warn('[logBuffer] flushOnce watchdog fired after 60s; releasing lock');
            } catch {
              /* logging never throws */
            }
            resolve();
          }, FLUSH_WATCHDOG_MS);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      isFlushing = false;
    }
  },

  onReconnect(): () => void {
    const handler = (): void => {
      void logBuffer.flush();
    };
    window.addEventListener('online', handler);
    return () => {
      window.removeEventListener('online', handler);
    };
  },
};

// Re-export for callers that need to differentiate quota errors.
export { QueueFullError };
