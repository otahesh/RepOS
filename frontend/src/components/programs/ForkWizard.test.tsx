import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ForkWizard } from './ForkWizard';
import * as upApi from '../../lib/api/userPrograms';
import * as msApi from '../../lib/api/mesocycles';
import * as exApi from '../../lib/api/exercises';
import * as eqApi from '../../lib/api/equipment';
import { ApiError } from '../../lib/api/_http';

// Auto-mock (no factory) — resolved values are set in beforeEach because the
// repo's vitest config has `restoreMocks: true` (see DesktopSwapSheet.test.tsx).
vi.mock('../../lib/api/exercises');
vi.mock('../../lib/api/equipment');

function renderWizard(onStarted = vi.fn()) {
  return render(
    <MemoryRouter>
      <ForkWizard userProgramId="up-1" onStarted={onStarted} />
    </MemoryRouter>,
  );
}

// Program detail fixture, parameterized on the first block's MAV so refresh
// tests can assert the re-fetched structure actually reaches the DOM.
function program(mav = 14) {
  return {
    id: 'up-1',
    user_id: 'u-1',
    template_id: 't-1',
    template_version: 1,
    name: 'Full Body 3-Day Foundation',
    effective_name: 'Full Body 3-Day Foundation',
    customizations: {},
    status: 'draft',
    effective_structure: {
      _v: 1,
      days: [
        {
          idx: 0,
          day_offset: 0,
          kind: 'strength',
          name: 'Full Body A',
          blocks: [
            {
              exercise_slug: 'dumbbell-goblet-squat',
              mev: 8,
              mav,
              target_reps_low: 8,
              target_reps_high: 10,
              target_rir: 2,
              rest_sec: 120,
            },
          ],
        },
        { idx: 1, day_offset: 2, kind: 'strength', name: 'Full Body B', blocks: [] },
        { idx: 2, day_offset: 4, kind: 'strength', name: 'Full Body C', blocks: [] },
      ],
    },
  } as any;
}

const EXERCISES = [
  {
    id: '1',
    slug: 'db-bench-press',
    name: 'DB Bench Press',
    primary_muscle: 'chest',
    primary_muscle_name: 'Chest',
    movement_pattern: 'push_horizontal',
    peak_tension_length: 'mid',
    skill_complexity: 2,
    loading_demand: 3,
    systemic_fatigue: 3,
    required_equipment: { _v: 1, requires: [] },
    muscle_contributions: { chest: 1 },
  },
];

// A minimal "active run exists" today response. ForkWizard.readActiveRun only
// reads run_id, but the mock must satisfy TodayWorkoutResponse — the
// sequence-workouts type change removed the old 'rest' state, so an active run
// is now the 'workout' state.
function activeRun(runId: string): msApi.TodayWorkoutResponse {
  return {
    state: 'workout',
    run_id: runId,
    day: { id: 'dw-1', kind: 'strength', name: 'Day 1', week_idx: 1, day_idx: 0 },
    pacing: { status: 'on_pace', suggested_date: '2026-05-05' },
    completed_today: false,
    sets: [],
    cardio: [],
  };
}

describe('<ForkWizard>', () => {
  beforeEach(() => {
    vi.spyOn(upApi, 'getUserProgram').mockResolvedValue(program());
    vi.spyOn(upApi, 'getUserProgramWarnings').mockResolvedValue([]);
    vi.mocked(exApi.listExercises).mockResolvedValue(EXERCISES as any);
    vi.mocked(eqApi.getEquipmentProfile).mockResolvedValue({ _v: 1 } as any);
    vi.spyOn(upApi, 'patchUserProgram').mockResolvedValue({ id: 'up-1' } as any);
    vi.spyOn(upApi, 'startUserProgram').mockResolvedValue({ mesocycle_run_id: 'mr-1' });
    // Default: no active run anywhere — happy-path wizard.
    vi.spyOn(msApi, 'getTodayWorkout').mockResolvedValue({ state: 'no_active_run' });
    vi.spyOn(msApi, 'abandonMesocycle').mockResolvedValue({
      mesocycle_run_id: 'mr-9',
      status: 'abandoned',
      finished_at: '2026-05-07T15:00:00.000Z',
    });
  });
  it('renders 3 day cards', async () => {
    renderWizard();
    expect(await screen.findByText(/Full Body A/)).toBeInTheDocument();
    expect(screen.getByText(/Full Body B/)).toBeInTheDocument();
    expect(screen.getByText(/Full Body C/)).toBeInTheDocument();
  });
  it('rename triggers PATCH', async () => {
    const user = userEvent.setup();
    renderWizard();
    await screen.findByText(/Full Body A/);
    const input = screen.getByLabelText(/program name/i);
    await user.clear(input);
    await user.type(input, 'My FB Run');
    await user.click(screen.getByText(/save name/i));
    expect(upApi.patchUserProgram).toHaveBeenCalledWith('up-1', {
      op: 'rename',
      name: 'My FB Run',
    });
  });
  it('start materializes and calls onStarted with mesocycle id', async () => {
    const onStarted = vi.fn();
    const user = userEvent.setup();
    renderWizard(onStarted);
    await screen.findByText(/Full Body A/);
    await user.click(screen.getByRole('button', { name: /start mesocycle/i }));
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledWith('mr-1'));
  });

  it('shows conflict banner + disables Start when an active run exists elsewhere', async () => {
    vi.spyOn(msApi, 'getTodayWorkout').mockResolvedValue(activeRun('mr-existing'));
    renderWizard();
    expect(await screen.findByRole('alert')).toHaveTextContent(/already have an active/i);
    const startBtn = screen.getByRole('button', { name: /start mesocycle/i });
    expect(startBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: /abandon current mesocycle/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view today/i })).toBeInTheDocument();
  });

  it('mesocycle_complete is NOT a conflict — Start stays enabled, no banner', async () => {
    // A finished run is not active. Treating it as a conflict would strand a
    // user who just completed a program (Start disabled + Abandon 409 loop).
    vi.spyOn(msApi, 'getTodayWorkout').mockResolvedValue({
      state: 'mesocycle_complete',
      run_id: 'mr-done',
    });
    renderWizard();
    await screen.findByText(/Full Body A/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start mesocycle/i })).not.toBeDisabled();
  });

  it('Abandon clears the conflict and re-enables Start', async () => {
    const today = vi
      .spyOn(msApi, 'getTodayWorkout')
      .mockResolvedValueOnce(activeRun('mr-existing'));
    const user = userEvent.setup();
    renderWizard();
    await screen.findByRole('alert');
    // Second call (after abandon) returns no_active_run
    today.mockResolvedValueOnce({ state: 'no_active_run' });
    await user.click(screen.getByRole('button', { name: /abandon current mesocycle/i }));
    expect(msApi.abandonMesocycle).toHaveBeenCalledWith('mr-existing');
    await vi.waitFor(() => {
      const start = screen.getByRole('button', { name: /start mesocycle/i });
      expect(start).not.toBeDisabled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('handles 409 active_run_exists from Start by re-pulling today and showing the banner', async () => {
    // Pre-check is stale — first call says no run, second call (after 409) returns one.
    const today = vi
      .spyOn(msApi, 'getTodayWorkout')
      .mockResolvedValueOnce({ state: 'no_active_run' });
    vi.spyOn(upApi, 'startUserProgram').mockRejectedValue(
      new ApiError(409, { error: 'active_run_exists' }, '{"error":"active_run_exists"}'),
    );
    const user = userEvent.setup();
    renderWizard();
    await screen.findByText(/Full Body A/);
    today.mockResolvedValueOnce(activeRun('mr-race'));
    await user.click(screen.getByRole('button', { name: /start mesocycle/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already have an active/i);
    // Critical: no raw HTTP blob in the surfaced error
    expect(screen.queryByText(/HTTP 409/)).not.toBeInTheDocument();
  });

  it('handles 409 template_outdated by showing a refork message', async () => {
    vi.spyOn(upApi, 'startUserProgram').mockRejectedValue(
      new ApiError(409, { error: 'template_outdated', latest_version: 4, must_refork: true }, ''),
    );
    const user = userEvent.setup();
    renderWizard();
    await screen.findByText(/Full Body A/);
    await user.click(screen.getByRole('button', { name: /start mesocycle/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/version 4/);
    expect(screen.getByRole('alert')).toHaveTextContent(/re-?fork/i);
  });

  it('+ set patches add_set and re-renders the refreshed set range', async () => {
    vi.spyOn(upApi, 'getUserProgram')
      .mockResolvedValueOnce(program(14))
      .mockResolvedValueOnce(program(15));
    const user = userEvent.setup();
    renderWizard();
    expect(await screen.findByText(/8–14 sets/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /\+ set/i }));
    expect(upApi.patchUserProgram).toHaveBeenCalledWith('up-1', {
      op: 'add_set',
      day_idx: 0,
      block_idx: 0,
    });
    expect(await screen.findByText(/8–15 sets/)).toBeInTheDocument();
  });

  it('− set patches remove_set and re-renders the refreshed set range', async () => {
    vi.spyOn(upApi, 'getUserProgram')
      .mockResolvedValueOnce(program(14))
      .mockResolvedValueOnce(program(13));
    const user = userEvent.setup();
    renderWizard();
    expect(await screen.findByText(/8–14 sets/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /− set/i }));
    expect(upApi.patchUserProgram).toHaveBeenCalledWith('up-1', {
      op: 'remove_set',
      day_idx: 0,
      block_idx: 0,
    });
    expect(await screen.findByText(/8–13 sets/)).toBeInTheDocument();
  });

  it('surfaces an error when the add-set PATCH fails', async () => {
    vi.spyOn(upApi, 'patchUserProgram').mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderWizard();
    await screen.findByText(/8–14 sets/);
    await user.click(screen.getByRole('button', { name: /\+ set/i }));
    expect(await screen.findByText(/add set failed/i)).toBeInTheDocument();
  });

  it('clicking the exercise name opens the swap sheet; applying swaps + refreshes', async () => {
    vi.spyOn(upApi, 'getUserProgram')
      .mockResolvedValueOnce(program(14))
      .mockResolvedValueOnce(program(14));
    const user = userEvent.setup();
    renderWizard();
    await screen.findByText(/8–14 sets/);
    await user.click(screen.getByRole('button', { name: /dumbbell goblet squat/i }));
    const dialog = await screen.findByRole('dialog', { name: /swap exercise/i });
    expect(dialog).toBeInTheDocument();
    await screen.findByText(/DB Bench Press/);
    await user.click(screen.getByText(/DB Bench Press/));
    await user.click(screen.getByRole('button', { name: /apply/i }));
    // program_edit context defaults to "every occurrence" scope
    expect(upApi.patchUserProgram).toHaveBeenCalledWith('up-1', {
      op: 'swap_exercise_all',
      from_slug: 'dumbbell-goblet-squat',
      to_exercise_slug: 'db-bench-press',
    });
    // Sheet closes after a successful apply
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /swap exercise/i })).not.toBeInTheDocument(),
    );
  });

  it('beginner track: shows plain-language effort cue + definitive set copy, no RIR jargon', async () => {
    vi.spyOn(upApi, 'getUserProgram').mockResolvedValue({
      ...program(),
      track: 'beginner',
    });
    renderWizard();
    await screen.findByText(/Full Body A/);
    expect(screen.getByText(/leave 2 reps in the tank/i)).toBeInTheDocument();
    expect(screen.getByText(/8 sets, building to 14/i)).toBeInTheDocument();
    expect(screen.queryByText(/RIR/)).not.toBeInTheDocument();
  });
});
