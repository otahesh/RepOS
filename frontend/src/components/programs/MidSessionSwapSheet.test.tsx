import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MidSessionSwapSheet } from './MidSessionSwapSheet';
import * as plannedApi from '../../lib/api/plannedSets';

describe('<MidSessionSwapSheet>', () => {
  it('confirms triggers substitutePlannedSet', async () => {
    vi.spyOn(plannedApi, 'substitutePlannedSet').mockResolvedValue({ id: 'ps-1', exercise_id: 'e-2', substituted_from_exercise_id: 'e-1' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MidSessionSwapSheet plannedSetId="ps-1" fromName="Barbell Bench Press" toSlug="incline-dumbbell-bench-press" toName="Incline DB Bench" onClose={onClose} />);
    await user.click(screen.getByText(/confirm swap/i));
    expect(plannedApi.substitutePlannedSet).toHaveBeenCalledWith('ps-1', { to_exercise_slug: 'incline-dumbbell-bench-press' });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
