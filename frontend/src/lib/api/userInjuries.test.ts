// frontend/src/lib/api/userInjuries.test.ts
//
// [FIX-20] We mock globalThis.fetch directly (rather than vi.mock('./userInjuries'))
// because this IS the api-client layer — we're testing the fetch boundary itself.
// Component-layer tests in InjuryChipsEditor.test.tsx use the project's standard
// vi.mock('../../lib/api/userInjuries') pattern.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listInjuries, upsertInjury, deleteInjury } from './userInjuries';

afterEach(() => vi.restoreAllMocks());

describe('userInjuries client', () => {
  it('listInjuries() GETs /api/user/injuries and returns array', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          injuries: [
            {
              joint: 'knee_left',
              severity: 'mod',
              notes: '',
              onset_at: null,
              created_at: '',
              updated_at: '',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const out = await listInjuries();
    expect(out.map((i) => i.joint)).toEqual(['knee_left']);
    // Goes through apiFetch: API_BASE-prefixed URL + credentials:'include' (a
    // GET carries no explicit method).
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/injuries'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('upsertInjury POSTs payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          injury: {
            joint: 'wrist',
            severity: 'low',
            notes: '',
            onset_at: null,
            created_at: '',
            updated_at: '',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    const r = await upsertInjury({ joint: 'wrist', severity: 'low' });
    expect(r.joint).toBe('wrist');
  });

  it('deleteInjury DELETEs and returns void', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteInjury('elbow');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/injuries/elbow'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
