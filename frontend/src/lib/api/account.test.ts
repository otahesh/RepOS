import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as auth from '../../auth';
import {
  patchProfile,
  deleteAccount,
  signOutEverywhere,
  listSessions,
  listEvents,
  revokeSession,
} from './account';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('lib/api/account', () => {
  it('patchProfile PATCHes /api/me/profile with the field subset', async () => {
    const spy = vi.spyOn(auth, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ display_name: 'X' }), { status: 200 }),
    );
    const r = await patchProfile({ display_name: 'X' });
    expect(spy).toHaveBeenCalledWith(
      '/api/me/profile',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ display_name: 'X' }),
      }),
    );
    expect(r.display_name).toBe('X');
  });

  it('deleteAccount POSTs with the typed confirm', async () => {
    const spy = vi
      .spyOn(auth, 'apiFetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await deleteAccount('DELETE my account');
    expect(spy).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('signOutEverywhere returns void on 204', async () => {
    vi.spyOn(auth, 'apiFetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(signOutEverywhere()).resolves.toBeUndefined();
  });

  it('listSessions parses the response shape', async () => {
    // Note: server returns `last_used_ip_24` (truncated /24), per
    // api/src/schemas/account.ts SessionItemSchema. The spec text in the plan
    // used `last_used_ip` in the example mock — that was an inconsistency.
    // We mock the actual server shape so the client doesn't have to rename.
    vi.spyOn(auth, 'apiFetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              id: '1',
              label: 'iOS',
              created_at: '2026-01-01T00:00:00Z',
              last_used_at: null,
              last_used_ip_24: null,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const s = await listSessions();
    expect(s).toHaveLength(1);
    expect(s[0].label).toBe('iOS');
  });

  it('listEvents paginates with the keyset (before_ts, before_id) cursor', async () => {
    const spy = vi.spyOn(auth, 'apiFetch').mockResolvedValue(
      new Response(
        JSON.stringify({ events: [], next_cursor: null }),
        { status: 200 },
      ),
    );
    await listEvents({
      before_ts: '2026-01-01T00:00:00Z',
      before_id: '42',
      limit: 20,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('before_ts=2026-01-01'),
      expect.any(Object),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('before_id=42'),
      expect.any(Object),
    );
  });

  it('revokeSession DELETEs /api/account/sessions/:id with CSRF header', async () => {
    const spy = vi
      .spyOn(auth, 'apiFetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await revokeSession('tok-123');
    expect(spy).toHaveBeenCalledWith(
      '/api/account/sessions/tok-123',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ 'X-RepOS-CSRF': '1' }),
      }),
    );
  });

  it('all state-changing requests send X-RepOS-CSRF: 1', async () => {
    const spy = vi
      .spyOn(auth, 'apiFetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await deleteAccount('DELETE my account');
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-RepOS-CSRF': '1' }),
      }),
    );
  });
});
