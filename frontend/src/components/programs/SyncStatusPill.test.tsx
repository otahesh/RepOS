import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { SyncStatusPill } from './SyncStatusPill';
import { TOKENS } from '../../tokens';
import AppShell from '../layout/AppShell';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockCounts: {
  pending: number;
  syncing: number;
  rejected: number;
  stalled: number;
  oldestPendingCreatedAt: number | null;
} = {
  pending: 0,
  syncing: 0,
  rejected: 0,
  stalled: 0,
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
// mock them so the integration assertion only checks pill mount-through.
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
              <SyncStatusPill />
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
  mockCounts.stalled = c.stalled ?? 0;
  mockCounts.oldestPendingCreatedAt =
    c.oldestPendingCreatedAt !== undefined ? c.oldestPendingCreatedAt : null;
}

function setOnline(v: boolean) {
  mockNetwork.online = v;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SyncStatusPill', () => {
  beforeEach(() => {
    setCounts({});
    setOnline(true);
  });

  it('renders null when all counts are zero (regardless of route)', () => {
    renderAt('/today/run-1/log');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders OFFLINE pill when offline + pending > 0 on /today/run-1/log', () => {
    setCounts({ pending: 3 });
    setOnline(false);
    renderAt('/today/run-1/log');
    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent(/OFFLINE/);
    expect(pill).toHaveTextContent(/3 sets queued/);
  });

  it('OFFLINE pill with 1 pending uses singular "set"', () => {
    setCounts({ pending: 1 });
    setOnline(false);
    renderAt('/today/run-1/log');
    expect(screen.getByRole('status')).toHaveTextContent(/OFFLINE · 1 set queued/);
  });

  it('is a compact fixed pill anchored bottom-right at zPill (below zSheet)', () => {
    // The old full-width banner covered workout UI under the topbar; the pill
    // pins bottom-right and must sit BELOW bottom sheets in the z-stack.
    setCounts({ pending: 1 });
    renderAt('/today/run-1/log');
    const pill = screen.getByRole('status');
    expect(pill.style.position).toBe('fixed');
    expect(pill.style.right).not.toBe('');
    expect(pill.style.bottom).not.toBe('');
    expect(pill.style.left).toBe('');
    expect(Number(pill.style.zIndex)).toBe(TOKENS.zModal.zPill);
    expect(TOKENS.zModal.zPill).toBeLessThan(TOKENS.zModal.zSheet);
  });

  it('renders syncing pill when syncing > 0 on /programs', () => {
    setCounts({ syncing: 2 });
    renderAt('/programs');
    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent(/2 sets syncing/);
  });

  it('syncing pill with 1 syncing uses singular "set"', () => {
    setCounts({ syncing: 1 });
    renderAt('/programs');
    expect(screen.getByRole('status')).toHaveTextContent(/1 set syncing/);
  });

  it('renders rejected pill with proper copy when rejected > 0 on /', () => {
    setCounts({ rejected: 4 });
    renderAt('/');
    const pill = screen.getByRole('link');
    expect(pill).toHaveTextContent(/4 sets rejected/);
    expect(pill).toHaveTextContent(/review/i);
  });

  it('rejected pill with 1 rejected uses singular "set"', () => {
    setCounts({ rejected: 1 });
    renderAt('/');
    expect(screen.getByRole('link')).toHaveTextContent(/1 set rejected/);
  });

  it('rejected pill click navigates to /settings/storage', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 1 });
    renderAt('/today/run-1/log');
    const pill = screen.getByRole('link');
    await user.click(pill);
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/storage');
  });

  it('rejected pill keyboard (Enter on a Link) navigates to /settings/storage', async () => {
    const user = userEvent.setup();
    setCounts({ rejected: 1 });
    renderAt('/today/run-1/log');
    const pill = screen.getByRole('link');
    pill.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/storage');
  });

  it('renders stalled pill (attempt-capped rows) as a link to /settings/storage', async () => {
    // The stuck-set bug: a row at the attempt cap is skipped by the flusher
    // forever, and the old banner showed it as an innocuous permanent
    // "1 set queued for sync" with no recovery affordance.
    const user = userEvent.setup();
    setCounts({ pending: 1, stalled: 1 });
    renderAt('/today/run-1/log');
    const pill = screen.getByRole('link');
    expect(pill).toHaveTextContent(/1 set stuck/);
    expect(pill).toHaveTextContent(/review/i);
    await user.click(pill);
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/storage');
  });

  it('stalled pill with 2 stalled uses plural "sets"', () => {
    setCounts({ pending: 2, stalled: 2 });
    renderAt('/today/run-1/log');
    expect(screen.getByRole('link')).toHaveTextContent(/2 sets stuck/);
  });

  it('precedence: offline wins over stalled (retry is pointless offline)', () => {
    setCounts({ pending: 2, stalled: 1 });
    setOnline(false);
    renderAt('/today/run-1/log');
    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent(/OFFLINE/);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('precedence: stalled wins over rejected and syncing', () => {
    setCounts({ pending: 1, stalled: 1, rejected: 2, syncing: 1 });
    renderAt('/today/run-1/log');
    expect(screen.getByRole('link')).toHaveTextContent(/1 set stuck/);
  });

  it('renders 7-day staleness pill with flush-or-clear copy (O7 contract)', () => {
    const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
    setCounts({ pending: 1, oldestPendingCreatedAt: Date.now() - EIGHT_DAYS_MS });
    renderAt('/today/run-1/log');
    const pill = screen.getByRole('link');
    expect(pill).toHaveTextContent(/1 set queued · 8 days old · flush or clear\?/);
  });

  it('renders null on /settings/account (suppression check)', () => {
    setCounts({ pending: 2 });
    renderAt('/settings/account');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders null on unknown paths like /cdn-cgi/foo (suppression check)', () => {
    setCounts({ rejected: 1 });
    renderAt('/cdn-cgi/foo');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('precedence: when rejected > 0 AND pending > 0, shows rejected (more urgent)', () => {
    setCounts({ pending: 5, rejected: 1 });
    renderAt('/today/run-1/log');
    // Rejected → rendered as a <Link> (role=link), not role=status.
    expect(screen.queryByRole('status')).toBeNull();
    const pill = screen.getByRole('link');
    expect(pill).toHaveTextContent(/1 set rejected/);
  });

  it('non-clickable pill has role=status + aria-live=polite', () => {
    setCounts({ pending: 1 });
    renderAt('/today/run-1/log');
    const pill = screen.getByRole('status');
    expect(pill).toHaveAttribute('aria-live', 'polite');
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
    // avoiding an act() warning. The pill is rendered immediately.
    const pill = await screen.findByRole('status');
    expect(pill).toHaveTextContent(/2 sets queued/);
  });
});
