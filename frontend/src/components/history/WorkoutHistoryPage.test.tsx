import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/api/workoutHistory');
vi.mock('../../lib/api/dayWorkouts');
vi.mock('../common/ToastHost', () => ({ pushToast: vi.fn() }));
vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: vi.fn() }));

import WorkoutHistoryPage from './WorkoutHistoryPage';
import {
  getWorkoutHistory,
  type WorkoutHistoryPage as HistoryPageT,
} from '../../lib/api/workoutHistory';
import { reopenDayWorkout } from '../../lib/api/dayWorkouts';
import { pushToast } from '../common/ToastHost';
import { useIsMobile } from '../../lib/useIsMobile';

const getHistory = vi.mocked(getWorkoutHistory);
const reopen = vi.mocked(reopenDayWorkout);
const toast = vi.mocked(pushToast);
const mobile = vi.mocked(useIsMobile);

// week_idx is 1-indexed (printed as-is); day_idx 0-indexed.
const PAGE1: HistoryPageT = {
  items: [
    {
      id: 'dw-1',
      name: 'Upper A',
      kind: 'strength',
      week_idx: 2,
      day_idx: 0,
      status: 'completed',
      completed_at: '2026-07-08T15:00:00Z',
      scheduled_date: '2026-07-08',
      exercises: [
        {
          slug: 'barbell-bench-press',
          name: 'Barbell Bench Press',
          sets: [
            { weight_lbs: 135, reps: 8, rir: 2, performed_at: '2026-07-08T15:01:00Z' },
            { weight_lbs: 135, reps: 7, rir: 1, performed_at: '2026-07-08T15:05:00Z' },
          ],
        },
      ],
    },
    {
      id: 'dw-2',
      name: 'Lower A',
      kind: 'strength',
      week_idx: 1,
      day_idx: 2,
      status: 'skipped',
      completed_at: null,
      scheduled_date: '2026-07-01',
      exercises: [],
    },
  ],
  next_cursor: 'CURSOR2',
};

const PAGE2: HistoryPageT = {
  items: [
    {
      id: 'dw-3',
      name: 'Conditioning',
      kind: 'cardio',
      week_idx: 1,
      day_idx: 4,
      status: 'completed',
      completed_at: '2026-06-30T12:00:00Z',
      scheduled_date: '2026-06-30',
      exercises: [
        {
          slug: 'row-erg',
          name: 'Row Erg',
          sets: [{ weight_lbs: null, reps: null, rir: null, performed_at: '2026-06-30T12:10:00Z' }],
        },
      ],
    },
  ],
  next_cursor: null,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkoutHistoryPage />
    </MemoryRouter>,
  );
}

describe('WorkoutHistoryPage', () => {
  beforeEach(() => {
    // Default: desktop, cursor-aware history mock.
    mobile.mockReturnValue(false);
    getHistory.mockImplementation(async (cursor?: string) =>
      cursor === 'CURSOR2' ? PAGE2 : PAGE1,
    );
    reopen.mockResolvedValue({
      id: 'dw-1',
      status: 'not_started',
      completed_at: null,
      run_completed: false,
    });
  });

  it('renders items with their logged sets (weight × reps @RIR, in Mono)', async () => {
    renderPage();
    expect(await screen.findByText('Upper A')).toBeInTheDocument();
    expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
    // First item is expanded by default — set detail is visible.
    expect(screen.getByText(/135\s*×\s*8\s*@RIR\s*2/)).toBeInTheDocument();
    expect(screen.getByText(/135\s*×\s*7\s*@RIR\s*1/)).toBeInTheDocument();
  });

  it('shows a SKIPPED badge on skipped workouts', async () => {
    renderPage();
    const card = (await screen.findByText('Lower A')).closest('[data-testid="history-card"]');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(/^skipped$/i)).toBeInTheDocument();
  });

  it('shows the empty state when there is no history', async () => {
    getHistory.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    expect(await screen.findByText(/no workouts yet/i)).toBeInTheDocument();
  });

  it('reopens a terminal workout (via confirm) and refetches the list', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Upper A');
    const callsBefore = getHistory.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /reopen upper a/i }));
    // Confirm dialog gates the sequence-mutating action.
    const dialog = await screen.findByRole('dialog');
    expect(reopen).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /reopen/i }));

    await waitFor(() => expect(reopen).toHaveBeenCalledWith('dw-1'));
    // Refetch: getWorkoutHistory invoked again after the reopen resolves.
    await waitFor(() => expect(getHistory.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('surfaces an actionable error (toast) when reopen fails', async () => {
    reopen.mockRejectedValue(Object.assign(new Error('HTTP 500'), { status: 500 }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Upper A');
    await user.click(screen.getByRole('button', { name: /reopen upper a/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /reopen/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const arg = toast.mock.calls[toast.mock.calls.length - 1]?.[0];
    expect(arg?.severity).toBe('error');
    expect(arg?.body).toMatch(/reopen/i);
  });

  it('loads more and appends the next page, carrying the cursor', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Upper A');
    // Second page not yet loaded.
    expect(screen.queryByText('Conditioning')).toBeNull();
    await user.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText('Conditioning')).toBeInTheDocument();
    // Page 1 items are still present (appended, not replaced).
    expect(screen.getByText('Upper A')).toBeInTheDocument();
    await waitFor(() => expect(getHistory).toHaveBeenCalledWith('CURSOR2'));
    // Cursor exhausted — no Load more button once next_cursor is null.
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('groups items under WEEK headings on desktop (week_idx printed as-is)', async () => {
    mobile.mockReturnValue(false);
    renderPage();
    await screen.findByText('Upper A');
    expect(screen.getByText(/^week\s*2$/i)).toBeInTheDocument();
    expect(screen.getByText(/^week\s*1$/i)).toBeInTheDocument();
  });

  it('renders a flat list with NO week headings on mobile (same items + actions)', async () => {
    mobile.mockReturnValue(true);
    renderPage();
    await screen.findByText('Upper A');
    expect(screen.queryByText(/^week\s*\d+$/i)).toBeNull();
    // Same capability on mobile: the reopen action is present.
    expect(screen.getByRole('button', { name: /reopen upper a/i })).toBeInTheDocument();
  });
});
