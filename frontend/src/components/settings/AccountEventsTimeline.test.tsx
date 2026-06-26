// frontend/src/components/settings/AccountEventsTimeline.test.tsx
//
// Beta W6 Task 16 — component tests for the account-events audit feed.
//
// Covers (spec lines 3621–3632):
//   1. Renders events with the humanized kind + a relative time.
//   2. Empty state when listEvents() returns no events.
//   3. "Load older" invokes listEvents({ before_ts, before_id }) with the prior
//      page's keyset cursor (only present when next_cursor is non-null).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../lib/api/account';
import { AccountEventsTimeline } from './AccountEventsTimeline';

vi.mock('../../lib/api/account');

function row(over: Partial<api.AccountEventRow> = {}): api.AccountEventRow {
  return {
    id: 'e1',
    kind: 'profile_changed',
    ip: '203.0.113.0/24',
    user_email_at_event: null,
    meta: {},
    occurred_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...over,
  };
}

describe('AccountEventsTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders events with humanized kind + relative time', async () => {
    vi.mocked(api.listEvents).mockResolvedValue({
      events: [
        row({ id: 'e1', kind: 'profile_changed', meta: { fields: ['display_name'] } }),
        row({
          id: 'e2',
          kind: 'signout_everywhere',
          meta: { revoked_count: 3 },
          occurred_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
        }),
      ],
      next_cursor: null,
    });

    render(<AccountEventsTimeline />);

    await waitFor(() => expect(screen.getByText('Profile changed')).toBeInTheDocument());
    expect(screen.getByText('Signed out everywhere')).toBeInTheDocument();
    // Relative time rendered (newest row ~5m ago, older ~2h ago).
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
    // Meta details surfaced.
    expect(screen.getByText('display_name')).toBeInTheDocument();
    expect(screen.getByText('3 revoked')).toBeInTheDocument();
  });

  it('shows an empty state when there are no events', async () => {
    vi.mocked(api.listEvents).mockResolvedValue({ events: [], next_cursor: null });
    render(<AccountEventsTimeline />);
    await waitFor(() => expect(screen.getByText(/no account activity yet/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /load older/i })).toBeNull();
  });

  it('"Load older" calls listEvents with the prior page keyset cursor', async () => {
    const cursor = { before_ts: '2026-05-01T00:00:00.000Z', before_id: 'e1' };
    vi.mocked(api.listEvents)
      // first (initial) page returns a non-null cursor
      .mockResolvedValueOnce({ events: [row({ id: 'e1' })], next_cursor: cursor })
      // second (older) page returns the rest with no further cursor
      .mockResolvedValueOnce({ events: [row({ id: 'e0' })], next_cursor: null });

    render(<AccountEventsTimeline />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /load older/i })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: /load older/i }));

    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          before_ts: cursor.before_ts,
          before_id: cursor.before_id,
        }),
      ),
    );
    // After the second page reports next_cursor: null, the button is gone.
    await waitFor(() => expect(screen.queryByRole('button', { name: /load older/i })).toBeNull());
  });
});
