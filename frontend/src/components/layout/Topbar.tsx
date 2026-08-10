import { useEffect, useState, useCallback } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { apiFetch } from '../../auth';
import { useIsMobile } from '../../lib/useIsMobile';
import { formatWeekdayShortDate } from '../../lib/formatDate';
import Icon from '../Icon';
import { FeedbackSheet } from '../feedback/FeedbackSheet';
import { useLocation } from 'react-router-dom';

interface SyncStatus {
  source: string;
  last_success_at: string | null;
  state: 'fresh' | 'stale' | 'broken';
}

interface TopbarProps {
  onToggleSidebar?: () => void;
  mobileOpen?: boolean;
  triggerRef?: React.Ref<HTMLButtonElement>;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'never';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffM = Math.floor(diffMs / (1000 * 60));
  if (diffM < 60) return `${diffM}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return '--:--';
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Topbar({ onToggleSidebar, mobileOpen = false, triggerRef }: TopbarProps) {
  const location = useLocation();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [error, setError] = useState(false);
  const isMobile = useIsMobile();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const fetchSync = useCallback(async () => {
    try {
      const res = await apiFetch('/api/health/sync/status');
      if (!res.ok) throw new Error('non-ok');
      const data: SyncStatus = await res.json();
      setSync(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void fetchSync();
    // Poll every 60 seconds — sync pill is cacheable 60s per spec
    const id = setInterval(() => void fetchSync(), 60_000);
    return () => clearInterval(id);
  }, [fetchSync]);

  const stateColor = sync
    ? sync.state === 'fresh'
      ? TOKENS.good
      : sync.state === 'stale'
        ? TOKENS.warn
        : TOKENS.danger
    : TOKENS.textMute;

  const today = formatWeekdayShortDate(new Date()).toUpperCase();
  const routeTitle = titleForRoute(location.pathname);

  return (
    <header
      style={{
        borderBottom: `1px solid ${TOKENS.line}`,
        padding: isMobile ? '0 16px' : '0 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        height: 72,
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        {isMobile && (
          <button
            ref={triggerRef}
            type="button"
            onClick={onToggleSidebar}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              border: `1px solid ${TOKENS.line}`,
              background: TOKENS.surface,
              color: TOKENS.text,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Icon name="menu" size={18} color={TOKENS.text} />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: TOKENS.textMute,
              letterSpacing: 1.4,
              marginBottom: 2,
            }}
          >
            {today}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: -0.4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {routeTitle}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          aria-label="Send feedback"
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            border: `1px solid ${TOKENS.line}`,
            background: TOKENS.surface,
            color: TOKENS.text,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <Icon name="feedback" size={18} color={TOKENS.text} />
        </button>
        {/* The pill carries only the state at phone widths; source and exact
            timing expand on demand so the top bar stays calm and compact. */}
        <details
          style={{
            position: 'relative',
          }}
        >
          <summary
            aria-label="Synchronization status"
            style={{
              minWidth: isMobile ? 72 : 190,
              minHeight: isMobile ? 44 : 36,
              padding: isMobile ? '0 10px' : '0 12px',
              borderRadius: 8,
              border: `1px solid ${TOKENS.line}`,
              background: TOKENS.surface,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: isMobile ? 7 : 10,
              fontFamily: FONTS.mono,
              fontSize: 11,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              listStyle: 'none',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: 10,
                background: stateColor,
                boxShadow: `0 0 8px ${stateColor}`,
              }}
            />
            {error || !sync ? (
              <span style={{ color: TOKENS.textMute, letterSpacing: 0.6 }}>
                {error ? 'ERROR' : 'SYNC'}
              </span>
            ) : isMobile ? (
              <span style={{ color: TOKENS.textMute, letterSpacing: 0.6 }}>
                {sync.state.toUpperCase()}
              </span>
            ) : (
              <>
                <span style={{ color: TOKENS.textMute, letterSpacing: 0.6 }}>
                  {sync.state.toUpperCase()}
                </span>
                <span style={{ color: TOKENS.text, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(sync.last_success_at)}
                </span>
                <span style={{ color: TOKENS.textMute }}>·</span>
                <span style={{ color: TOKENS.textDim }}>
                  {formatRelativeTime(sync.last_success_at).toUpperCase()}
                </span>
              </>
            )}
          </summary>
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              zIndex: 80,
              minWidth: 236,
              padding: 12,
              border: `1px solid ${TOKENS.lineStrong}`,
              borderRadius: 10,
              background: TOKENS.surface,
              boxShadow: '0 16px 36px rgba(0,0,0,0.4)',
              fontFamily: FONTS.mono,
              fontSize: 10,
              lineHeight: 1.65,
              color: TOKENS.textDim,
            }}
          >
            <strong style={{ display: 'block', color: error ? TOKENS.danger : stateColor }}>
              {error ? 'Synchronization unavailable' : `${sync?.state ?? 'unknown'} sync state`}
            </strong>
            <span style={{ display: 'block' }}>Source: {sync?.source ?? 'Not reported'}</span>
            <span style={{ display: 'block' }}>
              Last success:{' '}
              {sync?.last_success_at
                ? `${formatTime(sync.last_success_at)} · ${formatRelativeTime(sync.last_success_at)}`
                : 'Never'}
            </span>
            {error ? (
              <button
                type="button"
                className="repos-button repos-button--quiet"
                onClick={() => void fetchSync()}
                style={{ marginTop: 6, minHeight: 36, paddingInline: 0 }}
              >
                Retry sync status
              </button>
            ) : null}
          </div>
        </details>
      </div>

      <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </header>
  );
}

function titleForRoute(pathname: string): string {
  if (pathname === '/' || pathname === '/today') return "Let's move.";
  if (/^\/today\/[^/]+\/log/.test(pathname)) return 'Workout';
  if (pathname.startsWith('/programs') || pathname.startsWith('/my-programs')) return 'Programs';
  if (pathname.startsWith('/history')) return 'History';
  if (pathname.startsWith('/admin/feedback')) return 'Feedback triage';
  if (pathname === '/settings') return 'Settings';
  const settingsTitles: Array<[string, string]> = [
    ['/settings/account', 'Account'],
    ['/settings/health', 'Health'],
    ['/settings/equipment', 'Equipment'],
    ['/settings/integrations', 'Integrations'],
    ['/settings/program-prefs', 'Program preferences'],
    ['/settings/backups', 'Backups'],
    ['/settings/feedback', 'Feedback'],
    ['/settings/users', 'User administration'],
    ['/settings/storage', 'Storage'],
    ['/settings/injuries', 'Injuries'],
  ];
  return settingsTitles.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'RepOS';
}
