// W3.4 Task 22 — Reachability test for /settings/injuries.
//
// App.tsx wraps its own BrowserRouter internally, so we can't nest a
// MemoryRouter around <App/> (React Router throws "You cannot render a
// <Router> inside another <Router>"). Instead, drive the BrowserRouter via
// window.history.pushState before mounting — the existing setup.ts already
// gives jsdom a non-opaque origin (https://repos.jpmtech.com/), so the
// History API is usable.
//
// We mock `auth` and `equipment` the same way navigation.smoke.test.tsx
// does so AuthGate doesn't block render and the EquipmentWizard doesn't
// pop. We additionally mock `userInjuries` so InjuryChipsEditor's mount
// useEffect doesn't fire a real fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../src/auth', () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    AuthProvider: passthrough,
    AuthGate: passthrough,
    apiFetch: vi.fn(),
    useCurrentUser: () => ({
      status: 'authenticated' as const,
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        display_name: 'Test User',
        timezone: 'UTC',
      },
      error: null,
    }),
  };
});

vi.mock('../../src/lib/api/equipment', () => ({
  getEquipmentProfile: vi.fn().mockResolvedValue({ _v: 1, equipment: ['barbell'] }),
  isProfileEmpty: () => false,
  applyPreset: vi.fn(),
  putEquipmentProfile: vi.fn(),
}));

vi.mock('../../src/lib/api/userInjuries', () => ({
  listInjuries: vi.fn().mockResolvedValue([]),
  upsertInjury: vi.fn(),
  patchInjury: vi.fn(),
  deleteInjury: vi.fn(),
}));

describe('reachability: /settings/injuries', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/settings/injuries');
  });

  it('renders the page at /settings/injuries', async () => {
    const { default: App } = await import('../../src/App');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: /injuries/i }),
    ).toBeInTheDocument();
  });
});
