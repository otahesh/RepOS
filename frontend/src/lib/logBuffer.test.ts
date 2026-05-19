import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { idbQueue, QueueFullError, type PendingSetLog } from './idbQueue';
import { logBuffer, computeBackoffMs } from './logBuffer';

// Helper: directly seed a queue row with overrides (bypasses logBuffer.enqueue
// so we can control attempt_count / next_attempt_at exactly).
async function seedRow(over: Partial<PendingSetLog> = {}): Promise<PendingSetLog> {
  const row: PendingSetLog = {
    client_request_id: cryptoUUID(),
    queue_owner_user_id: 'user-1',
    planned_set_id: 'ps-1',
    performed_at: '2026-05-18T12:00:00-04:00',
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
  await idbQueue.enqueue(row);
  return row;
}

function cryptoUUID(): string {
  return crypto.randomUUID();
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

describe('logBuffer', () => {
  beforeEach(async () => {
    await idbQueue.purgeAll();
    globalThis.fetch = vi.fn();
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  // ─────────────────────────────────────────────────────────────────────
  // enqueue
  // ─────────────────────────────────────────────────────────────────────

  it('enqueue writes a pending row and returns a v4 UUID', async () => {
    setOnline(false); // avoid auto-flush noise
    const spy = vi.spyOn(idbQueue, 'enqueue');
    const id = await logBuffer.enqueue(
      'ps-1',
      {
        weight_lbs: 100,
        reps: 5,
        rir: 2,
        performed_at: '2026-05-18T12:00:00-04:00',
      },
      'user-1',
    );
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const enqueued = spy.mock.calls[0][0] as PendingSetLog;
    expect(enqueued.client_request_id).toBe(id);
    expect(enqueued.planned_set_id).toBe('ps-1');
    expect(enqueued.queue_owner_user_id).toBe('user-1');
    expect(enqueued.status).toBe('pending');
  });

  it('enqueue triggers immediate flush when online', async () => {
    setOnline(true);
    const flushSpy = vi.spyOn(logBuffer, 'flush').mockResolvedValueOnce(undefined);
    await logBuffer.enqueue(
      'ps-1',
      { weight_lbs: 100, reps: 5, rir: 2, performed_at: '2026-05-18T12:00:00-04:00' },
      'user-1',
    );
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('enqueue does NOT trigger flush when offline', async () => {
    setOnline(false);
    const flushSpy = vi.spyOn(logBuffer, 'flush').mockResolvedValueOnce(undefined);
    await logBuffer.enqueue(
      'ps-1',
      { weight_lbs: 100, reps: 5, rir: 2, performed_at: '2026-05-18T12:00:00-04:00' },
      'user-1',
    );
    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('enqueue propagates QueueFullError from idbQueue', async () => {
    setOnline(false);
    vi.spyOn(idbQueue, 'enqueue').mockRejectedValueOnce(new QueueFullError());
    await expect(
      logBuffer.enqueue(
        'ps-1',
        { weight_lbs: 100, reps: 5, rir: 2, performed_at: '2026-05-18T12:00:00-04:00' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(QueueFullError);
  });

  // ─────────────────────────────────────────────────────────────────────
  // flush: success path
  // ─────────────────────────────────────────────────────────────────────

  it('flush POSTs each pending row to /api/set-logs in FIFO order', async () => {
    const a = await seedRow({ client_request_id: 'a', planned_set_id: 'ps-a', created_at: 1 });
    const b = await seedRow({ client_request_id: 'b', planned_set_id: 'ps-b', created_at: 2 });
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'srv-a', deduped: false }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'srv-b', deduped: false }) });

    await logBuffer.flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    const firstUrl = (fetch as any).mock.calls[0][0];
    const firstInit = (fetch as any).mock.calls[0][1];
    expect(firstUrl).toBe('/api/set-logs');
    expect(firstInit.method).toBe('POST');
    expect(JSON.parse(firstInit.body).client_request_id).toBe(a.client_request_id);
    expect(JSON.parse((fetch as any).mock.calls[1][1].body).client_request_id).toBe(b.client_request_id);

    expect(await idbQueue.peekPending()).toHaveLength(0);
    // Synced rows are deleted by idbQueue.markSynced — see idbQueue.ts line 122.
    expect(await idbQueue.peekRejected()).toHaveLength(0);
    void a; void b;
  });

  it('flush on 201 calls markSynced', async () => {
    await seedRow({ client_request_id: 'x' });
    const synced = vi.spyOn(idbQueue, 'markSynced');
    (fetch as any).mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 's', deduped: false }) });
    await logBuffer.flush();
    expect(synced).toHaveBeenCalledWith('x');
  });

  it('flush on 200 (deduped) calls markSynced', async () => {
    await seedRow({ client_request_id: 'x' });
    const synced = vi.spyOn(idbQueue, 'markSynced');
    (fetch as any).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 's', deduped: true }) });
    await logBuffer.flush();
    expect(synced).toHaveBeenCalledWith('x');
  });

  // ─────────────────────────────────────────────────────────────────────
  // flush: rejection paths
  // ─────────────────────────────────────────────────────────────────────

  it('flush on 409 audit_window_expired calls markRejected', async () => {
    await seedRow({ client_request_id: 'x' });
    const rejected = vi.spyOn(idbQueue, 'markRejected');
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers(),
      text: async () => JSON.stringify({ error: 'audit_window_expired' }),
    });
    await logBuffer.flush();
    expect(rejected).toHaveBeenCalledWith('x', 'audit_window_expired');
  });

  it('flush on 404 calls markRejected with planned_set_deleted', async () => {
    await seedRow({ client_request_id: 'x' });
    const rejected = vi.spyOn(idbQueue, 'markRejected');
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => '',
    });
    await logBuffer.flush();
    expect(rejected).toHaveBeenCalledWith('x', 'planned_set_deleted');
  });

  // ─────────────────────────────────────────────────────────────────────
  // flush: retry paths
  // ─────────────────────────────────────────────────────────────────────

  it('flush on 503 leaves row pending; bumps attempt_count + sets next_attempt_at', async () => {
    const before = Date.now();
    await seedRow({ client_request_id: 'x', attempt_count: 0, next_attempt_at: 0 });
    const synced = vi.spyOn(idbQueue, 'markSynced');
    const rejected = vi.spyOn(idbQueue, 'markRejected');
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => 'boom',
    });

    await logBuffer.flush();
    const after = Date.now();

    expect(synced).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    const rows = await idbQueue.peekPending();
    expect(rows).toHaveLength(1);
    expect(rows[0].attempt_count).toBe(1);
    // 1s backoff +/- 25% jitter, relative to whenever bumpAttempt called Date.now().
    expect(rows[0].next_attempt_at).toBeGreaterThanOrEqual(before + 750);
    expect(rows[0].next_attempt_at).toBeLessThanOrEqual(after + 1250);
  });

  it('flush on network error (fetch rejects) treated same as 5xx', async () => {
    await seedRow({ client_request_id: 'x', attempt_count: 0 });
    const rejected = vi.spyOn(idbQueue, 'markRejected');
    (fetch as any).mockRejectedValueOnce(new TypeError('NetworkError'));

    await logBuffer.flush();

    expect(rejected).not.toHaveBeenCalled();
    const rows = await idbQueue.peekPending();
    expect(rows).toHaveLength(1);
    expect(rows[0].attempt_count).toBe(1);
  });

  it('flush on 401 + CFAccess does NOT bump attempt_count and emits cf-access-expired', async () => {
    await seedRow({ client_request_id: 'x', attempt_count: 0 });
    const rejected = vi.spyOn(idbQueue, 'markRejected');
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers({ 'WWW-Authenticate': 'CFAccess url=https://example.cloudflareaccess.com/login' }),
      text: async () => '',
    });

    const handler = vi.fn();
    window.addEventListener('cf-access-expired', handler);

    await logBuffer.flush();

    window.removeEventListener('cf-access-expired', handler);

    expect(rejected).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    const rows = await idbQueue.peekPending();
    expect(rows).toHaveLength(1);
    expect(rows[0].attempt_count).toBe(0); // NOT bumped — session is the problem.
  });

  // ─────────────────────────────────────────────────────────────────────
  // flush: gating
  // ─────────────────────────────────────────────────────────────────────

  it('flush is a no-op while offline', async () => {
    await seedRow({ client_request_id: 'x' });
    setOnline(false);
    await logBuffer.flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('flush skips rows whose next_attempt_at > now', async () => {
    await seedRow({
      client_request_id: 'future',
      next_attempt_at: Date.now() + 60_000,
      attempt_count: 1,
    });
    await logBuffer.flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('flush skips rows with attempt_count >= 5 (does NOT auto-reject)', async () => {
    await seedRow({ client_request_id: 'stalled', attempt_count: 5 });
    const rejected = vi.spyOn(idbQueue, 'markRejected');
    await logBuffer.flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    // Row preserved so W1.3.5 banner can surface it.
    expect(await idbQueue.peekPending()).toHaveLength(1);
  });

  it('flush is reentrancy-guarded — concurrent calls collapse to one tick', async () => {
    await seedRow({ client_request_id: 'x' });
    // Defer the fetch response so the first flush() is still in-flight when the
    // second is invoked.
    let resolve!: (r: unknown) => void;
    (fetch as any).mockReturnValueOnce(new Promise(r => { resolve = r as (r: unknown) => void; }));

    const p1 = logBuffer.flush();
    const p2 = logBuffer.flush(); // should immediately return without queuing another fetch
    resolve({ ok: true, status: 201, json: async () => ({ id: 's', deduped: false }) });
    await Promise.all([p1, p2]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // onReconnect
  // ─────────────────────────────────────────────────────────────────────

  it('onReconnect wires window online event to flush; unsubscribe removes it', async () => {
    const flushSpy = vi.spyOn(logBuffer, 'flush').mockResolvedValue(undefined);
    const off = logBuffer.onReconnect();
    window.dispatchEvent(new Event('online'));
    expect(flushSpy).toHaveBeenCalledTimes(1);

    off();
    window.dispatchEvent(new Event('online'));
    expect(flushSpy).toHaveBeenCalledTimes(1); // still 1 — listener removed.
  });

  // ─────────────────────────────────────────────────────────────────────
  // backoff math
  // ─────────────────────────────────────────────────────────────────────

  it('computeBackoffMs: attempt 0 → 1000ms ± 25%', () => {
    for (let i = 0; i < 30; i++) {
      const ms = computeBackoffMs(0);
      expect(ms).toBeGreaterThanOrEqual(750);
      expect(ms).toBeLessThanOrEqual(1250);
    }
  });

  it('computeBackoffMs: attempt 2 → 4000ms ± 25%', () => {
    for (let i = 0; i < 30; i++) {
      const ms = computeBackoffMs(2);
      expect(ms).toBeGreaterThanOrEqual(3000);
      expect(ms).toBeLessThanOrEqual(5000);
    }
  });

  it('computeBackoffMs: attempt 10 is capped at 30000ms ± 25%', () => {
    for (let i = 0; i < 30; i++) {
      const ms = computeBackoffMs(10);
      // 2^10 = 1024 → clamped to 30 → 30000 ± 25% = [22500, 37500].
      expect(ms).toBeGreaterThanOrEqual(22_500);
      expect(ms).toBeLessThanOrEqual(37_500);
    }
  });
});
