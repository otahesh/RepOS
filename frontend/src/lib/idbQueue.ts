import Dexie, { type Table } from 'dexie';

export interface PendingSetLog {
  client_request_id: string;     // uuid; primary key
  queue_owner_user_id: string;   // who enqueued; checked at boot for auth-state-change purge
  planned_set_id: string;        // uuid
  performed_at: string;          // ISO with offset
  weight_lbs: number | null;
  reps: number | null;
  rir: number | null;
  rpe: number | null;
  notes: string | null;
  status: 'pending' | 'syncing' | 'synced' | 'rejected';
  rejection_reason?: 'audit_window_expired' | 'planned_set_deleted' | 'other';
  attempt_count: number;
  next_attempt_at: number;
  created_at: number;
  updated_at: number;
}

export class QueueFullError extends Error {
  constructor(message = 'IndexedDB quota exceeded') {
    super(message);
    this.name = 'QueueFullError';
  }
}

class RepOSLogQueueDB extends Dexie {
  pendingSetLogs!: Table<PendingSetLog, string>;

  constructor() {
    super('RepOSLogQueue');
    this.version(1).stores({
      pendingSetLogs: 'client_request_id, status, created_at',
    });
  }
}

function isQuotaExceeded(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return true;
  // Dexie may wrap the underlying error — check name/inner.
  const e = err as { name?: string; inner?: { name?: string } } | null;
  if (e && typeof e === 'object') {
    if (e.name === 'QuotaExceededError') return true;
    if (e.inner && e.inner.name === 'QuotaExceededError') return true;
  }
  return false;
}

class IdbQueue {
  // Public for test spying (vi.spyOn(idbQueue.db.pendingSetLogs, 'put')).
  db: RepOSLogQueueDB = new RepOSLogQueueDB();
  private reconciled = false;

  private async ensureOpen(): Promise<void> {
    if (!this.db.isOpen()) {
      // Either first call or after close(): replace with a fresh Dexie instance
      // so the spy target on `this.db.pendingSetLogs` is current.
      this.db = new RepOSLogQueueDB();
      this.reconciled = false;
    }
    if (!this.reconciled) {
      this.reconciled = true; // set before await to avoid re-entry
      await this.reconcileSyncing();
    }
  }

  private async reconcileSyncing(): Promise<void> {
    const stuck = await this.db.pendingSetLogs.where('status').equals('syncing').toArray();
    if (stuck.length === 0) return;
    const now = Date.now();
    await this.db.pendingSetLogs.bulkPut(
      stuck.map(row => ({
        ...row,
        status: 'pending' as const,
        attempt_count: row.attempt_count + 1,
        updated_at: now,
      })),
    );
  }

  async init(): Promise<void> {
    await this.ensureOpen();
  }

  async enqueue(item: PendingSetLog): Promise<void> {
    await this.ensureOpen();
    try {
      await this.db.pendingSetLogs.put(item);
    } catch (err) {
      if (isQuotaExceeded(err)) throw new QueueFullError();
      throw err;
    }
  }

  async peekPending(): Promise<PendingSetLog[]> {
    await this.ensureOpen();
    // Filter on status, sort by created_at FIFO.
    const rows = await this.db.pendingSetLogs.where('status').equals('pending').toArray();
    rows.sort((a, b) => a.created_at - b.created_at);
    return rows;
  }

  async peekRejected(): Promise<PendingSetLog[]> {
    await this.ensureOpen();
    const rows = await this.db.pendingSetLogs.where('status').equals('rejected').toArray();
    rows.sort((a, b) => a.created_at - b.created_at);
    return rows;
  }

  async markSyncing(client_request_id: string): Promise<void> {
    await this.ensureOpen();
    await this.db.pendingSetLogs.update(client_request_id, {
      status: 'syncing',
      updated_at: Date.now(),
    });
  }

  async markSynced(client_request_id: string): Promise<void> {
    await this.ensureOpen();
    // Delete on synced — row has no further purpose and we keep IDB small.
    await this.db.pendingSetLogs.delete(client_request_id);
  }

  async markRejected(
    client_request_id: string,
    reason: PendingSetLog['rejection_reason'],
  ): Promise<void> {
    await this.ensureOpen();
    await this.db.pendingSetLogs.update(client_request_id, {
      status: 'rejected',
      rejection_reason: reason,
      updated_at: Date.now(),
    });
  }

  async purgeAll(): Promise<void> {
    await this.ensureOpen();
    await this.db.pendingSetLogs.clear();
  }

  async close(): Promise<void> {
    if (this.db.isOpen()) this.db.close();
    this.reconciled = false;
  }
}

export const idbQueue = new IdbQueue();
