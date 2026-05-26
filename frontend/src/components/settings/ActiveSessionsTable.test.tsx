// frontend/src/components/settings/ActiveSessionsTable.test.tsx
//
// Beta W6 Task 14 — component-level tests for the active-sessions surface.
//
// Tests:
//   1. lists active sessions with label + last_used_at + truncated /24 IP
//      (desktop layout — table rows).
//   2. renders empty state "No active sessions" when listSessions resolves []
//   3. renders card layout at <600px viewport (per I-SESSIONS-MOBILE)
//
// The component reads window.innerWidth + listens to resize to flip layouts,
// so each test sets innerWidth + fires a resize event before render.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as api from '../../lib/api/account';
import { ActiveSessionsTable } from './ActiveSessionsTable';

vi.mock('../../lib/api/account');

// Helper: set window.innerWidth and dispatch resize (the listener inside the
// component will pick up the new value).
function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  // Default to desktop width before each test; individual tests override.
  setViewport(1024);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActiveSessionsTable', () => {
  it('lists active sessions with label, last_used_at, and truncated /24 IP (desktop)', async () => {
    setViewport(1024);
    vi.mocked(api.listSessions).mockResolvedValue([
      {
        id: 'sess-1',
        label: 'iOS Shortcut',
        created_at: '2026-05-01T10:00:00.000Z',
        last_used_at: '2026-05-20T18:30:00.000Z',
        last_used_ip_24: '192.168.1.0/24',
      },
    ]);

    render(<ActiveSessionsTable />);

    // Wait for the first row to land.
    await waitFor(() =>
      expect(screen.getByTestId('session-row')).toBeInTheDocument(),
    );
    expect(screen.getByText('iOS Shortcut')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.0/24')).toBeInTheDocument();
    // last_used_at rendered (we don't assert exact format, just that the date
    // is present).
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it('renders empty state "No active sessions" when the list is empty', async () => {
    vi.mocked(api.listSessions).mockResolvedValue([]);
    render(<ActiveSessionsTable />);
    await waitFor(() =>
      expect(screen.getByText(/no active sessions/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('session-row')).toBeNull();
    expect(screen.queryByTestId('session-card')).toBeNull();
  });

  it('renders card layout at <600px viewport (per I-SESSIONS-MOBILE)', async () => {
    setViewport(500);
    vi.mocked(api.listSessions).mockResolvedValue([
      {
        id: 'sess-1',
        label: 'iOS Shortcut',
        created_at: '2026-05-01T10:00:00.000Z',
        last_used_at: '2026-05-20T18:30:00.000Z',
        last_used_ip_24: '10.0.0.0/24',
      },
    ]);
    render(<ActiveSessionsTable />);

    await waitFor(() =>
      expect(screen.getByTestId('session-card')).toBeInTheDocument(),
    );
    // Mobile = cards only; no table rows.
    expect(screen.queryByTestId('session-row')).toBeNull();
    expect(screen.getByText('iOS Shortcut')).toBeInTheDocument();
    // The IP is rendered next to a <Term> label inside the card, so match
    // the card text rather than an isolated text node.
    expect(screen.getByTestId('session-card')).toHaveTextContent('10.0.0.0/24');
  });
});
