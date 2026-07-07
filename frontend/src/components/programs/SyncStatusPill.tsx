import { Link, useLocation } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { useNetworkState } from '../../hooks/useNetworkState';
import { useIdbQueueCounts } from '../../hooks/useIdbQueueCounts';

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? `${singular}s`);
}

// =============================================================================
// SyncStatusPill
// Compact glass pill pinned bottom-right that surfaces offline-queue state on
// workout-adjacent routes. Replaces the W1.3.5 LogBufferRecovery banner, which
// stretched full-width under the Topbar and permanently covered workout UI
// whenever a row was queued. Copy strings are contractual — the __offline__
// Playwright specs (O2/O5/O7 and the rejected-link name in O1/O8) assert them
// verbatim, so changing wording here means updating those specs in the same PR.
// Suppresses itself on Settings, login, and any non-workout page.
// =============================================================================

/**
 * Route gate: render only on these paths (prefix-match for the wildcarded ones).
 * Root '/' matches exactly so we don't leak the pill onto '/login' etc.
 */
function isAllowedRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname.startsWith('/today/') || pathname === '/today') return true;
  if (pathname.startsWith('/programs/') || pathname === '/programs') return true;
  return false;
}

interface PillVariant {
  copy: string;
  /** Status color — drives the dot and the border tint, not the fill. */
  color: string;
  clickable: boolean;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function pickVariant(
  online: boolean,
  pending: number,
  syncing: number,
  rejected: number,
  stalled: number,
  oldestPendingCreatedAt: number | null,
): PillVariant | null {
  // Staleness pill (W1.3.6 O7): any pending row ≥7 days old takes precedence
  // over the normal pending pill because it implies user attention is needed
  // — the row has been stuck long enough that auto-recovery is suspect.
  if (pending > 0 && oldestPendingCreatedAt !== null) {
    const ageMs = Date.now() - oldestPendingCreatedAt;
    if (ageMs >= SEVEN_DAYS_MS) {
      const days = Math.floor(ageMs / ONE_DAY_MS);
      const setWord = pending === 1 ? 'set' : 'sets';
      return {
        copy: `${pending} ${setWord} queued · ${days} days old · flush or clear?`,
        color: TOKENS.warn,
        clickable: true,
      };
    }
  }
  // Precedence: offline-pending > stalled > syncing > rejected > online-pending.
  // Stalled sits right after offline because retrying is pointless without a
  // connection, but once online a capped row never moves again without the
  // user's "Retry sync" — it outranks everything the flusher can still fix.
  if (pending > 0 && !online) {
    return {
      copy: `OFFLINE · ${pending} ${pluralize(pending, 'set')} queued`,
      color: TOKENS.warn,
      clickable: false,
    };
  }
  if (stalled > 0) {
    return {
      copy: `⚠ ${stalled} ${pluralize(stalled, 'set')} stuck — review`,
      color: TOKENS.warn,
      clickable: true,
    };
  }
  if (syncing > 0) {
    return {
      copy: `${syncing} ${pluralize(syncing, 'set')} syncing…`,
      color: TOKENS.accent,
      clickable: false,
    };
  }
  if (rejected > 0) {
    return {
      copy: `⚠ ${rejected} ${pluralize(rejected, 'set')} rejected — review`,
      color: TOKENS.danger,
      clickable: true,
    };
  }
  if (pending > 0 && online) {
    return {
      copy: `${pending} ${pluralize(pending, 'set')} queued for sync`,
      color: TOKENS.accent,
      clickable: false,
    };
  }
  return null;
}

// Route gate runs OUTSIDE the rendered component so the IDB-count poll only
// fires on pages where the pill can render. Settings pages don't need the
// 1Hz poll; suppressing it there cuts the per-page background work.
function InnerPill(): JSX.Element | null {
  const { online } = useNetworkState();
  const { pending, syncing, rejected, stalled, oldestPendingCreatedAt } = useIdbQueueCounts();

  if (pending === 0 && syncing === 0 && rejected === 0) return null;

  const variant = pickVariant(online, pending, syncing, rejected, stalled, oldestPendingCreatedAt);
  if (variant === null) return null;

  const base = {
    position: 'fixed' as const,
    // Clear of the home-indicator on notched phones; bottom-right so it never
    // covers the set rows or the Log buttons the way the old banner did.
    // ToastHost shares this corner at zIndex 9999 — a transient toast covering
    // the pill for a few seconds is deliberate precedence (tokens.ts: toasts
    // render above every modal surface by design).
    right: 16,
    bottom: 'calc(16px + env(safe-area-inset-bottom))',
    zIndex: TOKENS.zModal.zPill,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    maxWidth: 'calc(100vw - 32px)',
    padding: '10px 14px',
    borderRadius: 999,
    background: 'rgba(16,20,28,0.88)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${variant.color}59`, // status tint at ~35% alpha
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: TOKENS.text,
  };

  const dot = (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: variant.color,
        flexShrink: 0,
      }}
    />
  );

  if (variant.clickable) {
    // Stalled/rejected/staleness pills navigate to /settings/storage; a real
    // <Link> gives screen readers the "link" role announcement and native
    // keyboard activation. minHeight keeps the tap target at 44px.
    return (
      <Link
        to="/settings/storage"
        aria-live="polite"
        style={{
          ...base,
          minHeight: 44,
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        {dot}
        {variant.copy}
      </Link>
    );
  }

  return (
    <div role="status" aria-live="polite" style={base}>
      {dot}
      {variant.copy}
    </div>
  );
}

export function SyncStatusPill(): JSX.Element | null {
  const location = useLocation();
  if (!isAllowedRoute(location.pathname)) return null;
  return <InnerPill />;
}
