import { useEffect, useState } from 'react';
import { idbQueue } from '../lib/idbQueue';

export interface QueueCounts {
  pending: number;
  syncing: number;
  rejected: number;
}

const POLL_MS = 1000;
const ZERO: QueueCounts = { pending: 0, syncing: 0, rejected: 0 };

/**
 * Polls idbQueue every 1000ms and returns the per-status row counts
 * (pending / syncing / rejected). Drives the LogBufferRecovery banner.
 *
 * Reuses the cancellation pattern from useIdbQueueStatus: a `cancelled` flag
 * gates setState so an in-flight Promise resolving after unmount cannot mutate
 * the component. Re-polls immediately on mount and on each interval tick.
 */
export function useIdbQueueCounts(): QueueCounts {
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
        setCounts({
          pending: pending.length,
          syncing: syncing.length,
          rejected: rejected.length,
        });
      } catch {
        // Swallow — transient IDB errors keep the last-known counts rather
        // than thrashing the banner to zero.
      }
    };

    void tick();
    const id = setInterval(() => { void tick(); }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return counts;
}
