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

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from '../components/layout/Sidebar'

vi.mock('../auth', () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>
  return {
    AuthProvider: passthrough,
    AuthGate: passthrough,
    PLACEHOLDER_USER_ID: '00000000-0000-0000-0000-000000000001',
    apiFetch: vi.fn(),
    useCurrentUser: () => ({
      status: 'authenticated' as const,
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'test@example.com',
        display_name: 'Test User',
        timezone: 'UTC',
      },
      error: null,
    }),
  }
})

vi.mock('../lib/api/equipment', () => ({
  getEquipmentProfile: vi.fn().mockResolvedValue({ _v: 1, equipment: ['barbell'] }),
  isProfileEmpty: () => false,
  applyPreset: vi.fn(),
  putEquipmentProfile: vi.fn(),
}))

describe('navigation smoke', () => {
  it('App mounts without throwing', async () => {
    const { default: App } = await import('../App')
    render(<App />)
    expect(await screen.findByText('REPOS')).toBeInTheDocument()
  })

  it('Sidebar renders every NAV_ITEMS entry', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    const sidebar = screen.getByRole('complementary')
    // Every top-level nav item declared in Sidebar.tsx must be visible.
    // Update this list when adding/removing items so the test is the contract.
    const expectedTopLevel = ['Today', 'Settings']
    for (const name of expectedTopLevel) {
      expect(
        within(sidebar).getByText(name),
        `top-level nav "${name}" missing from Sidebar`,
      ).toBeInTheDocument()
    }
  })

  it('Sidebar sub-nav renders on /settings/* with all declared items', () => {
    render(
      <MemoryRouter initialEntries={['/settings/integrations']}>
        <Sidebar />
      </MemoryRouter>,
    )
    const sidebar = screen.getByRole('complementary')
    const expectedSubNav = ['Integrations', 'Units & equipment', 'Account']
    for (const name of expectedSubNav) {
      expect(
        within(sidebar).getByText(name),
        `sub-nav "${name}" missing from Sidebar`,
      ).toBeInTheDocument()
    }
  })
})
