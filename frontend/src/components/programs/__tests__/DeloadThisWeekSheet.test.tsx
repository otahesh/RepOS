import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeloadThisWeekSheet } from '../DeloadThisWeekSheet';
import * as deloadApi from '../../../lib/api/manualDeload';
import * as toast from '../../common/ToastHost';

beforeEach(() => {
  vi.spyOn(toast, 'pushToast').mockReturnValue('id');
});

describe('<DeloadThisWeekSheet>', () => {
  it('shows the plain-language MAV/RIR summary with term wrappers', () => {
    render(<DeloadThisWeekSheet runId="run-1" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Confirm deload' });
    expect(dialog.textContent).toMatch(/half of/i);
    expect(dialog.textContent).toMatch(/MAV/);
    expect(dialog.textContent).toMatch(/RIR/);
    expect(dialog.textContent).toMatch(/24 hours/);
  });

  it('Confirm calls triggerManualDeload then onClose(true)', async () => {
    const trigger = vi.spyOn(deloadApi, 'triggerManualDeload').mockResolvedValue({
      run_id: 'run-1', removed_planned_sets: 2, affected_planned_sets: 4,
      affected_day_workouts: 3, affected_week_idxs: [2, 3, 4], triggered_at: 't',
    });
    const onClose = vi.fn();
    render(<DeloadThisWeekSheet runId="run-1" onClose={onClose} />);
    fireEvent.click(screen.getByText('CONFIRM DELOAD'));
    await waitFor(() => expect(trigger).toHaveBeenCalledWith('run-1'));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it('surfaces an error inline if the POST fails (sheet stays open)', async () => {
    vi.spyOn(deloadApi, 'triggerManualDeload').mockRejectedValue(new Error('manual_deload_failed_409'));
    const onClose = vi.fn();
    render(<DeloadThisWeekSheet runId="run-1" onClose={onClose} />);
    fireEvent.click(screen.getByText('CONFIRM DELOAD'));
    await waitFor(() => expect(screen.getByText(/manual_deload_failed_409/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalledWith(true);
  });
});
