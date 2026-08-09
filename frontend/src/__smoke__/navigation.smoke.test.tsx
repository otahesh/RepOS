// frontend/src/__smoke__/navigation.smoke.test.tsx
//
// Runtime companion to scripts/check-page-reachability.mjs. The static lint
// is the primary detector of "components shipped but unreachable" and
// `to="#"` placeholders. This runtime smoke covers the orthogonal class of
// failure — App.tsx mounting at runtime — that a static check can't see
// (hook-order errors, render-time crashes, missing required providers).
//
// Note on `to="#"` at runtime: React Router 6 NavLink resolves a `to="#"`
// against the current pathname, so the rendered <a href="…"> looks fine
// even when the link is broken. The static lint is what catches that.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import { SETTINGS_SECTIONS } from '../components/settings/SettingsSidebar';

// W9 — mutable so a single mocked module can serve both the member and the
// admin case. `vi.mock` is hoisted above the imports, so the state it closes
// over has to be hoisted too.
const authState = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('../auth', () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    AuthProvider: passthrough,
    AuthGate: passthrough,
    // Must resolve, not just exist — real apiFetch always returns a Promise<Response>,
    // and mounted pages (e.g. DesktopDashboard, Topbar's sync pill, TodayCard on the
    // "/" route) chain `.then` straight off the call. A bare `vi.fn()` resolves to
    // `undefined`, so `.then` throws asynchronously after this test's own assertions
    // already ran — surfaced only as an "Unhandled Error" in the vitest run, not a
    // failed assertion. One shape doesn't fit every endpoint (e.g. TodayCard reads
    // `data.day.week_idx` for any state other than 'no_active_run'/'rest'), so this
    // switches on the requested path — add a case here if a newly-mounted page's
    // effect throws on the fallback sync-status shape.
    apiFetch: vi.fn().mockImplementation(async (path: string) => {
      const body = path.includes('/api/mesocycles/today')
        ? { state: 'no_active_run' }
        : { state: 'fresh', last_success_at: null, source: 'Apple Health' };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        headers: new Headers(),
      } as Response;
    }),
    useCurrentUser: () => ({
      status: 'authenticated' as const,
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        display_name: 'Test User',
        timezone: 'UTC',
        is_admin: authState.isAdmin,
      },
      error: null,
    }),
  };
});

beforeEach(() => {
  authState.isAdmin = false
})

/** Section labels currently rendered inside the sidebar's settings sub-nav. */
function renderedSectionLabels(sidebar: HTMLElement): string[] {
  return SETTINGS_SECTIONS.map((s) => s.label).filter(
    (label) => within(sidebar).queryAllByText(label).length > 0,
  )
}

vi.mock('../lib/api/equipment', () => ({
  getEquipmentProfile: vi.fn().mockResolvedValue({ _v: 1, equipment: ['barbell'] }),
  isProfileEmpty: () => false,
  applyPreset: vi.fn(),
  putEquipmentProfile: vi.fn(),
}));

describe('navigation smoke', () => {
  it('App mounts without throwing', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    expect(await screen.findByText('REPOS')).toBeInTheDocument();
  });

  it('Sidebar renders every NAV_ITEMS entry', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const sidebar = screen.getByRole('complementary');
    // Every top-level nav item declared in Sidebar.tsx must be visible.
    // Update this list when adding/removing items so the test is the contract.
    const expectedTopLevel = ['Today', 'Settings'];
    for (const name of expectedTopLevel) {
      expect(
        within(sidebar).getByText(name),
        `top-level nav "${name}" missing from Sidebar`,
      ).toBeInTheDocument();
    }
  });

  it('Sidebar sub-nav renders on /settings/* with all declared items', () => {
    render(
      <MemoryRouter initialEntries={['/settings/integrations']}>
        <Sidebar />
      </MemoryRouter>,
    );
    const sidebar = screen.getByRole('complementary');
    // Sub-nav now reads from SETTINGS_SECTIONS (W6 D7). All 8 entries
    // render (3 disabled = W4/W5/W7 slots; still visible as dimmed labels).
    const expectedSubNav = ['Account', 'Equipment', 'Integrations', 'Storage', 'Injuries'];
    for (const name of expectedSubNav) {
      expect(
        within(sidebar).getByText(name),
        `sub-nav "${name}" missing from Sidebar`,
      ).toBeInTheDocument();
    }
  });

  // W9 — `adminOnly` sections are filtered client-side. This is presentation
  // only; /api/admin/* enforces role='admin' server-side regardless.
  it('hides the admin-only Users entry from a member', () => {
    render(
      <MemoryRouter initialEntries={['/settings/account']}>
        <Sidebar />
      </MemoryRouter>,
    );
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).queryByText('Users')).toBeNull();
    expect(renderedSectionLabels(sidebar)).toHaveLength(9);
  });

  it('shows the Users entry to an admin', () => {
    authState.isAdmin = true;
    render(
      <MemoryRouter initialEntries={['/settings/account']}>
        <Sidebar />
      </MemoryRouter>,
    );
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).getByText('Users')).toBeInTheDocument();
    expect(renderedSectionLabels(sidebar)).toHaveLength(10);
    // G7 — reachable means clickable, not merely rendered. Asserting the href
    // is what makes this a reachability test rather than a label test.
    expect(within(sidebar).getByText('Users').closest('a')).toHaveAttribute(
      'href',
      '/settings/users',
    );
  });
});
