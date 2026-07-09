import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TodayWorkoutMobile } from './TodayWorkoutMobile';
import * as mesoApi from '../../lib/api/mesocycles';
import * as plannedApi from '../../lib/api/plannedSets';
import * as exApi from '../../lib/api/exercises';
import * as dayApi from '../../lib/api/dayWorkouts';
import * as toast from '../common/ToastHost';

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
  state: 'workout' as const,
  run_id: 'mr-1',
  day: { id: 'dw-1', kind: 'strength' as const, name: 'Upper Heavy', week_idx: 1, day_idx: 0 },
  pacing: { status: 'on_pace' as const, suggested_date: '2026-05-05' },
  completed_today: false,
  sets: [
    {
      id: 'ps-1',
      exercise: { id: 'e-1', slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
      block_idx: 0,
      set_idx: 0,
      target_reps_low: 6,
      target_reps_high: 8,
      target_rir: 2,
      rest_sec: 180,
      logged: null,
    },
    {
      id: 'ps-2',
      exercise: { id: 'e-1', slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
      block_idx: 0,
      set_idx: 1,
      target_reps_low: 6,
      target_reps_high: 8,
      target_rir: 2,
      rest_sec: 180,
      logged: null,
    },
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
    vi.restoreAllMocks();
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(BASE_WORKOUT);
  });

  it('no active run: links to the programs catalog (mobile is first-class)', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue({ state: 'no_active_run' } as never);
    renderTWM();
    await screen.findByText(/No active/);
    expect(screen.getByRole('link', { name: /browse programs/i })).toHaveAttribute(
      'href',
      '/programs',
    );
    expect(screen.queryByText(/on desktop/i)).not.toBeInTheDocument();
  });

  it('mesocycle_complete: program-complete copy links to /history', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue({
      state: 'mesocycle_complete',
      run_id: 'mr-1',
    });
    renderTWM();
    expect(await screen.findByText(/program complete/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /history/i })).toHaveAttribute('href', '/history');
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

  it('renders the ON PACE pacing chip', async () => {
    renderTWM();
    await screen.findByText(/Upper Heavy/);
    expect(within(screen.getByTestId('pacing-chip')).getByText(/on pace/i)).toBeInTheDocument();
  });

  it('renders no pacing chip when pacing is absent (defensive)', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue({
      state: 'workout',
      run_id: 'mr-1',
      day: BASE_WORKOUT.day,
      completed_today: false,
      sets: [],
      cardio: [],
    } as unknown as mesoApi.TodayWorkoutResponse);
    renderTWM();
    await screen.findByText(/Upper Heavy/);
    expect(screen.queryByTestId('pacing-chip')).not.toBeInTheDocument();
  });

  it('completed_today: shows START ANYWAY that navigates to the logger', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue({
      ...BASE_WORKOUT,
      completed_today: true,
    });
    const user = userEvent.setup();
    renderTWM();
    expect(await screen.findByText(/done for today/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start anyway/i }));
    expect(navigateMock).toHaveBeenCalledWith('/today/mr-1/log');
  });

  it('SKIP confirms then calls skipDayWorkout and refetches', async () => {
    const getSpy = vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(BASE_WORKOUT);
    const skipSpy = vi.spyOn(dayApi, 'skipDayWorkout').mockResolvedValue({
      id: 'dw-1',
      status: 'skipped',
      completed_at: null,
      run_completed: false,
    });
    const user = userEvent.setup();
    renderTWM();
    await screen.findByText(/Upper Heavy/);
    await user.click(screen.getByRole('button', { name: /^skip$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/won't count toward your program/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /skip/i }));
    expect(skipSpy).toHaveBeenCalledWith('dw-1');
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });

  it('SKIP failure surfaces an error toast (not silently swallowed)', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue(BASE_WORKOUT);
    vi.spyOn(dayApi, 'skipDayWorkout').mockRejectedValue(new Error('run not active'));
    const toastSpy = vi.spyOn(toast, 'pushToast').mockReturnValue('t-1');
    const user = userEvent.setup();
    renderTWM();
    await screen.findByText(/Upper Heavy/);
    await user.click(screen.getByRole('button', { name: /^skip$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /skip/i }));
    await vi.waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          body: expect.stringMatching(/run not active/i),
        }),
      ),
    );
  });

  it('behind: LOG PAST WORKOUT reveals a date picker that navigates to the backfill logger', async () => {
    vi.spyOn(mesoApi, 'getTodayWorkout').mockResolvedValue({
      ...BASE_WORKOUT,
      pacing: { status: 'behind', days_behind: 2, suggested_date: '2026-05-03' },
    });
    const user = userEvent.setup();
    renderTWM();
    await screen.findByText(/Upper Heavy/);
    await user.click(screen.getByRole('button', { name: /log past workout/i }));
    const dateInput = screen.getByLabelText(/date/i) as HTMLInputElement;
    expect(dateInput.value).toBe('2026-05-03');
    await user.click(screen.getByRole('button', { name: /^log$/i }));
    expect(navigateMock).toHaveBeenCalledWith('/today/mr-1/log?for=2026-05-03');
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

  it('opens MidSessionSwapPicker pre-loaded with injury context when "Got a tweak?" is tapped', async () => {
    vi.spyOn(exApi, 'getSubstitutions').mockResolvedValue({
      from: { slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
      subs: [
        {
          id: 'sub-1',
          slug: 'incline-db-bench',
          name: 'Incline DB Bench',
          score: 500,
          reason: 'Same pattern',
        },
      ],
      truncated: false,
    });
    renderTWM();
    await screen.findByText(/Upper Heavy/);
    const moreBtns = screen.getAllByRole('button', { name: /more options/i });
    fireEvent.click(moreBtns[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: /got a tweak/i }));
    expect(await screen.findByRole('dialog', { name: /swap/i })).toBeInTheDocument();
  });
});
