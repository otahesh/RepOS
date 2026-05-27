// frontend/src/components/maintenance/MaintenanceBanner.tsx
//
// W5 — sticky-top banner that polls /api/maintenance/status. Renders when
// active=true; hides + force-reloads when active flips false.
//
// [ABS-3] Banner copy (verb-first, no "briefly," no "automatically when
// service returns" hedge): "RepOS is down for a database restore.
// ~60 seconds. Your last set is queued locally."
//
// Failed-restore branch: surfaces error_message + "Roll back" button when
// recovery_available=true.
//
// C-MOBILE-MAINTENANCE — don't blow the React tree mid-set. The idbQueue may
// have rows in 'syncing' state; force-reloading would lose them. Inspect
// idbQueue.peekSyncing() + the current pathname; on /today/:runId/log OR with
// syncing rows present, suppress the reload and show a soft Reload CTA instead.
//
// Mounted globally from AppShell so every route shows it.
import { useEffect, useRef, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import {
  getMaintenanceStatus,
  restorePreSnapshot,
  type MaintenanceStatus,
} from '../../lib/api/backups';
import { idbQueue } from '../../lib/idbQueue';

const DEFAULT_POLL_MS = 5_000;

export function MaintenanceBanner({
  pollIntervalMs = DEFAULT_POLL_MS,
}: {
  pollIntervalMs?: number;
}): JSX.Element | null {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const wasActive = useRef(false);
  const [showReloadCta, setShowReloadCta] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const s = await getMaintenanceStatus();
        if (cancelled) return;
        if (wasActive.current && !s.active) {
          // Flipped active → inactive. Decide whether it's safe to reload.
          const isOnActiveLogger = /^\/today\/[^/]+\/log\b/.test(window.location.pathname);
          let queueBusy = false;
          try {
            // peekPending() rows survive a reload (IndexedDB persists); it's
            // the in-flight syncing rows that would be lost.
            const syncing = await idbQueue.peekSyncing();
            queueBusy = (syncing?.length ?? 0) > 0;
          } catch {
            // idbQueue unavailable (private mode / jsdom) — assume safe.
          }

          if (isOnActiveLogger || queueBusy) {
            setShowReloadCta(true);
            wasActive.current = false;
            setStatus(s);
            return;
          }

          window.location.reload();
          return;
        }
        wasActive.current = s.active;
        setStatus(s);
      } catch {
        // Network error during a restore is expected (the API is 503ing).
        // Stay in current state; the next poll resolves.
      }
    };

    void poll();
    timer = setInterval(() => void poll(), pollIntervalMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [pollIntervalMs]);

  const bannerStyle = (background: string): React.CSSProperties => ({
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background,
    color: '#000',
    padding: '12px 16px',
    fontFamily: FONTS.ui,
    fontSize: 14,
    fontWeight: 600,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  });

  const ctaButtonStyle: React.CSSProperties = {
    background: '#000',
    color: '#fff',
    border: 0,
    padding: '6px 12px',
    borderRadius: 4,
    cursor: 'pointer',
  };

  // CTA branch — render even when status.active is false.
  if (showReloadCta) {
    return (
      <div role="status" aria-live="polite" style={bannerStyle(TOKENS.accent)}>
        <span>Restore complete — reload to continue.</span>
        <button style={ctaButtonStyle} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  if (!status?.active) return null;

  const failed = status.restore?.status === 'failed';

  return (
    <div role="status" aria-live="polite" style={bannerStyle(failed ? TOKENS.danger : TOKENS.accent)}>
      {failed ? (
        <>
          <span>Restore failed: {status.restore?.error_message ?? 'unknown error'}.</span>
          {status.recovery_available && (
            <button style={ctaButtonStyle} onClick={() => void restorePreSnapshot()}>
              Roll back to pre-restore snapshot
            </button>
          )}
        </>
      ) : (
        <span>RepOS is down for a database restore. ~60 seconds. Your last set is queued locally.</span>
      )}
    </div>
  );
}
