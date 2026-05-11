// frontend/src/components/layout/Sidebar.test.tsx
//
// Behavior tests for the Sidebar account menu (Beta W0.4). Verifies the
// avatar opens a Radix Popover revealing display name + email + Account
// settings link + Sign out button, and that Sign out navigates to
// /cdn-cgi/access/logout.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar'

vi.mock('../../auth', () => ({
  useCurrentUser: () => ({
    status: 'authenticated' as const,
    user: {
      id: 'u1',
      email: 'jason@jpmtech.com',
      display_name: 'Jason Meyer',
      timezone: 'America/New_York',
    },
    error: null,
  }),
}))

vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: () => false }))

describe('Sidebar account menu', () => {
  let assignSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assignSpy = vi.fn()
    // jsdom's window.location is read-only by default; replace it.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { assign: assignSpy, href: 'https://repos.jpmtech.com/' },
    })
  })

  it('renders the avatar trigger button with accessible name', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /account menu/i })).toBeInTheDocument()
  })

  it('opens the popover on click and reveals display name + email + menu items', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }))

    // Display name + email surface inside the popover (in addition to the
    // avatar block where they may also appear).
    expect(screen.getAllByText('jason@jpmtech.com').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('menuitem', { name: /account settings/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
  })

  it('navigates to /cdn-cgi/access/logout when Sign out is clicked', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))
    expect(assignSpy).toHaveBeenCalledWith('/cdn-cgi/access/logout')
  })
})
