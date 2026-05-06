import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { useIsMobile } from '../../lib/useIsMobile'

export default function AppShell() {
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const drawerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  const closeDrawer = useCallback(() => setMobileOpen(false), [])
  const toggleDrawer = useCallback(() => setMobileOpen(o => !o), [])

  // Close drawer on route change.
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // ESC closes the drawer while open.
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mobileOpen])

  // If we cross the breakpoint into desktop while drawer is open, drop the open state.
  useEffect(() => {
    if (!isMobile && mobileOpen) setMobileOpen(false)
  }, [isMobile, mobileOpen])

  // Focus management: on open, move focus into the drawer (first focusable);
  // on close, return focus to the hamburger trigger so keyboard users land
  // back where they started instead of on <body>.
  useEffect(() => {
    if (mobileOpen) {
      const root = drawerRef.current
      if (root) {
        const first = root.querySelector<HTMLElement>(
          'a, button, [tabindex]:not([tabindex="-1"])',
        )
        first?.focus()
      }
      wasOpenRef.current = true
    } else if (wasOpenRef.current) {
      triggerRef.current?.focus()
      wasOpenRef.current = false
    }
  }, [mobileOpen])

  if (isMobile) {
    return (
      <div style={{
        position: 'relative',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--color-bg)',
        display: 'grid',
        gridTemplateRows: '72px 1fr',
        minHeight: 0,
      }}>
        <Topbar onToggleSidebar={toggleDrawer} mobileOpen={mobileOpen} triggerRef={triggerRef} />
        <main style={{
          overflow: 'auto',
          minHeight: 0,
        }}>
          {/* keyed by pathname so the boundary resets on navigation */}
          <RouteErrorBoundary key={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>

        {/* Backdrop */}
        <div
          onClick={closeDrawer}
          aria-hidden={!mobileOpen}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5,8,12,0.62)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            opacity: mobileOpen ? 1 : 0,
            pointerEvents: mobileOpen ? 'auto' : 'none',
            transition: 'opacity 180ms ease-out',
            zIndex: 40,
          }}
        />

        <Sidebar mobileOpen={mobileOpen} onClose={closeDrawer} drawerRef={drawerRef} />
      </div>
    )
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '232px 1fr',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--color-bg)',
    }}>
      <Sidebar />
      <div style={{
        display: 'grid',
        gridTemplateRows: '72px 1fr',
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <Topbar />
        <main style={{
          overflow: 'auto',
          minHeight: 0,
        }}>
          <RouteErrorBoundary key={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  )
}
