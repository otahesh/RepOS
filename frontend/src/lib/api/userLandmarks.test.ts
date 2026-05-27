import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLandmarks, patchLandmarks } from './userLandmarks';

beforeEach(() => { vi.restoreAllMocks(); });

describe('userLandmarks api client', () => {
  it('GET parses landmarks, par_q_advisory_active, injury_constraints from body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      landmarks: { chest: { mev: 10, mav: 14, mrv: 22 } },
      par_q_advisory_active: true,
      injury_constraints: { quads: { joint: 'knee_left', level: 'high' } },
    }), { status: 200 }));
    const r = await getLandmarks();
    expect(r.landmarks.chest.mev).toBe(10);
    expect(r.par_q_advisory_active).toBe(true);
    expect(r.injury_constraints.quads.joint).toBe('knee_left');
  });
  it('PATCH attaches fieldErrors to the thrown error [C-LANDMARKS-CLINICAL-FLOORS]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ fieldErrors: { chest: 'MEV below clinical floor 5' } }), { status: 400 }));
    try {
      await patchLandmarks({ chest: { mev: 1, mav: 4, mrv: 8 } });
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as Error & { fieldErrors?: Record<string, string> };
      expect(err.fieldErrors?.chest).toMatch(/MEV below clinical floor/);
    }
  });
});
