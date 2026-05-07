import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ForkWizard } from './ForkWizard';
import * as upApi from '../../lib/api/userPrograms';
import * as msApi from '../../lib/api/mesocycles';
import { ApiError } from '../../lib/api/_http';

function renderWizard(onStarted = vi.fn()) {
  return render(
    <MemoryRouter>
      <ForkWizard userProgramId="up-1" onStarted={onStarted} />
    </MemoryRouter>,
  );
}

describe('<ForkWizard>', () => {
  beforeEach(() => {
    vi.spyOn(upApi, 'getUserProgram').mockResolvedValue({
      id: 'up-1', user_id: 'u-1', template_id: 't-1', template_version: 1, name: 'Full Body 3-Day Foundation',
      effective_name: 'Full Body 3-Day Foundation',
      customizations: {}, status: 'draft',
      effective_structure: { _v: 1, days: [
        { idx: 0, day_offset: 0, kind: 'strength', name: 'Full Body A', blocks: [{ exercise_slug: 'dumbbell-goblet-squat', mev: 8, mav: 14, target_reps_low: 8, target_reps_high: 10, target_rir: 2, rest_sec: 120 }] },
        { idx: 1, day_offset: 2, kind: 'strength', name: 'Full Body B', blocks: [] },
        { idx: 2, day_offset: 4, kind: 'strength', name: 'Full Body C', blocks: [] },
      ]},
    } as any);
    vi.spyOn(upApi, 'getUserProgramWarnings').mockResolvedValue([]);
    vi.spyOn(upApi, 'patchUserProgram').mockResolvedValue({ id: 'up-1' } as any);
    vi.spyOn(upApi, 'startUserProgram').mockResolvedValue({ mesocycle_run_id: 'mr-1' });
    // Default: no active run anywhere — happy-path wizard.
    vi.spyOn(msApi, 'getTodayWorkout').mockResolvedValue({ state: 'no_active_run' });
    vi.spyOn(msApi, 'abandonMesocycle').mockResolvedValue({
      mesocycle_run_id: 'mr-9', status: 'abandoned',
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
    expect(upApi.patchUserProgram).toHaveBeenCalledWith('up-1', { op: 'rename', name: 'My FB Run' });
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
    vi.spyOn(msApi, 'getTodayWorkout').mockResolvedValue({
      state: 'rest', run_id: 'mr-existing', scheduled_date: '2026-05-05',
    });
    renderWizard();
    expect(await screen.findByRole('alert')).toHaveTextContent(/already have an active/i);
    const startBtn = screen.getByRole('button', { name: /start mesocycle/i });
    expect(startBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: /abandon current mesocycle/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view today/i })).toBeInTheDocument();
  });

  it('Abandon clears the conflict and re-enables Start', async () => {
    const today = vi.spyOn(msApi, 'getTodayWorkout').mockResolvedValueOnce({
      state: 'rest', run_id: 'mr-existing', scheduled_date: '2026-05-05',
    });
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
    const today = vi.spyOn(msApi, 'getTodayWorkout')
      .mockResolvedValueOnce({ state: 'no_active_run' });
    vi.spyOn(upApi, 'startUserProgram').mockRejectedValue(
      new ApiError(409, { error: 'active_run_exists' }, '{"error":"active_run_exists"}'),
    );
    const user = userEvent.setup();
    renderWizard();
    await screen.findByText(/Full Body A/);
    today.mockResolvedValueOnce({
      state: 'rest', run_id: 'mr-race', scheduled_date: '2026-05-05',
    });
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
});
