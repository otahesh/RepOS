import type { KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { useNetworkState } from '../../hooks/useNetworkState';
import { useIdbQueueCounts } from '../../hooks/useIdbQueueCounts';

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

function pickVariant(
  online: boolean,
  pending: number,
  syncing: number,
  rejected: number,
): BannerVariant | null {
  // Precedence: offline-pending > syncing > rejected > online-pending.
  if (pending > 0 && !online) {
    return {
      copy: `OFFLINE · ${pending} sets queued`,
      background: TOKENS.warn,
      clickable: false,
    };
  }
  if (syncing > 0) {
    return {
      copy: `${syncing} sets syncing…`,
      background: TOKENS.accent,
      clickable: false,
    };
  }
  if (rejected > 0) {
    return {
      copy: `⚠ ${rejected} sets rejected — review`,
      background: TOKENS.danger,
      clickable: true,
    };
  }
  if (pending > 0 && online) {
    return {
      copy: `${pending} sets queued for sync`,
      background: TOKENS.accent,
      clickable: false,
    };
  }
  return null;
}

export function LogBufferRecovery(): JSX.Element | null {
  const { online } = useNetworkState();
  const { pending, syncing, rejected } = useIdbQueueCounts();
  const location = useLocation();
  const navigate = useNavigate();

  if (!isAllowedRoute(location.pathname)) return null;
  if (pending === 0 && syncing === 0 && rejected === 0) return null;

  const variant = pickVariant(online, pending, syncing, rejected);
  if (variant === null) return null;

  const onClickRejected = (): void => {
    navigate('/settings/storage');
  };

  const onKeyDownRejected = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate('/settings/storage');
    }
  };

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
    return (
      <div
        role="button"
        tabIndex={0}
        aria-live="polite"
        onClick={onClickRejected}
        onKeyDown={onKeyDownRejected}
        style={{ ...base, cursor: 'pointer' }}
      >
        {variant.copy}
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" style={base}>
      {variant.copy}
    </div>
  );
}
