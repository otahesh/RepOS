import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listRecoveryFlags, dismissRecoveryFlag } from './recoveryFlags';
describe('recoveryFlags API client', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  it('lists active', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ([{ flag: 'bodyweight_crash', message: 'Weight dropping fast' }]) });
    const r = await listRecoveryFlags();
    expect(r[0].flag).toBe('bodyweight_crash');
  });
  it('dismisses', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const r = await dismissRecoveryFlag('bodyweight_crash');
    expect(r.ok).toBe(true);
  });
});
