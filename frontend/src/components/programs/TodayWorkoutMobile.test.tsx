import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TodayWorkoutMobile } from './TodayWorkoutMobile';
import * as mesoApi from '../../lib/api/mesocycles';
import * as plannedApi from '../../lib/api/plannedSets';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderTWM(props: { onStart?: (runId: string, dayId: string) => void } = {}) {
  return render(
    <MemoryRouter>
      <TodayWorkoutMobile onStart={props.onStart ?? vi.fn()} />
    </MemoryRouter>,
  );
}

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
    navigateMock.mockReset();
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(BASE_WORKOUT);
  });

  it('renders day name + sets stacked', async () => {
    renderTWM();
    expect(await screen.findByText(/Upper Heavy/)).toBeInTheDocument();
    expect(screen.getAllByText(/Barbell Bench Press/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows START WORKOUT CTA', async () => {
    renderTWM();
    expect(await screen.findByText(/start workout/i)).toBeInTheDocument();
  });

  it('Start Workout navigates to /today/:runId/log', async () => {
    const user = userEvent.setup();
    renderTWM();
    await user.click(await screen.findByRole('button', { name: /start workout/i }));
    expect(navigateMock).toHaveBeenCalledWith('/today/mr-1/log');
  });

  it('renders suggested-sub Swap button when substitution present', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(WORKOUT_WITH_SUB);
    renderTWM();
    expect(await screen.findByText(/Incline DB Bench/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /swap/i })).toBeInTheDocument();
  });

  it('opens MidSessionSwapSheet on Swap click', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(WORKOUT_WITH_SUB);
    const user = userEvent.setup();
    renderTWM();
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
    renderTWM();
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

  // TODO Task 18: flip to it() when MidSessionSwapPicker lands
  it.skip('opens MidSessionSwapPicker pre-loaded with injury context when "Got a tweak?" is tapped', async () => {
    renderTWM();
    await screen.findByText(/Upper Heavy/);
    const moreBtns = screen.getAllByRole('button', { name: /more options/i });
    fireEvent.click(moreBtns[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: /got a tweak/i }));
    expect(await screen.findByRole('dialog', { name: /swap/i })).toBeInTheDocument();
  });
});
