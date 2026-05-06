import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayWorkoutMobile } from './TodayWorkoutMobile';
import * as mesoApi from '../../lib/api/mesocycles';

describe('<TodayWorkoutMobile>', () => {
  beforeEach(() => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue({
      state: 'workout', run_id: 'mr-1',
      day: { id: 'dw-1', kind: 'strength', name: 'Upper Heavy', week_idx: 1, day_idx: 0 } as any,
      sets: [
        { id: 'ps-1', exercise_id: 'e-1', exercise_name: 'Barbell Bench Press', block_idx: 0, set_idx: 0, target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 180 },
        { id: 'ps-2', exercise_id: 'e-1', exercise_name: 'Barbell Bench Press', block_idx: 0, set_idx: 1, target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 180 },
      ],
      cardio: [],
    });
  });
  it('renders day name + sets stacked', async () => {
    render(<TodayWorkoutMobile onStart={vi.fn()} />);
    expect(await screen.findByText(/Upper Heavy/)).toBeInTheDocument();
    expect(screen.getAllByText(/Barbell Bench Press/i).length).toBeGreaterThanOrEqual(1);
  });
  it('shows START WORKOUT CTA', async () => {
    render(<TodayWorkoutMobile onStart={vi.fn()} />);
    expect(await screen.findByText(/start workout/i)).toBeInTheDocument();
  });
});
