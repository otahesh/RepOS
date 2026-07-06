import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getExerciseHistory } from './exerciseHistory';

describe('getExerciseHistory', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('fetches and unwraps sessions', async () => {
    const sessions = [{ date: '2026-07-01', sets: [{ weight_lbs: 25, reps: 9, rir: 2 }] }];
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessions }),
    });
    await expect(getExerciseHistory('incline-dumbbell-bench-press', 8)).resolves.toEqual(
      sessions,
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/exercises/incline-dumbbell-bench-press/history?limit=8'),
      expect.anything(),
    );
  });

  it('defaults limit to 8', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
    await getExerciseHistory('barbell-back-squat');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/exercises/barbell-back-squat/history?limit=8'),
      expect.anything(),
    );
  });

  it('propagates ApiError on non-ok response', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' });
    await expect(getExerciseHistory('unknown-exercise')).rejects.toThrow(/404/);
  });
});
