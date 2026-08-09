import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeloadThisWeekButton } from '../DeloadThisWeekButton';
import * as deloadApi from '../../../lib/api/manualDeload';
import * as toast from '../../common/ToastHost';

beforeEach(() => {
  vi.spyOn(toast, 'pushToast').mockReturnValue('id');
});

describe('<DeloadThisWeekButton>', () => {
  it('renders the trigger and opens the confirm sheet on click', () => {
    render(<DeloadThisWeekButton runId="run-1" />);
    const trigger = screen.getByRole('button', { name: 'Deload this week' });
    expect(trigger).toBeInTheDocument();
    // Sheet is not open initially.
    expect(screen.queryByRole('dialog', { name: 'Confirm deload' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Confirm deload' })).toBeInTheDocument();
  });

  it('two-step confirm: trigger → sheet → Confirm posts deload + toast + onChanged', async () => {
    const trigger2 = vi.spyOn(deloadApi, 'triggerManualDeload').mockResolvedValue({
      run_id: 'run-1',
      removed_planned_sets: 4,
      affected_planned_sets: 8,
      affected_day_workouts: 6,
      affected_week_idxs: [2, 3, 4, 5],
      triggered_at: 't',
    });
    const onChanged = vi.fn();
    render(<DeloadThisWeekButton runId="run-1" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deload this week' }));
    fireEvent.click(screen.getByText('CONFIRM DELOAD'));
    await waitFor(() => expect(trigger2).toHaveBeenCalledWith('run-1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // Success toast pushed with an Undo action.
    expect(toast.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', actionLabel: 'Undo' }),
    );
    // Sheet closed.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Confirm deload' })).not.toBeInTheDocument(),
    );
  });

  it('Cancel closes the sheet without posting', () => {
    const trigger2 = vi.spyOn(deloadApi, 'triggerManualDeload');
    render(<DeloadThisWeekButton runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Deload this week' }));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('dialog', { name: 'Confirm deload' })).not.toBeInTheDocument();
    expect(trigger2).not.toHaveBeenCalled();
  });

  it('the toast Undo action calls undoManualDeload', async () => {
    vi.spyOn(deloadApi, 'triggerManualDeload').mockResolvedValue({
      run_id: 'run-1',
      removed_planned_sets: 0,
      affected_planned_sets: 0,
      affected_day_workouts: 0,
      affected_week_idxs: [],
      triggered_at: 't',
    });
    const undo = vi.spyOn(deloadApi, 'undoManualDeload').mockResolvedValue({ reversed_at: 't' });
    // Capture the toast's onAction.
    let captured: (() => void) | undefined;
    vi.spyOn(toast, 'pushToast').mockImplementation((spec) => {
      if (spec.actionLabel === 'Undo') captured = spec.onAction;
      return 'id';
    });
    render(<DeloadThisWeekButton runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Deload this week' }));
    fireEvent.click(screen.getByText('CONFIRM DELOAD'));
    await waitFor(() => expect(captured).toBeTypeOf('function'));
    captured!();
    await waitFor(() => expect(undo).toHaveBeenCalledWith('run-1'));
  });

  // ── A11y (sheet) ────────────────────────────────────────────────────────
  it('A11y: ESC closes the confirm sheet', () => {
    render(<DeloadThisWeekButton runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Deload this week' }));
    expect(screen.getByRole('dialog', { name: 'Confirm deload' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Confirm deload' })).not.toBeInTheDocument();
  });

  it('A11y: initial focus moves into the sheet on open', () => {
    render(<DeloadThisWeekButton runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Deload this week' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm deload' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
