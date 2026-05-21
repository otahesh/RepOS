import { Link, useLocation } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { useNetworkState } from '../../hooks/useNetworkState';
import { useIdbQueueCounts } from '../../hooks/useIdbQueueCounts';

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? `${singular}s`);
}

// =============================================================================
// LogBufferRecovery
// Fixed banner pinned under the AppShell Topbar that surfaces offline-queue
// state to the user on workout-adjacent routes. Suppresses itself on Settings,
// login, and any non-workout page so the user sees it where it matters.
// =============================================================================

/**
 * Route gate: render only on these paths (prefix-match for the wildcarded ones).
 * Root '/' matches exactly so we don't leak the banner onto '/login' etc.
 */
function isAllowedRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname.startsWith('/today/') || pathname === '/today') return true;
  if (pathname.startsWith('/programs/') || pathname === '/programs') return true;
  return false;
}

interface BannerVariant {
  copy: string;
  background: string;
  clickable: boolean;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function pickVariant(
  online: boolean,
  pending: number,
  syncing: number,
  rejected: number,
  oldestPendingCreatedAt: number | null,
): BannerVariant | null {
  // Staleness banner (W1.3.6 O7): any pending row ≥7 days old takes precedence
  // over the normal pending banner because it implies user attention is needed
  // — the row has been stuck long enough that auto-recovery is suspect.
  if (pending > 0 && oldestPendingCreatedAt !== null) {
    const ageMs = Date.now() - oldestPendingCreatedAt;
    if (ageMs >= SEVEN_DAYS_MS) {
      const days = Math.floor(ageMs / ONE_DAY_MS);
      const setWord = pending === 1 ? 'set' : 'sets';
      return {
        copy: `${pending} ${setWord} queued · ${days} days old · flush or clear?`,
        background: TOKENS.warn,
        clickable: true,
      };
    }
  }
  // Precedence: offline-pending > syncing > rejected > online-pending.
  if (pending > 0 && !online) {
    return {
      copy: `OFFLINE · ${pending} ${pluralize(pending, 'set')} queued`,
      background: TOKENS.warn,
      clickable: false,
    };
  }
  if (syncing > 0) {
    return {
      copy: `${syncing} ${pluralize(syncing, 'set')} syncing…`,
      background: TOKENS.accent,
      clickable: false,
    };
  }
  if (rejected > 0) {
    return {
      copy: `⚠ ${rejected} ${pluralize(rejected, 'set')} rejected — review`,
      background: TOKENS.danger,
      clickable: true,
    };
  }
  if (pending > 0 && online) {
    return {
      copy: `${pending} ${pluralize(pending, 'set')} queued for sync`,
      background: TOKENS.accent,
      clickable: false,
    };
  }
  return null;
}

// Route gate runs OUTSIDE the rendered component so the IDB-count poll only
// fires on pages where the banner can render. Settings pages don't need the
// 1Hz poll; suppressing it there cuts the per-page background work.
function InnerBanner(): JSX.Element | null {
  const { online } = useNetworkState();
  const { pending, syncing, rejected, oldestPendingCreatedAt } = useIdbQueueCounts();

  if (pending === 0 && syncing === 0 && rejected === 0) return null;

  const variant = pickVariant(online, pending, syncing, rejected, oldestPendingCreatedAt);
  if (variant === null) return null;

  const base = {
    position: 'fixed' as const,
    top: 'calc(72px + env(safe-area-inset-top))',
    left: 0,
    right: 0,
    zIndex: 1000,
    padding: '8px 16px',
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: '#FFFFFF',
    background: variant.background,
    textAlign: 'center' as const,
  };

  if (variant.clickable) {
    // Rejected/staleness banners navigate to /settings/storage; using a real
    // <Link> gives screen readers the "link" role announcement and lets the
    // browser handle keyboard activation (Enter on a Link is correct; Space
    // is the historical role=button behavior we previously had to bind
    // manually). The Link is rendered as a block so the full banner is the
    // hit target.
    return (
      <Link
        to="/settings/storage"
        aria-live="polite"
        style={{
          ...base,
          display: 'block',
          textDecoration: 'none',
          color: '#FFFFFF',
          cursor: 'pointer',
        }}
      >
        {variant.copy}
      </Link>
    );
  }

  return (
    <div role="status" aria-live="polite" style={base}>
      {variant.copy}
    </div>
  );
}

export function LogBufferRecovery(): JSX.Element | null {
  const location = useLocation();
  if (!isAllowedRoute(location.pathname)) return null;
  return <InnerBanner />;
}
