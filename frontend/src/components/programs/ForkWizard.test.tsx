import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForkWizard } from './ForkWizard';
import * as api from '../../lib/api/userPrograms';

describe('<ForkWizard>', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getUserProgram').mockResolvedValue({
      id: 'up-1', user_id: 'u-1', template_id: 't-1', template_version: 1, name: 'Full Body 3-Day Foundation',
      effective_name: 'Full Body 3-Day Foundation',
      customizations: {}, status: 'draft',
      effective_structure: { _v: 1, days: [
        { idx: 0, day_offset: 0, kind: 'strength', name: 'Full Body A', blocks: [{ exercise_slug: 'dumbbell-goblet-squat', mev: 8, mav: 14, target_reps_low: 8, target_reps_high: 10, target_rir: 2, rest_sec: 120 }] },
        { idx: 1, day_offset: 2, kind: 'strength', name: 'Full Body B', blocks: [] },
        { idx: 2, day_offset: 4, kind: 'strength', name: 'Full Body C', blocks: [] },
      ]},
    } as any);
    vi.spyOn(api, 'patchUserProgram').mockResolvedValue({ id: 'up-1' } as any);
    vi.spyOn(api, 'startUserProgram').mockResolvedValue({ mesocycle_run_id: 'mr-1' });
  });
  it('renders 3 day cards', async () => {
    render(<ForkWizard userProgramId="up-1" onStarted={vi.fn()} />);
    expect(await screen.findByText(/Full Body A/)).toBeInTheDocument();
    expect(screen.getByText(/Full Body B/)).toBeInTheDocument();
    expect(screen.getByText(/Full Body C/)).toBeInTheDocument();
  });
  it('rename triggers PATCH', async () => {
    const user = userEvent.setup();
    render(<ForkWizard userProgramId="up-1" onStarted={vi.fn()} />);
    await screen.findByText(/Full Body A/);
    const input = screen.getByLabelText(/program name/i);
    await user.clear(input);
    await user.type(input, 'My FB Run');
    await user.click(screen.getByText(/save name/i));
    expect(api.patchUserProgram).toHaveBeenCalledWith('up-1', { name: 'My FB Run' });
  });
  it('start materializes and calls onStarted with mesocycle id', async () => {
    const onStarted = vi.fn();
    const user = userEvent.setup();
    render(<ForkWizard userProgramId="up-1" onStarted={onStarted} />);
    await screen.findByText(/Full Body A/);
    await user.click(screen.getByRole('button', { name: /start mesocycle/i }));
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledWith('mr-1'));
  });
});
