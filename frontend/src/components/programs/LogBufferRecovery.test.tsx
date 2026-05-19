import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { LogBufferRecovery } from './LogBufferRecovery';
import AppShell from '../layout/AppShell';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockCounts: { pending: number; syncing: number; rejected: number; oldestPendingCreatedAt: number | null } = {
  pending: 0,
  syncing: 0,
  rejected: 0,
  oldestPendingCreatedAt: null,
};
const mockNetwork = { online: true, transitionedAt: 0 };

vi.mock('../../hooks/useIdbQueueCounts', () => ({
  useIdbQueueCounts: () => mockCounts,
}));

vi.mock('../../hooks/useNetworkState', () => ({
  useNetworkState: () => mockNetwork,
}));

// AppShell pulls in Topbar (apiFetch), the auth module, and the mobile-detector;
// mock them so the integration assertion only checks banner mount-through.
vi.mock('../../auth', () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    AuthProvider: passthrough,
    AuthGate: passthrough,
    apiFetch: vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: 'fresh', last_success_at: null, source: 'Apple Health' }),
    }),
    useCurrentUser: () => ({
      status: 'authenticated' as const,
      user: { id: 'u', email: 'a@b.c', display_name: 'A', timezone: 'UTC' },
      error: null,
    }),
  };
});

vi.mock('../../lib/useIsMobile', () => ({
  useIsMobile: () => true,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <LogBufferRecovery />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function setCounts(c: Partial<typeof mockCounts>) {
  mockCounts.pending = c.pending ?? 0;
  mockCounts.syncing = c.syncing ?? 0;
  mockCounts.rejected = c.rejected ?? 0;
  mockCounts.oldestPendingCreatedAt =
    c.oldestPendingCreatedAt !== undefined ? c.oldestPendingCreatedAt : null;
}

function setOnline(v: boolean) {
  mockNetwork.online = v;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LogBufferRecovery', () => {
  beforeEach(() => {
    setCounts({});
    setOnline(true);
  });

  it('renders null when all counts are zero (regardless of route)', () => {
    renderAt('/today/run-1/log');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders OFFLINE banner when offline + pending > 0 on /today/run-1/log', () => {
    setCounts({ pending: 3 });
    setOnline(false);
    renderAt('/today/run-1/log');
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/OFFLINE/);
    expect(banner).toHaveTextContent(/3 sets queued/);
  });

  it('renders syncing banner when syncing > 0 on /programs', () => {
    setCounts({ syncing: 2 });
    renderAt('/programs');
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/2 sets syncing/);
  });

  it('renders rejected banner with proper copy when rejected > 0 on /', () => {
    setCounts({ rejected: 4 });
    renderAt('/');
    const banner = screen.getByRole('button');
    expect(banner).toHaveTextContent(/4 sets rejected/);
    expect(banner).toHaveTextContent(/review/i);
  });

  it('rejected banner click navigates to /settings/storage', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 1 });
    renderAt('/today/run-1/log');
    const banner = screen.getByRole('button');
    await user.click(banner);
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/storage');
  });

  it('rejected banner keyboard (Enter) navigates to /settings/storage', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 1 });
    renderAt('/today/run-1/log');
    const banner = screen.getByRole('button');
    banner.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/storage');
  });

  it('renders null on /settings/account (suppression check)', () => {
    setCounts({ pending: 2 });
    renderAt('/settings/account');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders null on unknown paths like /cdn-cgi/foo (suppression check)', () => {
    setCounts({ rejected: 1 });
    renderAt('/cdn-cgi/foo');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('precedence: when rejected > 0 AND pending > 0, shows rejected (more urgent)', () => {
    setCounts({ pending: 5, rejected: 1 });
    renderAt('/today/run-1/log');
    // Rejected → role=button, not role=status.
    expect(screen.queryByRole('status')).toBeNull();
    const banner = screen.getByRole('button');
    expect(banner).toHaveTextContent(/1 sets rejected/);
  });

  it('non-rejected banner has role=status + aria-live=polite', () => {
    setCounts({ pending: 1 });
    renderAt('/today/run-1/log');
    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('mounts inside AppShell on allowed routes', async () => {
    setCounts({ pending: 2 });
    render(
      <MemoryRouter initialEntries={['/today/run-1/log']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<div>page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // findByRole lets Topbar's async sync-status fetch settle before assertion,
    // avoiding an act() warning. The banner is rendered immediately.
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/2 sets queued/);
  });
});
