import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError, getWorkoutHistory } from './workoutHistory';

describe('getWorkoutHistory API client', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('GETs /api/workouts/history with no query string when called with no args', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], next_cursor: null }),
    });
    await getWorkoutHistory();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/workouts\/history$/),
      expect.anything(),
    );
  });

  it('passes limit as a query param', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], next_cursor: null }),
    });
    await getWorkoutHistory(undefined, 10);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('limit=10'), expect.anything());
  });

  it('URL-encodes the cursor', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], next_cursor: null }),
    });
    const cursor = '2026-07-01T12:00:00.000000Z|abc-123';
    await getWorkoutHistory(cursor, 20);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(cursor)),
      expect.anything(),
    );
    // The raw '|' must never appear un-encoded in the URL.
    const [calledUrl] = (fetch as any).mock.calls[0];
    expect(calledUrl).not.toContain('|');
  });

  it('parses items + next_cursor from the response body', async () => {
    const page = {
      items: [
        {
          id: 'dw-1',
          name: 'Upper Heavy',
          kind: 'strength',
          week_idx: 1,
          day_idx: 0,
          status: 'completed',
          completed_at: '2026-07-01T12:00:00Z',
          scheduled_date: '2026-07-01',
          exercises: [
            {
              slug: 'barbell-back-squat',
              name: 'Barbell Back Squat',
              sets: [{ weight_lbs: 135, reps: 8, rir: 2, performed_at: '2026-07-01T12:05:00Z' }],
            },
          ],
        },
      ],
      next_cursor: 'abc',
    };
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => page });
    const r = await getWorkoutHistory();
    expect(r).toEqual(page);
  });

  it('propagates ApiError on non-ok response', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid cursor',
    });
    const err = await getWorkoutHistory('bad-cursor').then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });
});
