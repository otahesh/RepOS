import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchPlannedSet, substitutePlannedSet } from './plannedSets';
describe('plannedSets API client', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  it('PATCH applies override', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'ps-1', overridden_at: '2026-05-05' }) });
    const r = await patchPlannedSet('ps-1', { target_rir: 1, override_reason: 'feeling beat' });
    expect(r.overridden_at).toBeTruthy();
  });
  it('PATCH past day → 409', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 409, text: async () => 'past' });
    await expect(patchPlannedSet('ps-1', { target_rir: 1 })).rejects.toThrow(/409/);
  });
  it('substitute persists exercise change', async () => {
    // API accepts to_exercise_id (UUID), not to_exercise_slug
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'ps-1', exercise_id: 'e-2', substituted_from_exercise_id: 'e-1', overridden_at: '2026-05-05T00:00:00Z' }) });
    const r = await substitutePlannedSet('ps-1', { to_exercise_id: '00000000-0000-0000-0000-000000000002' });
    expect(r.substituted_from_exercise_id).toBe('e-1');
  });
});
