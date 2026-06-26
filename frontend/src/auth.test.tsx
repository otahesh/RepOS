import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { AuthProvider, useCurrentUser } from './auth';
import { idbQueue, type PendingSetLog } from './lib/idbQueue';

function mkPendingRow(over: Partial<PendingSetLog> = {}): PendingSetLog {
  return {
    client_request_id: crypto.randomUUID(),
    queue_owner_user_id: 'user-A',
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

async function resetIdb() {
  // Drop the underlying Dexie DB completely so each test starts with an empty
  // pendingSetLogs table AND no queue-owner metadata.
  await idbQueue.close();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('RepOSLogQueue');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function Probe() {
  const { status, user, error } = useCurrentUser();
  return (
    <>
      <span data-testid="status">{status}</span>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
      <span data-testid="error">{error ?? 'none'}</span>
    </>
  );
}

describe('AuthProvider', () => {
  beforeEach(async () => {
    globalThis.fetch = vi.fn();
    await resetIdb();
  });

  it('lands on "authenticated" when /api/me returns 200', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u1',
          email: 'a@b.c',
          display_name: 'A',
          timezone: 'UTC',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('user-id').textContent).toBe('u1');
  });

  it('lands on "error" when /api/me returns 503 (post-flag-flip a 503 is broken, not transitional)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'cf_access_disabled' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('user-id').textContent).toBe('none');
  });

  it('lands on "error" on 500', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
  });

  // ── W1.3.7.2.5 — Auth-state-change purge ──────────────────────────────────

  it('purges the IDB queue when /api/me returns a different user than the queue owner', async () => {
    await idbQueue.setQueueOwnerUserId('user-A');
    await idbQueue.enqueue(mkPendingRow({ queue_owner_user_id: 'user-A' }));
    await idbQueue.enqueue(mkPendingRow({ queue_owner_user_id: 'user-A' }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'user-B', email: 'b@b.c', display_name: 'B', timezone: 'UTC' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    expect(await idbQueue.peekPending()).toHaveLength(0);
    expect(await idbQueue.getQueueOwnerUserId()).toBe('user-B');
  });

  it('preserves the queue when /api/me returns the same user as the queue owner', async () => {
    await idbQueue.setQueueOwnerUserId('user-A');
    await idbQueue.enqueue(mkPendingRow({ queue_owner_user_id: 'user-A' }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'user-A', email: 'a@b.c', display_name: 'A', timezone: 'UTC' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    expect(await idbQueue.peekPending()).toHaveLength(1);
    expect(await idbQueue.getQueueOwnerUserId()).toBe('user-A');
  });

  it('claims ownership without purging when no prior owner is recorded (upgrade-path safety)', async () => {
    // Simulate the pre-W1.3.7.2.5 upgrade case: rows exist in the queue but no
    // metadata owner was ever stored. We must NOT purge those — they belong
    // to whoever just authenticated.
    await idbQueue.enqueue(mkPendingRow({ queue_owner_user_id: 'user-A' }));
    expect(await idbQueue.getQueueOwnerUserId()).toBeNull();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'user-A', email: 'a@b.c', display_name: 'A', timezone: 'UTC' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    expect(await idbQueue.peekPending()).toHaveLength(1);
    expect(await idbQueue.getQueueOwnerUserId()).toBe('user-A');
  });
});
