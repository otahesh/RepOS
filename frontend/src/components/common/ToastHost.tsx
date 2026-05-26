import { useEffect, useState } from 'react'
import { Toast, type ToastSeverity } from './Toast'

export interface ToastSpec {
  severity: ToastSeverity
  body: string
  durationMs?: number
  actionLabel?: string
  onAction?: () => void
}

interface ToastEntry extends ToastSpec {
  id: string
}

// Module-level listener set so pushToast() works from anywhere — non-React
// callers (services, lib code) included. ToastHost subscribes on mount and
// unsubscribes on unmount, so the set is the only piece that persists.
type Listener = (entry: ToastEntry) => void
const listeners = new Set<Listener>()

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Enqueue a toast from anywhere in the app.
 *
 * Broadcasts to every mounted ToastHost. Returns the generated id so callers
 * that want to programmatically dismiss can do so (future use).
 */
export function pushToast(spec: ToastSpec): string {
  const id = nextId()
  const entry: ToastEntry = { ...spec, id }
  listeners.forEach((fn) => fn(entry))
  return id
}

/**
 * Renders a bottom-right column of toasts. Mount once inside AppShell as a
 * sibling of <Outlet> so route changes don't unmount the host (which would
 * lose any in-flight toasts).
 */
export function ToastHost(): JSX.Element {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  useEffect(() => {
    const onPush: Listener = (entry) => setToasts((prev) => [...prev, entry])
    listeners.add(onPush)
    return () => {
      listeners.delete(onPush)
    }
  }, [])

  const handleDismiss = (id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <Toast
            id={t.id}
            severity={t.severity}
            body={t.body}
            durationMs={t.durationMs}
            actionLabel={t.actionLabel}
            onAction={t.onAction}
            onDismiss={handleDismiss}
          />
        </div>
      ))}
    </div>
  )
}
