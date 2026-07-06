import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistorySheet } from './HistorySheet';
import * as historyApi from '../../../lib/api/exerciseHistory';

// Auto-mock (no factory). The repo's vitest config sets `restoreMocks: true`,
// which wipes factory-set mockResolvedValue between tests — so resolved
// values MUST be (re)set in beforeEach, after the restore. Mirrors
// DesktopSwapSheet.test.tsx.
vi.mock('../../../lib/api/exerciseHistory');

describe('<HistorySheet>', () => {
  beforeEach(() => {
    vi.mocked(historyApi.getExerciseHistory).mockResolvedValue([]);
  });

  it('renders as a dialog labeled "Exercise history"', async () => {
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Exercise history' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/no history yet/i)).toBeInTheDocument());
  });

  it('shows a spinner (not raw text) while fetching', async () => {
    let resolve!: (v: historyApi.HistorySession[]) => void;
    const pending = new Promise<historyApi.HistorySession[]>((r) => {
      resolve = r;
    });
    vi.mocked(historyApi.getExerciseHistory).mockReturnValue(pending);
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />);
    expect(screen.getByRole('status', { name: /loading history/i })).toBeInTheDocument();
    expect(screen.queryByText(/no history yet/i)).not.toBeInTheDocument();
    resolve([]);
    await waitFor(() => expect(screen.getByText(/no history yet/i)).toBeInTheDocument());
  });

  it('shows the empty state when there is no history', async () => {
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('No history yet — first time doing this one.')).toBeInTheDocument(),
    );
  });

  it('shows an actionable error message on fetch failure', async () => {
    vi.mocked(historyApi.getExerciseHistory).mockRejectedValue(new Error('network unreachable'));
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("Couldn't load history: network unreachable")).toBeInTheDocument(),
    );
  });

  it('lists sessions with formatted dates and sets, appending RIR for non-beginner tracks', async () => {
    vi.mocked(historyApi.getExerciseHistory).mockResolvedValue([
      {
        date: '2026-07-01',
        sets: [
          { weight_lbs: 135, reps: 8, rir: 2 },
          { weight_lbs: 145, reps: 6, rir: 1 },
        ],
      },
    ]);
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Jul 1/)).toBeInTheDocument());
    expect(screen.getByText('135 × 8 @RIR 2')).toBeInTheDocument();
    expect(screen.getByText('145 × 6 @RIR 1')).toBeInTheDocument();
  });

  it('includes the year when a session is not from the current year', async () => {
    vi.mocked(historyApi.getExerciseHistory).mockResolvedValue([
      { date: '2025-12-15', sets: [{ weight_lbs: 100, reps: 10, rir: 3 }] },
    ]);
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Dec 15, 2025')).toBeInTheDocument());
  });

  it('never renders RIR text on beginner tracks', async () => {
    vi.mocked(historyApi.getExerciseHistory).mockResolvedValue([
      { date: '2026-07-01', sets: [{ weight_lbs: 135, reps: 8, rir: 2 }] },
    ]);
    render(<HistorySheet slug="bb-bench-press" track="beginner" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('135 × 8')).toBeInTheDocument());
    expect(screen.queryByText(/RIR/)).not.toBeInTheDocument();
  });

  it('renders BW for null weight and omits reps when reps is null', async () => {
    vi.mocked(historyApi.getExerciseHistory).mockResolvedValue([
      {
        date: '2026-07-01',
        sets: [
          { weight_lbs: null, reps: 8, rir: null },
          { weight_lbs: 135, reps: null, rir: null },
        ],
      },
    ]);
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('BW × 8')).toBeInTheDocument());
    expect(screen.getByText('135')).toBeInTheDocument();
  });

  it('ESC closes the sheet via onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('backdrop click calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    await user.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking inside the sheet panel does not call onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/no history yet/i)).toBeInTheDocument());
    await user.click(screen.getByText(/no history yet/i));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('initial focus lands inside the dialog, and closing restores it', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(
      <HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it('fetches history for the given slug with a limit of 8', () => {
    render(<HistorySheet slug="bb-bench-press" track="intermediate" onClose={() => {}} />);
    expect(historyApi.getExerciseHistory).toHaveBeenCalledWith('bb-bench-press', 8);
  });
});
