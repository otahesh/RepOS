import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayWorkoutMobile } from './TodayWorkoutMobile';
import * as mesoApi from '../../lib/api/mesocycles';
import * as plannedApi from '../../lib/api/plannedSets';

const BASE_WORKOUT = {
  state: 'workout' as const, run_id: 'mr-1',
  day: { id: 'dw-1', kind: 'strength' as const, name: 'Upper Heavy', week_idx: 1, day_idx: 0 },
  sets: [
    { id: 'ps-1', exercise: { id: 'e-1', slug: 'barbell-bench-press', name: 'Barbell Bench Press' }, block_idx: 0, set_idx: 0, target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 180 },
    { id: 'ps-2', exercise: { id: 'e-1', slug: 'barbell-bench-press', name: 'Barbell Bench Press' }, block_idx: 0, set_idx: 1, target_reps_low: 6, target_reps_high: 8, target_rir: 2, rest_sec: 180 },
  ],
  cardio: [],
};

const WORKOUT_WITH_SUB = {
  ...BASE_WORKOUT,
  sets: [
    {
      ...BASE_WORKOUT.sets[0],
      suggested_substitution: {
        id: '00000000-0000-0000-0000-000000000002',
        slug: 'incline-db-bench',
        name: 'Incline DB Bench',
        reason: 'Same pattern · same primary',
      },
    },
    BASE_WORKOUT.sets[1],
  ],
};

describe('<TodayWorkoutMobile>', () => {
  beforeEach(() => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(BASE_WORKOUT);
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

  it('renders suggested-sub Swap button when substitution present', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(WORKOUT_WITH_SUB);
    render(<TodayWorkoutMobile onStart={vi.fn()} />);
    expect(await screen.findByText(/Incline DB Bench/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /swap/i })).toBeInTheDocument();
  });

  it('opens MidSessionSwapSheet on Swap click', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(WORKOUT_WITH_SUB);
    const user = userEvent.setup();
    render(<TodayWorkoutMobile onStart={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /swap/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Swap exercise\?/i)).toBeInTheDocument();
  });

  it('calls substitutePlannedSet with UUID (not slug) and refetches on confirm', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(WORKOUT_WITH_SUB);
    vi.spyOn(plannedApi, 'substitutePlannedSet').mockResolvedValue({
      id: 'ps-1',
      exercise_id: '00000000-0000-0000-0000-000000000002',
      substituted_from_exercise_id: 'e-1',
      overridden_at: '2026-05-07T00:00:00Z',
    });
    const user = userEvent.setup();
    render(<TodayWorkoutMobile onStart={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /swap/i }));
    await user.click(screen.getByText(/confirm swap/i));
    expect(plannedApi.substitutePlannedSet).toHaveBeenCalledWith('ps-1', {
      to_exercise_id: '00000000-0000-0000-0000-000000000002',
    });
    // After confirm the sheet closes and getTodayWorkout is called again (refetch)
    await vi.waitFor(() => {
      expect(mesoApi.getTodayWorkout).toHaveBeenCalledTimes(2);
    });
    // Sheet should be gone
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
