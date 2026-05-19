import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { SessionExpiredBanner, CF_ACCESS_LOGIN_URL, LOCAL_STORAGE_KEY } from './SessionExpiredBanner';
import AppShell from '../layout/AppShell';

// AppShell-integration tests mount Topbar + Sidebar through the shell, both of
// which pull in the real `../../auth` module. Stub it so the test only proves
// SessionExpiredBanner is wired into the shell.
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

vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: () => true }));

// useIdbQueueCounts is mocked so the banner gets a deterministic pending count
// without touching IDB. The banner reads pending+syncing+rejected to decide
// whether there is unflushed work; we drive each test by mutating mockCounts.
const mockCounts = {
  pending: 0,
  syncing: 0,
  rejected: 0,
  oldestPendingCreatedAt: null as number | null,
};
vi.mock('../../hooks/useIdbQueueCounts', () => ({
  useIdbQueueCounts: () => mockCounts,
}));

function setCounts(partial: Partial<typeof mockCounts>) {
  mockCounts.pending = partial.pending ?? 0;
  mockCounts.syncing = partial.syncing ?? 0;
  mockCounts.rejected = partial.rejected ?? 0;
  mockCounts.oldestPendingCreatedAt = partial.oldestPendingCreatedAt ?? null;
}

function fireExpired() {
  act(() => {
    window.dispatchEvent(new CustomEvent('cf-access-expired'));
  });
}

describe('<SessionExpiredBanner>', () => {
  let assignSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    setCounts({});
    localStorage.clear();
    assignSpy = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        assign: assignSpy,
        pathname: '/today/run-1/log',
        search: '',
        href: 'https://repos.jpmtech.com/today/run-1/log',
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('renders nothing before any cf-access-expired event', () => {
    render(
      <MemoryRouter>
        <SessionExpiredBanner />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('on cf-access-expired stashes a synchronous localStorage marker AND redirects to CF Access login with redirect_url back to /today/:id', () => {
    setCounts({ pending: 3 });
    render(
      <MemoryRouter>
        <SessionExpiredBanner />
      </MemoryRouter>,
    );

    fireExpired();

    // The localStorage marker is the synchronous "we have unflushed work"
    // signal that's available before IDB opens on next page load.
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const marker = JSON.parse(raw!);
    expect(marker.count).toBe(3);
    expect(typeof marker.at).toBe('number');

    expect(assignSpy).toHaveBeenCalledTimes(1);
    const url = assignSpy.mock.calls[0][0] as string;
    expect(url.startsWith(CF_ACCESS_LOGIN_URL)).toBe(true);
    expect(url).toContain('redirect_url=');
    const redirectUrl = decodeURIComponent(url.split('redirect_url=')[1]);
    expect(redirectUrl).toBe('/today/run-1/log');
  });

  it('preserves search params in the redirect_url', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        assign: assignSpy,
        pathname: '/today/run-1/log',
        search: '?focus=set-2',
        href: 'https://repos.jpmtech.com/today/run-1/log?focus=set-2',
      },
    });
    setCounts({ pending: 1 });
    render(
      <MemoryRouter>
        <SessionExpiredBanner />
      </MemoryRouter>,
    );

    fireExpired();

    const url = assignSpy.mock.calls[0][0] as string;
    const redirectUrl = decodeURIComponent(url.split('redirect_url=')[1]);
    expect(redirectUrl).toBe('/today/run-1/log?focus=set-2');
  });

  it('does not duplicate the redirect if cf-access-expired fires twice', () => {
    setCounts({ pending: 1 });
    render(
      <MemoryRouter>
        <SessionExpiredBanner />
      </MemoryRouter>,
    );

    fireExpired();
    fireExpired();

    expect(assignSpy).toHaveBeenCalledTimes(1);
  });

  // ── W1.3.7.2 — Safari private mode: localStorage.setItem throws ──────────
  it('renders blocking modal (does NOT auto-redirect) when localStorage.setItem throws', () => {
    setCounts({ pending: 2 });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(
      <MemoryRouter>
        <SessionExpiredBanner />
      </MemoryRouter>,
    );

    fireExpired();

    expect(assignSpy).not.toHaveBeenCalled();
    const modal = screen.getByRole('alertdialog');
    expect(modal).toHaveTextContent(/Your session expired/i);
    expect(modal).toHaveTextContent(/save 2 unlogged sets/i);
  });

  it('Safari private modal pluralises correctly for a single set', () => {
    setCounts({ pending: 1 });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(
      <MemoryRouter>
        <SessionExpiredBanner />
      </MemoryRouter>,
    );

    fireExpired();

    expect(screen.getByRole('alertdialog')).toHaveTextContent(/save 1 unlogged set\b/i);
  });

  it('Safari modal Sign-in CTA redirects to CF Access login', async () => {
    setCounts({ pending: 2 });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SessionExpiredBanner />
      </MemoryRouter>,
    );

    fireExpired();
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(assignSpy).toHaveBeenCalledTimes(1);
    const url = assignSpy.mock.calls[0][0] as string;
    expect(url.startsWith(CF_ACCESS_LOGIN_URL)).toBe(true);
    expect(url).toContain('redirect_url=');
  });

  it('counts pending + syncing + rejected together in the modal copy (unflushed = anything not yet synced)', () => {
    setCounts({ pending: 1, syncing: 2, rejected: 1 });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(
      <MemoryRouter>
        <SessionExpiredBanner />
      </MemoryRouter>,
    );

    fireExpired();

    expect(screen.getByRole('alertdialog')).toHaveTextContent(/save 4 unlogged sets/i);
  });

  // ── W1.3.7.3 — wired into AppShell ────────────────────────────────────────
  it('is mounted inside AppShell — Safari-fallback modal surfaces on cf-access-expired event', async () => {
    setCounts({ pending: 2 });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(
      <MemoryRouter initialEntries={['/today/run-1/log']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<div>page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireExpired();

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/save 2 unlogged sets/i);
  });
});
