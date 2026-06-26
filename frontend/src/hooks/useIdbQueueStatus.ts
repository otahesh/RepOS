import { useEffect, useState } from 'react';
import { idbQueue } from '../lib/idbQueue';
import type { PendingSetLog } from '../lib/idbQueue';

/**
 * Status surface for the live-logger row affordance.
 *
 *   • 'pending' — sitting in IDB, will flush on next tick or reconnect.
 *   • 'syncing' — in-flight POST; reserved (logBuffer.flushOnce currently
 *     keeps rows at 'pending' end-to-end).
 *   • 'synced'  — markSynced deleted the row; getStatus collapses "absent"
 *     to this. UI reads it as "logged ✓".
 *   • 'rejected' — terminal failure; user must review.
 *   • 'unknown' — no client_request_id yet (initial state before enqueue).
 */
export type QueueRowStatus = PendingSetLog['status'] | 'unknown';

const POLL_MS = 500;

/**
 * Polls `idbQueue.getStatus(clientRequestId)` every 500ms while the hook is
 * mounted. Returns 'unknown' when called with `null` (initial render before
 * the row has been enqueued).
 *
 * Why a poll and not Dexie's `liveQuery`:
 *   • The hook is single-row scoped; a 500ms tick is cheap.
 *   • Avoids cross-test contamination from a live observable that the test
 *     harness has to tear down.
 *   • idbQueue is the single source of truth — the hook never caches.
 *
 * Cleanup: the interval is cleared on unmount AND when `clientRequestId`
 * changes. A trailing pending getStatus() resolves after unmount; the result
 * is dropped by the `cancelled` flag so we don't setState on an unmounted
 * component.
 */
export function useIdbQueueStatus(clientRequestId: string | null): QueueRowStatus {
  const [status, setStatus] = useState<QueueRowStatus>('unknown');

  useEffect(() => {
    if (clientRequestId === null) {
      setStatus('unknown');
      return;
    }

    let cancelled = false;

    const tick = async (): Promise<void> => {
      try {
        const next = await idbQueue.getStatus(clientRequestId);
        if (cancelled) return;
        setStatus(next);
      } catch {
        // Swallow — idbQueue errors are surfaced by other paths. The hook
        // intentionally keeps the last-known status rather than thrashing
        // to 'unknown' on a transient IDB blip.
      }
    };

    void tick(); // immediate read so the UI doesn't wait 500ms for first sample
    const id = setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [clientRequestId]);

  return status;
}
