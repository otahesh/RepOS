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

  const closeDrawer = useCallback(() => setMobileOpen(false), [])
  const toggleDrawer = useCallback(() => setMobileOpen(o => !o), [])

  // Close drawer on route change.
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // If we cross the breakpoint into desktop while drawer is open, drop the open state.
  useEffect(() => {
    if (!isMobile && mobileOpen) setMobileOpen(false)
  }, [isMobile, mobileOpen])

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

        <Sidebar mobileOpen={mobileOpen} onClose={closeDrawer} />
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
