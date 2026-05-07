import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listRecoveryFlags, dismissRecoveryFlag } from './recoveryFlags';
describe('recoveryFlags API client', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  it('lists active', async () => {
    // API returns { flags: [...] }, not a bare array
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ flags: [{ flag: 'bodyweight_crash', message: 'Weight dropping fast' }] }) });
    const r = await listRecoveryFlags();
    expect(r.flags[0].flag).toBe('bodyweight_crash');
  });
  it('dismisses with 204', async () => {
    // Dismiss returns 204 no body
    (fetch as any).mockResolvedValueOnce({ ok: true, status: 204 });
    await expect(dismissRecoveryFlag('bodyweight_crash')).resolves.toBeUndefined();
  });
});
