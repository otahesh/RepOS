import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TodayCard } from './TodayCard';
import * as api from '../../lib/api/mesocycles';
import * as dayApi from '../../lib/api/dayWorkouts';
import * as toast from '../common/ToastHost';

function renderCard(onStart: (runId: string, dayId: string) => void = vi.fn()) {
  return render(
    <MemoryRouter>
      <TodayCard onStart={onStart} />
    </MemoryRouter>,
  );
}

const DAY = { id: 'dw-1', kind: 'strength' as const, name: 'Upper Heavy', week_idx: 1, day_idx: 0 };

function workout(overrides: Partial<api.TodayWorkoutResponse & Record<string, unknown>> = {}) {
  return {
    state: 'workout' as const,
    run_id: 'mr-1',
    day: DAY,
    pacing: { status: 'on_pace' as const, suggested_date: '2026-05-05' },
    completed_today: false,
    sets: [],
    cardio: [],
    ...overrides,
  } as api.TodayWorkoutResponse;
}

describe('<TodayCard>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows no-active-run state', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue({ state: 'no_active_run' });
    renderCard();
    expect(await screen.findByText(/Pick a program/i)).toBeInTheDocument();
  });

  it('mesocycle_complete: program-complete copy links to /history', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue({
      state: 'mesocycle_complete',
      run_id: 'mr-1',
    });
    renderCard();
    expect(await screen.findByText(/program complete/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /history/i })).toHaveAttribute('href', '/history');
  });

  it('shows workout day with START WORKOUT CTA', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(workout());
    renderCard();
    expect(await screen.findByText(/Upper Heavy/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start workout/i })).toBeInTheDocument();
  });

  it('renders ON PACE pacing chip for on_pace', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(workout());
    renderCard();
    await screen.findByText(/Upper Heavy/);
    expect(within(screen.getByTestId('pacing-chip')).getByText(/on pace/i)).toBeInTheDocument();
  });

  it('renders AHEAD pacing chip for ahead', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(
      workout({ pacing: { status: 'ahead', suggested_date: '2026-05-05' } }),
    );
    renderCard();
    await screen.findByText(/Upper Heavy/);
    expect(within(screen.getByTestId('pacing-chip')).getByText(/^ahead$/i)).toBeInTheDocument();
  });

  it('renders N DAYS BEHIND pacing chip for behind', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(
      workout({ pacing: { status: 'behind', days_behind: 3, suggested_date: '2026-05-02' } }),
    );
    renderCard();
    await screen.findByText(/Upper Heavy/);
    expect(
      within(screen.getByTestId('pacing-chip')).getByText(/3 days behind/i),
    ).toBeInTheDocument();
  });

  it('renders no pacing chip when pacing is absent (defensive)', async () => {
    const noPacing = {
      state: 'workout',
      run_id: 'mr-1',
      day: DAY,
      completed_today: false,
      sets: [],
      cardio: [],
    };
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(
      noPacing as unknown as api.TodayWorkoutResponse,
    );
    renderCard();
    await screen.findByText(/Upper Heavy/);
    expect(screen.queryByTestId('pacing-chip')).not.toBeInTheDocument();
  });

  it('completed_today: shows Done-for-today headline, Next up, and START ANYWAY', async () => {
    const onStart = vi.fn();
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(workout({ completed_today: true }));
    const user = userEvent.setup();
    renderCard(onStart);
    expect(await screen.findByText(/done for today/i)).toBeInTheDocument();
    expect(screen.getByText(/next up/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /start anyway/i });
    await user.click(btn);
    expect(onStart).toHaveBeenCalledWith('mr-1', 'dw-1');
  });

  it('SKIP confirms then calls skipDayWorkout and refetches', async () => {
    const getSpy = vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(workout());
    const skipSpy = vi.spyOn(dayApi, 'skipDayWorkout').mockResolvedValue({
      id: 'dw-1',
      status: 'skipped',
      completed_at: null,
      run_completed: false,
    });
    const user = userEvent.setup();
    renderCard();
    await screen.findByText(/Upper Heavy/);
    await user.click(screen.getByRole('button', { name: /^skip$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/won't count toward your program/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /skip/i }));
    expect(skipSpy).toHaveBeenCalledWith('dw-1');
    await vi.waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });

  it('SKIP failure surfaces an error toast (not silently swallowed)', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(workout());
    vi.spyOn(dayApi, 'skipDayWorkout').mockRejectedValue(new Error('run not active'));
    const toastSpy = vi.spyOn(toast, 'pushToast').mockReturnValue('t-1');
    const user = userEvent.setup();
    renderCard();
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

  it('behind (desktop): LOG PAST WORKOUT points the user to the mobile logger via toast', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(
      workout({ pacing: { status: 'behind', days_behind: 2, suggested_date: '2026-05-03' } }),
    );
    const toastSpy = vi.spyOn(toast, 'pushToast').mockReturnValue('t-1');
    const user = userEvent.setup();
    renderCard();
    await screen.findByText(/Upper Heavy/);
    await user.click(screen.getByRole('button', { name: /log past workout/i }));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'info', body: expect.stringMatching(/mobile/i) }),
    );
    // Desktop has no date picker — the affordance is discoverable, the action is a toast.
    expect(screen.queryByLabelText(/date/i)).not.toBeInTheDocument();
  });

  it('behind is the only state that offers LOG PAST WORKOUT', async () => {
    vi.spyOn(api, 'getTodayWorkout').mockResolvedValue(workout());
    renderCard();
    await screen.findByText(/Upper Heavy/);
    expect(screen.queryByRole('button', { name: /log past workout/i })).not.toBeInTheDocument();
  });
});
