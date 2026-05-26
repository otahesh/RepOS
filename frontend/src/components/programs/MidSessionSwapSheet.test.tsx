import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MidSessionSwapSheet } from './MidSessionSwapSheet';
import { ToastHost } from '../common/ToastHost';
import * as plannedApi from '../../lib/api/plannedSets';

describe('<MidSessionSwapSheet>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms triggers substitutePlannedSet', async () => {
    vi.spyOn(plannedApi, 'substitutePlannedSet').mockResolvedValue({ id: 'ps-1', exercise_id: 'e-2', substituted_from_exercise_id: 'e-1', overridden_at: '2026-05-07T00:00:00Z' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MidSessionSwapSheet plannedSetId="ps-1" fromName="Barbell Bench Press" toId="00000000-0000-0000-0000-000000000002" toName="Incline DB Bench" onClose={onClose} />);
    await user.click(screen.getByText(/confirm swap/i));
    expect(plannedApi.substitutePlannedSet).toHaveBeenCalledWith('ps-1', { to_exercise_id: '00000000-0000-0000-0000-000000000002' });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows a success Toast with an Undo action on a successful swap', async () => {
    vi.spyOn(plannedApi, 'substitutePlannedSet').mockResolvedValue({ id: 'ps-1', exercise_id: 'e-2', substituted_from_exercise_id: 'e-1', overridden_at: '2026-05-07T00:00:00Z' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <ToastHost />
        <MidSessionSwapSheet plannedSetId="ps-1" fromName="Barbell Bench Press" toId="e-2" toName="Incline DB Bench" onClose={onClose} />
      </>,
    );
    await user.click(screen.getByText(/confirm swap/i));
    // Toast surfaces with the success copy and an Undo action button.
    expect(await screen.findByText(/^Swapped\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });

  it('Undo re-substitutes back to the original exercise', async () => {
    const spy = vi
      .spyOn(plannedApi, 'substitutePlannedSet')
      .mockResolvedValue({ id: 'ps-1', exercise_id: 'e-2', substituted_from_exercise_id: 'e-1', overridden_at: '2026-05-07T00:00:00Z' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <ToastHost />
        <MidSessionSwapSheet plannedSetId="ps-1" fromName="Barbell Bench Press" toId="e-2" toName="Incline DB Bench" onClose={onClose} />
      </>,
    );
    await user.click(screen.getByText(/confirm swap/i));
    const undo = await screen.findByRole('button', { name: /undo/i });
    await user.click(undo);
    // The reversal re-substitutes the planned set back to the prior exercise id.
    expect(spy).toHaveBeenLastCalledWith('ps-1', { to_exercise_id: 'e-1' });
  });
});
