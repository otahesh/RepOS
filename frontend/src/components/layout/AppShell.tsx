import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { useIsMobile } from '../../lib/useIsMobile'
import { LogBufferRecovery } from '../programs/LogBufferRecovery'
import { SessionExpiredBanner } from '../auth/SessionExpiredBanner'
import { ToastHost } from '../common/ToastHost'
import { logBuffer } from '../../lib/logBuffer'
import { useCurrentUser } from '../../auth'
import { OnboardingOverlay } from '../onboarding/OnboardingOverlay'
import { ParQGate } from '../onboarding/ParQGate'
import { getParQStatus } from '../../lib/api/parQ'

// W2 (panel C-MOUNT) — derived state machine that mounts ONE of the two
// AppShell overlays (or neither) as a sibling of <Outlet>. Onboarding always
// precedes PAR-Q; never both at once.
//   1. user data still loading → render nothing.
//   2. !onboarding_completed_at → OnboardingOverlay only.
//   3. else PAR-Q needs_prompt  → ParQGate only.
//   4. else                     → neither.
// Each overlay's onComplete advances the local gate state without a full
// /api/me re-bootstrap.
function useOnboardingGate(): React.ReactNode {
  const { user } = useCurrentUser()
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  const [parQNeedsPrompt, setParQNeedsPrompt] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user) return
    setOnboardingDone(!!user.onboarding_completed_at)
  }, [user])

  const refreshParQ = useCallback(() => {
    getParQStatus()
      .then((s) => setParQNeedsPrompt(s.needs_prompt))
      .catch(() => setParQNeedsPrompt(false))
  }, [])

  useEffect(() => {
    // PAR-Q follows onboarding — only check it once onboarding is complete.
    if (onboardingDone) refreshParQ()
  }, [onboardingDone, refreshParQ])

  const reloadOnboarding = useCallback(() => { setOnboardingDone(true) }, [])
  const reloadParQ = useCallback(() => { setParQNeedsPrompt(false); refreshParQ() }, [refreshParQ])

  if (!user) return null
  if (onboardingDone === false) return <OnboardingOverlay onComplete={reloadOnboarding} />
  if (onboardingDone && parQNeedsPrompt) return <ParQGate onComplete={reloadParQ} />
  return null
}

export default function AppShell() {
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const onboardingOverlay = useOnboardingGate()

  // Wire offline-queue flush at the app shell level. Without this nothing in
  // production code drains the IDB queue on offline→online or retries stalled
  // rows — the queue would sit until the user enqueues a fresh set.
  //   • Initial flush on mount (handles page reload with rows already queued).
  //   • onReconnect listens for the window 'online' event.
  //   • Periodic 2s tick retries eligible rows (those past next_attempt_at)
  //     so transient failures recover without user intervention.
  useEffect(() => {
    // .catch(noop) swallows boot-time failures where IDB is unavailable
    // (jsdom test envs without fake-indexeddb/auto; private-mode browsers).
    // logBuffer.flush() itself doesn't retry inside one tick — the next tick
    // or 'online' event drives the recovery, so swallowing here is safe.
    const safeFlush = (): void => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        logBuffer.flush().catch(() => undefined)
      }
    }
    safeFlush()
    const off = logBuffer.onReconnect()
    const tick = window.setInterval(safeFlush, 2000)
    return () => {
      off()
      window.clearInterval(tick)
    }
  }, [])

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
        <LogBufferRecovery />
        <SessionExpiredBanner />
        <main style={{
          overflow: 'auto',
          minHeight: 0,
        }}>
          {/* keyed by pathname so the boundary resets on navigation */}
          <RouteErrorBoundary key={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
        <ToastHost />
        {onboardingOverlay}

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
        <LogBufferRecovery />
        <SessionExpiredBanner />
        <main style={{
          overflow: 'auto',
          minHeight: 0,
        }}>
          <RouteErrorBoundary key={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
        <ToastHost />
      </div>
      {onboardingOverlay}
    </div>
  )
}
