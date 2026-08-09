import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError, completeDayWorkout, skipDayWorkout, reopenDayWorkout } from './dayWorkouts';

describe('dayWorkouts API client', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('completeDayWorkout POSTs /complete with completed_on when opts provided', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'dw-1',
        status: 'completed',
        completed_at: '2026-07-01T12:00:00Z',
        run_completed: false,
      }),
    });
    const r = await completeDayWorkout('dw-1', { completed_on: '2026-07-01' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/day-workouts/dw-1/complete'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ completed_on: '2026-07-01' }),
      }),
    );
    expect(r.status).toBe('completed');
    expect(r.run_completed).toBe(false);
  });

  it('completeDayWorkout sends an empty-object body when called with no opts', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'dw-1',
        status: 'completed',
        completed_at: null,
        run_completed: true,
      }),
    });
    const r = await completeDayWorkout('dw-1');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/day-workouts/dw-1/complete'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
    expect(r.run_completed).toBe(true);
  });

  it('skipDayWorkout POSTs /skip', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'dw-1',
        status: 'skipped',
        completed_at: null,
        run_completed: false,
      }),
    });
    const r = await skipDayWorkout('dw-1');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/day-workouts/dw-1/skip'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(r.status).toBe('skipped');
  });

  it('reopenDayWorkout POSTs /reopen', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'dw-1',
        status: 'planned',
        completed_at: null,
        run_completed: false,
      }),
    });
    const r = await reopenDayWorkout('dw-1');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/day-workouts/dw-1/reopen'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(r.status).toBe('planned');
  });

  it('propagates ApiError on non-ok response', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: async () => 'already completed — reopen first',
    });
    const err = await completeDayWorkout('dw-1').then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });
});
