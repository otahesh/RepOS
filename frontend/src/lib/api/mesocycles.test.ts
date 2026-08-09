import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTodayWorkout, getVolumeRollup } from './mesocycles';

describe('mesocycles API client', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  it('today returns no_active_run', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: 'no_active_run' }),
    });
    const r = await getTodayWorkout();
    expect(r.state).toBe('no_active_run');
  });
  it('today returns mesocycle_complete', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: 'mesocycle_complete', run_id: 'mr-1' }),
    });
    const r = await getTodayWorkout();
    expect(r.state).toBe('mesocycle_complete');
    if (r.state === 'mesocycle_complete') expect(r.run_id).toBe('mr-1');
  });
  it('today returns workout with pacing + completed_today + sets + cardio', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        state: 'workout',
        run_id: 'mr-1',
        day: { id: 'dw-1', kind: 'strength', name: 'Upper Heavy' },
        pacing: { status: 'behind', days_behind: 2, suggested_date: '2026-05-03' },
        completed_today: false,
        sets: [
          {
            id: 's-1',
            exercise_id: 'e-1',
            target_reps_low: 6,
            target_reps_high: 8,
            target_rir: 2,
            rest_sec: 180,
          },
        ],
        cardio: [],
      }),
    });
    const r = await getTodayWorkout();
    expect(r.state).toBe('workout');
    if (r.state === 'workout') {
      expect(r.sets.length).toBe(1);
      expect(r.pacing.status).toBe('behind');
      expect(r.pacing.days_behind).toBe(2);
      expect(r.completed_today).toBe(false);
    }
  });
  it('volume-rollup returns weeks[].muscles[] per the API contract', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        run_id: 'mr-1',
        weeks: [
          {
            week_idx: 1,
            muscles: [{ muscle: 'chest', sets: 10, mev: 10, mav: 14, mrv: 22 }],
            minutes_by_modality: { outdoor_walking: 60 },
          },
        ],
      }),
    });
    const r = await getVolumeRollup('mr-1');
    expect(r.weeks[0].muscles[0].muscle).toBe('chest');
    expect(r.weeks[0].muscles[0].sets).toBe(10);
  });
});
