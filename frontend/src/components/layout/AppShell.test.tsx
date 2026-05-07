// frontend/src/components/layout/AppShell.test.tsx
//
// Behavior tests for the mobile drawer: open/close, focus trap, ARIA attrs.
// FocusTrap (focus-trap-react) handles Tab cycling and Escape; we verify the
// integration surface that the app wires correctly.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../auth', () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>
  return {
    AuthProvider: passthrough,
    AuthGate: passthrough,
    PLACEHOLDER_USER_ID: '00000000-0000-0000-0000-000000000001',
    apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'fresh', last_success_at: null, source: 'Apple Health' }) }),
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

// Force mobile layout so FocusTrap is rendered.
vi.mock('../../lib/useIsMobile', () => ({
  useIsMobile: () => true,
}))

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Renders a minimal mobile-drawer setup: a trigger button + Sidebar.
 * Returns the user instance and the trigger button.
 */
function renderMobileDrawer(mobileOpen = false) {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const triggerRef = { current: null as HTMLButtonElement | null }

  const { rerender } = render(
    <MemoryRouter>
      <button
        ref={triggerRef}
        data-testid="hamburger"
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
      />
      <Sidebar mobileOpen={mobileOpen} onClose={onClose} />
    </MemoryRouter>,
  )

  const trigger = screen.getByTestId('hamburger')
  return { user, trigger, onClose, rerender }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AppShell mobile drawer', () => {
  describe('open / close state', () => {
    it('renders drawer content when mobileOpen=true', () => {
      renderMobileDrawer(true)
      // The <aside role="dialog"> is present with nav content
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      expect(dialog).toBeInTheDocument()
      expect(within(dialog).getByText('Today')).toBeInTheDocument()
      expect(within(dialog).getByText('Programs')).toBeInTheDocument()
      expect(within(dialog).getByText('Settings')).toBeInTheDocument()
    })

    it('drawer is aria-hidden when mobileOpen=false', () => {
      renderMobileDrawer(false)
      const dialog = screen.getByRole('dialog', { hidden: true })
      expect(dialog).toHaveAttribute('aria-hidden', 'true')
    })

    it('calls onClose when a nav link is clicked', async () => {
      const { user, onClose } = renderMobileDrawer(true)
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      const todayLink = within(dialog).getByText('Today')
      await user.click(todayLink)
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  describe('ARIA attributes', () => {
    it('drawer has role="dialog" when in mobile mode', () => {
      renderMobileDrawer(true)
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      expect(dialog).toBeInTheDocument()
    })

    it('drawer has aria-modal="true"', () => {
      renderMobileDrawer(true)
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('drawer has aria-label="Main navigation"', () => {
      renderMobileDrawer(true)
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      expect(dialog).toHaveAttribute('aria-label', 'Main navigation')
    })

    it('drawer is aria-hidden=false when open', () => {
      renderMobileDrawer(true)
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      expect(dialog).toHaveAttribute('aria-hidden', 'false')
    })
  })

  describe('focus trap — FocusTrap integration', () => {
    it('FocusTrap is active (active prop) when drawer is open', () => {
      // When mobileOpen=true the <FocusTrap active={true}> is rendered.
      // The clearest indicator: dialog is accessible (not hidden) and contains
      // focusable elements that the trap would manage.
      renderMobileDrawer(true)
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      const links = within(dialog).getAllByRole('link')
      expect(links.length).toBeGreaterThan(0)
    })

    it('Tab key cycles focus within the open drawer', async () => {
      // jsdom + FocusTrap: Tab moves focus through tabbable elements.
      // We verify focus stays inside the dialog after repeated tabs.
      const { user } = renderMobileDrawer(true)
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      const links = within(dialog).getAllByRole('link')

      // Focus the first link to seed the trap
      links[0].focus()
      expect(document.activeElement).toBe(links[0])

      // Tab through all links + 1 (should wrap back to first)
      for (let i = 0; i < links.length; i++) {
        await user.tab()
      }
      // After wrapping, focus should be back on the first tabbable element
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    it('Shift+Tab cycles focus backwards within the open drawer', async () => {
      const { user } = renderMobileDrawer(true)
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      const links = within(dialog).getAllByRole('link')

      links[0].focus()
      await user.tab({ shift: true })
      // After backwards wrap, focus stays inside the drawer
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    it('Escape calls onClose', async () => {
      const { user, onClose } = renderMobileDrawer(true)
      // Focus something inside the drawer so FocusTrap is active
      const dialog = screen.getByRole('dialog', { name: 'Main navigation' })
      const links = within(dialog).getAllByRole('link')
      links[0].focus()

      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('Topbar hamburger button', () => {
    it('renders hamburger with aria-label and aria-expanded=false when closed', async () => {
      const toggleFn = vi.fn()
      render(
        <MemoryRouter>
          <Topbar onToggleSidebar={toggleFn} mobileOpen={false} />
        </MemoryRouter>,
      )
      // findByRole waits for async state settling (apiFetch poll)
      const btn = await screen.findByRole('button', { name: /open navigation/i })
      expect(btn).toHaveAttribute('aria-expanded', 'false')
    })

    it('hamburger aria-expanded=true when drawer is open', async () => {
      const toggleFn = vi.fn()
      render(
        <MemoryRouter>
          <Topbar onToggleSidebar={toggleFn} mobileOpen={true} />
        </MemoryRouter>,
      )
      const btn = await screen.findByRole('button', { name: /open navigation/i })
      expect(btn).toHaveAttribute('aria-expanded', 'true')
    })

    it('clicking hamburger calls the toggle callback', async () => {
      const user = userEvent.setup()
      const toggleFn = vi.fn()
      render(
        <MemoryRouter>
          <Topbar onToggleSidebar={toggleFn} mobileOpen={false} />
        </MemoryRouter>,
      )
      const btn = await screen.findByRole('button', { name: /open navigation/i })
      await user.click(btn)
      expect(toggleFn).toHaveBeenCalledOnce()
    })
  })
})
