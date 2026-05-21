import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsStorage from './SettingsStorage';

const mockCounts: {
  pending: number;
  syncing: number;
  rejected: number;
  oldestPendingCreatedAt: number | null;
} = {
  pending: 0,
  syncing: 0,
  rejected: 0,
  oldestPendingCreatedAt: null,
};

vi.mock('../../hooks/useIdbQueueCounts', () => ({
  useIdbQueueCounts: () => mockCounts,
}));

const clearRejectedSpy = vi.fn();
vi.mock('../../lib/idbQueue', () => ({
  idbQueue: {
    clearRejected: () => {
      clearRejectedSpy();
      return Promise.resolve();
    },
  },
}));

function setCounts(p: Partial<typeof mockCounts>) {
  mockCounts.pending = p.pending ?? 0;
  mockCounts.syncing = p.syncing ?? 0;
  mockCounts.rejected = p.rejected ?? 0;
  mockCounts.oldestPendingCreatedAt = p.oldestPendingCreatedAt ?? null;
}

describe('<SettingsStorage>', () => {
  beforeEach(() => {
    setCounts({});
    clearRejectedSpy.mockClear();
  });

  it('renders the page heading and three count rows', () => {
    setCounts({ pending: 3, syncing: 1, rejected: 2 });
    render(<SettingsStorage />);

    expect(screen.getByRole('heading', { name: /storage/i })).toBeInTheDocument();
    expect(screen.getByTestId('count-pending')).toHaveTextContent('3');
    expect(screen.getByTestId('count-syncing')).toHaveTextContent('1');
    expect(screen.getByTestId('count-rejected')).toHaveTextContent('2');
  });

  it('labels pending rows as NOT clearable (data-loss warning)', () => {
    setCounts({ pending: 4 });
    render(<SettingsStorage />);
    expect(screen.getByTestId('row-pending')).toHaveTextContent(/clearing would lose data/i);
  });

  it('hides the Clear-rejected button when rejected count is 0', () => {
    setCounts({ pending: 2, rejected: 0 });
    render(<SettingsStorage />);
    expect(screen.queryByRole('button', { name: /clear rejected/i })).toBeNull();
  });

  it('shows Clear-rejected button when rejected > 0', () => {
    setCounts({ rejected: 3 });
    render(<SettingsStorage />);
    expect(screen.getByRole('button', { name: /clear rejected/i })).toBeInTheDocument();
  });

  it('Clear-rejected surfaces a confirm prompt; Cancel dismisses without calling clearRejected', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 1 });
    render(<SettingsStorage />);

    await user.click(screen.getByRole('button', { name: /clear rejected/i }));
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(clearRejectedSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });

  it('Clear-rejected → type CLEAR + Confirm calls idbQueue.clearRejected', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 2 });
    render(<SettingsStorage />);

    await user.click(screen.getByRole('button', { name: /clear rejected/i }));
    // Confirm is disabled until the user types CLEAR (defense-in-depth
    // against same-origin scripts driving Clear → Confirm with synthetic
    // clicks).
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/type clear to confirm/i), 'CLEAR');
    expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(clearRejectedSpy).toHaveBeenCalledTimes(1);
  });

  it('Confirm stays disabled if the typed phrase is wrong', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 1 });
    render(<SettingsStorage />);

    await user.click(screen.getByRole('button', { name: /clear rejected/i }));
    await user.type(screen.getByLabelText(/type clear to confirm/i), 'clear');
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
  });

  it('shows oldest-pending age when a stale pending row is present', () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    setCounts({ pending: 1, oldestPendingCreatedAt: tenDaysAgo });
    render(<SettingsStorage />);
    expect(screen.getByTestId('row-pending')).toHaveTextContent(/10 days old/i);
  });

  it('focuses Cancel when the confirm modal opens', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 1 });
    render(<SettingsStorage />);

    await user.click(screen.getByRole('button', { name: /clear rejected/i }));
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
  });

  it('Escape closes the confirm modal without clearing', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 1 });
    render(<SettingsStorage />);

    await user.click(screen.getByRole('button', { name: /clear rejected/i }));
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText(/are you sure/i)).toBeNull();
    expect(clearRejectedSpy).not.toHaveBeenCalled();
  });
});
