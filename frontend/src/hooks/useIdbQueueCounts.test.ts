import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIdbQueueCounts } from './useIdbQueueCounts';
import { idbQueue, type PendingSetLog } from '../lib/idbQueue';
import { MAX_ATTEMPTS } from '../lib/logBuffer';

function mkItem(over: Partial<PendingSetLog> = {}): PendingSetLog {
  return {
    client_request_id: 'x',
    queue_owner_user_id: 'user-1',
    planned_set_id: 'p',
    performed_at: new Date().toISOString(),
    weight_lbs: 100,
    reps: 5,
    rir: 2,
    rpe: null,
    notes: null,
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...over,
  };
}

describe('useIdbQueueCounts', () => {
  beforeEach(async () => {
    await idbQueue.purgeAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero counts when queue is empty', async () => {
    const { result } = renderHook(() => useIdbQueueCounts(50));
    // Initial state is zero; first tick reads an empty queue and stays zero.
    await waitFor(() => {
      expect(result.current).toEqual({
        pending: 0,
        syncing: 0,
        rejected: 0,
        stalled: 0,
        oldestPendingCreatedAt: null,
      });
    });
  });

  it('returns pending=N after enqueuing N rows; tracks oldest created_at', async () => {
    const oldest = Date.now() - 5000;
    await idbQueue.enqueue(mkItem({ client_request_id: 'p-1', created_at: oldest }));
    await idbQueue.enqueue(mkItem({ client_request_id: 'p-2', created_at: oldest + 100 }));
    await idbQueue.enqueue(mkItem({ client_request_id: 'p-3', created_at: oldest + 200 }));

    const { result } = renderHook(() => useIdbQueueCounts(50));
    await waitFor(() => expect(result.current.pending).toBe(3));
    expect(result.current.syncing).toBe(0);
    expect(result.current.rejected).toBe(0);
    expect(result.current.oldestPendingCreatedAt).toBe(oldest);
  });

  it('returns syncing=1 after markSyncing on a row', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 's-1' }));
    await idbQueue.markSyncing('s-1');

    const { result } = renderHook(() => useIdbQueueCounts(50));
    await waitFor(() => expect(result.current.syncing).toBe(1));
    expect(result.current.pending).toBe(0);
    expect(result.current.rejected).toBe(0);
  });

  it('returns rejected=1 after markRejected', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'r-1' }));
    await idbQueue.markRejected('r-1', 'audit_window_expired');

    const { result } = renderHook(() => useIdbQueueCounts(50));
    await waitFor(() => expect(result.current.rejected).toBe(1));
    expect(result.current.pending).toBe(0);
    expect(result.current.syncing).toBe(0);
  });

  it('counts update reactively as queue state changes', async () => {
    const { result } = renderHook(() => useIdbQueueCounts(50));
    await waitFor(() => expect(result.current.pending).toBe(0));

    await act(async () => {
      await idbQueue.enqueue(mkItem({ client_request_id: 'live-1' }));
      await idbQueue.enqueue(mkItem({ client_request_id: 'live-2' }));
    });

    // Test poll cadence is 50ms; default headroom is plenty for one tick.
    await waitFor(() => expect(result.current.pending).toBe(2));

    await act(async () => {
      await idbQueue.markRejected('live-1', 'planned_set_deleted');
    });

    await waitFor(() => {
      expect(result.current.pending).toBe(1);
      expect(result.current.rejected).toBe(1);
    });
  });

  it('counts pending rows at the attempt cap as stalled (subset of pending)', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'stuck-1', attempt_count: MAX_ATTEMPTS }));
    await idbQueue.enqueue(
      mkItem({ client_request_id: 'stuck-2', attempt_count: MAX_ATTEMPTS + 3 }),
    );
    await idbQueue.enqueue(mkItem({ client_request_id: 'healthy', attempt_count: 2 }));

    const { result } = renderHook(() => useIdbQueueCounts(50));
    await waitFor(() => expect(result.current.pending).toBe(3));
    expect(result.current.stalled).toBe(2);
  });

  it('stalled is 0 when no pending row has hit the cap', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'p-1', attempt_count: MAX_ATTEMPTS - 1 }));

    const { result } = renderHook(() => useIdbQueueCounts(50));
    await waitFor(() => expect(result.current.pending).toBe(1));
    expect(result.current.stalled).toBe(0);
  });

  it('clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useIdbQueueCounts(50));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
