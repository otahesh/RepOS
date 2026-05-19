import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { idbQueue, QueueFullError, type PendingSetLog } from './idbQueue';

describe('idbQueue', () => {
  beforeEach(async () => { await idbQueue.purgeAll(); });

  it('enqueue + peek round-trips a single item', async () => {
    const item = mkItem({ client_request_id: 'aaa' });
    await idbQueue.enqueue(item);
    expect(await idbQueue.peekPending()).toHaveLength(1);
    expect((await idbQueue.peekPending())[0].client_request_id).toBe('aaa');
  });

  it('markSynced removes from pending', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'aaa' }));
    await idbQueue.markSynced('aaa');
    expect(await idbQueue.peekPending()).toHaveLength(0);
  });

  it('markRejected keeps row, status=rejected', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'aaa' }));
    await idbQueue.markRejected('aaa', 'audit_window_expired');
    expect(await idbQueue.peekRejected()).toHaveLength(1);
    expect((await idbQueue.peekRejected())[0].rejection_reason).toBe('audit_window_expired');
  });

  it('peekSyncing returns rows whose status is "syncing", FIFO ordered', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 's-b', created_at: 2 }));
    await idbQueue.enqueue(mkItem({ client_request_id: 's-a', created_at: 1 }));
    // Nothing in 'syncing' yet.
    expect(await idbQueue.peekSyncing()).toHaveLength(0);

    await idbQueue.markSyncing('s-b');
    await idbQueue.markSyncing('s-a');
    const out = await idbQueue.peekSyncing();
    expect(out.map(i => i.client_request_id)).toEqual(['s-a', 's-b']);
    expect(out.every(r => r.status === 'syncing')).toBe(true);
  });

  it('peekPending returns FIFO order', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'b', created_at: 2 }));
    await idbQueue.enqueue(mkItem({ client_request_id: 'a', created_at: 1 }));
    const out = await idbQueue.peekPending();
    expect(out.map(i => i.client_request_id)).toEqual(['a', 'b']);
  });

  it('QuotaExceededError throws QueueFullError to caller', async () => {
    // Force Dexie's put() to throw a QuotaExceededError DOMException once.
    // idbQueue must catch it and rethrow QueueFullError so the O6 banner can surface it.
    const db = (idbQueue as unknown as { db: { pendingSetLogs: { put: (x: unknown) => Promise<unknown> } } }).db;
    const spy = vi.spyOn(db.pendingSetLogs, 'put').mockRejectedValueOnce(
      new DOMException('quota', 'QuotaExceededError')
    );
    await expect(idbQueue.enqueue(mkItem({ client_request_id: 'quota' }))).rejects.toBeInstanceOf(QueueFullError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('survives across DB reopens', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'p' }));
    await idbQueue.close();
    // Same singleton; ensureOpen() must allocate a fresh RepOSLogQueueDB
    // instance and reconcileSyncing() must re-run. The row must still be
    // readable because fake-indexeddb persists the named DB across Dexie
    // instances.
    expect(await idbQueue.peekPending()).toHaveLength(1);
  });

  it('reconciles stuck-in-syncing rows back to pending at init', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'stuck' }));
    await idbQueue.markSyncing('stuck');
    // Row is now status=syncing in the underlying IDB store. Close so the
    // next ensureOpen() reopens with reconciled=false and re-runs
    // reconcileSyncing(), which must flip the stuck row back to pending.
    await idbQueue.close();

    await idbQueue.init();

    const pending = await idbQueue.peekPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].client_request_id).toBe('stuck');
    expect(pending[0].attempt_count).toBeGreaterThanOrEqual(1);
  });

  it('getStatus returns the row status for pending/rejected and "synced" when row is absent', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'gs-pending' }));
    expect(await idbQueue.getStatus('gs-pending')).toBe('pending');

    await idbQueue.markSyncing('gs-pending');
    expect(await idbQueue.getStatus('gs-pending')).toBe('syncing');

    await idbQueue.enqueue(mkItem({ client_request_id: 'gs-rejected' }));
    await idbQueue.markRejected('gs-rejected', 'audit_window_expired');
    expect(await idbQueue.getStatus('gs-rejected')).toBe('rejected');

    // markSynced deletes the row; getStatus collapses "absent" to "synced".
    await idbQueue.enqueue(mkItem({ client_request_id: 'gs-synced' }));
    await idbQueue.markSynced('gs-synced');
    expect(await idbQueue.getStatus('gs-synced')).toBe('synced');

    // Never-enqueued id also reads as 'synced' — see method JSDoc.
    expect(await idbQueue.getStatus('gs-never-was')).toBe('synced');
  });

  it('purgeAll wipes everything (auth-state-change support)', async () => {
    await idbQueue.enqueue(mkItem({ client_request_id: 'a' }));
    await idbQueue.enqueue(mkItem({ client_request_id: 'b' }));
    await idbQueue.purgeAll();
    expect(await idbQueue.peekPending()).toHaveLength(0);
    expect(await idbQueue.peekRejected()).toHaveLength(0);
  });

  it('getQueueOwnerUserId returns null before any owner is set', async () => {
    expect(await idbQueue.getQueueOwnerUserId()).toBeNull();
  });

  it('setQueueOwnerUserId persists and round-trips', async () => {
    await idbQueue.setQueueOwnerUserId('user-A');
    expect(await idbQueue.getQueueOwnerUserId()).toBe('user-A');

    // Overwrites prior owner.
    await idbQueue.setQueueOwnerUserId('user-B');
    expect(await idbQueue.getQueueOwnerUserId()).toBe('user-B');
  });

  it('queue owner survives a DB close/reopen', async () => {
    await idbQueue.setQueueOwnerUserId('user-A');
    await idbQueue.close();
    expect(await idbQueue.getQueueOwnerUserId()).toBe('user-A');
  });

  it('purgeAll does NOT clear the queue owner metadata (lets bootstrap distinguish "first run" from "same user, drained queue")', async () => {
    await idbQueue.setQueueOwnerUserId('user-A');
    await idbQueue.enqueue(mkItem({ client_request_id: 'x' }));
    await idbQueue.purgeAll();
    expect(await idbQueue.peekPending()).toHaveLength(0);
    expect(await idbQueue.getQueueOwnerUserId()).toBe('user-A');
  });
});

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
