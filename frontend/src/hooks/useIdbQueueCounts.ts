import { useEffect, useState } from 'react';
import { idbQueue } from '../lib/idbQueue';
import { MAX_ATTEMPTS } from '../lib/logBuffer';

export interface QueueCounts {
  pending: number;
  syncing: number;
  rejected: number;
  /** Pending rows at the attempt cap (subset of `pending`) — the flusher skips them, so they need the user's "Retry sync" to move again. */
  stalled: number;
  /** Epoch ms of the oldest pending row, or null if no pending rows. Drives the W1.3.6 O7 staleness banner. */
  oldestPendingCreatedAt: number | null;
}

const POLL_MS = 1000;
const ZERO: QueueCounts = {
  pending: 0,
  syncing: 0,
  rejected: 0,
  stalled: 0,
  oldestPendingCreatedAt: null,
};

/**
 * Polls idbQueue every 1000ms and returns the per-status row counts
 * (pending / syncing / rejected / stalled). Drives the SyncStatusPill.
 *
 * Reuses the cancellation pattern from useIdbQueueStatus: a `cancelled` flag
 * gates setState so an in-flight Promise resolving after unmount cannot mutate
 * the component. Re-polls immediately on mount and on each interval tick.
 *
 * `pollMs` is injectable for tests only (a fast cadence beats fake timers
 * here — the tick's IndexedDB work is genuinely async); production callers
 * pass nothing.
 */
export function useIdbQueueCounts(pollMs: number = POLL_MS): QueueCounts {
  const [counts, setCounts] = useState<QueueCounts>(ZERO);

  useEffect(() => {
    let cancelled = false;

    const tick = async (): Promise<void> => {
      try {
        const [pending, syncing, rejected] = await Promise.all([
          idbQueue.peekPending(),
          idbQueue.peekSyncing(),
          idbQueue.peekRejected(),
        ]);
        if (cancelled) return;
        const oldest =
          pending.length > 0
            ? pending.reduce(
                (min, r) => (r.created_at < min ? r.created_at : min),
                pending[0].created_at,
              )
            : null;
        setCounts({
          pending: pending.length,
          syncing: syncing.length,
          rejected: rejected.length,
          stalled: pending.filter((r) => r.attempt_count >= MAX_ATTEMPTS).length,
          oldestPendingCreatedAt: oldest,
        });
      } catch {
        // Swallow — transient IDB errors keep the last-known counts rather
        // than thrashing the banner to zero.
      }
    };

    void tick();
    const id = setInterval(() => {
      void tick();
    }, pollMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  return counts;
}
