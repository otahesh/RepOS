import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIdbQueueStatus } from './useIdbQueueStatus';
import { idbQueue, type PendingSetLog } from '../lib/idbQueue';

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

describe('useIdbQueueStatus', () => {
  beforeEach(async () => {
    await idbQueue.purgeAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "unknown" when clientRequestId is null', () => {
    const { result } = renderHook(() => useIdbQueueStatus(null));
    expect(result.current).toBe('unknown');
  });

  it('reads "pending" for an enqueued row on first tick', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'r-1' }));
    const { result } = renderHook(() => useIdbQueueStatus('r-1'));
    await waitFor(() => expect(result.current).toBe('pending'));
  });

  it('transitions to "synced" once markSynced deletes the row', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'r-2' }));

    const { result } = renderHook(() => useIdbQueueStatus('r-2'));
    await waitFor(() => expect(result.current).toBe('pending'));

    await act(async () => {
      await idbQueue.markSynced('r-2');
    });

    // Real timers + the hook's 500ms interval; default 1000ms waitFor cycle
    // is enough headroom.
    await waitFor(() => expect(result.current).toBe('synced'), { timeout: 2000 });
  });

  it('reflects "rejected" when markRejected runs', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'r-3' }));
    const { result } = renderHook(() => useIdbQueueStatus('r-3'));
    await waitFor(() => expect(result.current).toBe('pending'));

    await act(async () => {
      await idbQueue.markRejected('r-3', 'audit_window_expired');
    });

    await waitFor(() => expect(result.current).toBe('rejected'));
  });

  it('clears the interval on unmount', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'r-4' }));
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useIdbQueueStatus('r-4'));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('switches polling target when clientRequestId changes', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'r-a' }));
    await idbQueue.enqueue(mkItem({ client_request_id: 'r-b' }));
    await idbQueue.markRejected('r-b', 'planned_set_deleted');

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useIdbQueueStatus(id),
      { initialProps: { id: 'r-a' as string | null } },
    );
    await waitFor(() => expect(result.current).toBe('pending'));

    rerender({ id: 'r-b' });
    await waitFor(() => expect(result.current).toBe('rejected'));

    rerender({ id: null });
    await waitFor(() => expect(result.current).toBe('unknown'));
  });
});
