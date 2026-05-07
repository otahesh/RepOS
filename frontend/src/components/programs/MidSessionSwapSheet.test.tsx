import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MidSessionSwapSheet } from './MidSessionSwapSheet';
import * as plannedApi from '../../lib/api/plannedSets';

describe('<MidSessionSwapSheet>', () => {
  it('confirms triggers substitutePlannedSet', async () => {
    vi.spyOn(plannedApi, 'substitutePlannedSet').mockResolvedValue({ id: 'ps-1', exercise_id: 'e-2', substituted_from_exercise_id: 'e-1', overridden_at: '2026-05-07T00:00:00Z' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MidSessionSwapSheet plannedSetId="ps-1" fromName="Barbell Bench Press" toId="00000000-0000-0000-0000-000000000002" toName="Incline DB Bench" onClose={onClose} />);
    await user.click(screen.getByText(/confirm swap/i));
    expect(plannedApi.substitutePlannedSet).toHaveBeenCalledWith('ps-1', { to_exercise_id: '00000000-0000-0000-0000-000000000002' });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
