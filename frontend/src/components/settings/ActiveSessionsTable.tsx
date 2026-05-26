// frontend/src/components/settings/ActiveSessionsTable.tsx
//
// Beta W6 Task 14 — active-sessions surface on /settings/account.
//
// Per I-CONTAM-MATRIX option (a): each row/card has a "Revoke" button that
// calls revokeSession(id) and then refetches the list — so the UI signal
// ("here are your sessions") has a matching action affordance, and the 6th
// G2 contamination test covers the cross-user revoke path on the server.
//
// Per I-SESSIONS-MOBILE: viewport <600px renders cards; >=600px renders a
// table. We use window.innerWidth + a resize listener (matches the spec's
// "useEffect + useState" hint and works reliably under jsdom in vitest —
// matchMedia.addEventListener isn't natively supported there).
//
// Terms-of-art per memory feedback_terms_of_art_tooltips: "session" and
// "Last IP" are wrapped in <Term k="..."> in the table header / card chrome.
//
// IPs are already /24-truncated server-side (per I-LAST-IP-TRUNCATE). The
// client just renders the string.

import { useCallback, useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import {
  listSessions,
  revokeSession,
  type SessionRow,
} from '../../lib/api/account';
import { pushToast } from '../common/ToastHost';
import { Term } from '../Term';

const MOBILE_BREAKPOINT_PX = 600;

function readIsMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT_PX;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // Use formatToParts compatible format (per project_alpine_smallicu); the
  // shape we want is YYYY-MM-DD HH:MM (UTC for predictability across hosts).
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ActiveSessionsTable(): JSX.Element {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(readIsMobile);

  const refetch = useCallback(async (): Promise<void> => {
    try {
      const rows = await listSessions();
      setSessions(rows);
      setLoadErr(null);
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : 'Failed to load sessions.');
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(readIsMobile());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleRevoke = async (id: string): Promise<void> => {
    setRevokingId(id);
    try {
      await revokeSession(id);
      pushToast({ severity: 'success', body: 'Session revoked.' });
      await refetch();
    } catch (err) {
      pushToast({
        severity: 'error',
        body:
          'Revoke failed. ' +
          (err instanceof Error ? err.message : 'Try again.'),
      });
    } finally {
      setRevokingId(null);
    }
  };

  const empty = sessions !== null && sessions.length === 0;

  return (
    <section
      aria-labelledby="active-sessions-title"
      style={{
        background: TOKENS.surface,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 12,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <h3
        id="active-sessions-title"
        style={{ fontSize: 14, fontWeight: 600, color: TOKENS.text, margin: 0 }}
      >
        Active <Term k="session">sessions</Term>
      </h3>

      {loadErr ? (
        <div
          role="alert"
          style={{ fontSize: 12, color: TOKENS.danger }}
        >
          {loadErr}
        </div>
      ) : null}

      {sessions === null ? (
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: TOKENS.textMute,
            letterSpacing: 0.6,
          }}
        >
          LOADING…
        </div>
      ) : empty ? (
        <div
          style={{
            padding: '24px 20px',
            textAlign: 'center',
            fontFamily: FONTS.mono,
            fontSize: 12,
            color: TOKENS.textMute,
            letterSpacing: 0.6,
            background: TOKENS.bg,
            borderRadius: 8,
            border: `1px solid ${TOKENS.line}`,
          }}
        >
          No active sessions.
        </div>
      ) : isMobile ? (
        // ── Mobile: card-per-session (per I-SESSIONS-MOBILE) ───────────────
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessions.map((s) => (
            <div
              key={s.id}
              data-testid="session-card"
              style={{
                background: TOKENS.bg,
                border: `1px solid ${TOKENS.line}`,
                borderRadius: 8,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: TOKENS.text,
                }}
              >
                {s.label ?? '(unlabeled)'}
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  color: TOKENS.textDim,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span>Last used: {formatDate(s.last_used_at)}</span>
                <span>
                  <Term k="truncated_ip_24">Last IP</Term>:{' '}
                  {s.last_used_ip_24 ?? '—'}
                </span>
                <span>Created: {formatDate(s.created_at)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => void handleRevoke(s.id)}
                  disabled={revokingId === s.id}
                  style={{
                    height: 28,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: `1px solid rgba(255,106,106,0.3)`,
                    background: 'rgba(255,106,106,0.08)',
                    color: TOKENS.danger,
                    fontFamily: FONTS.mono,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    cursor: revokingId === s.id ? 'not-allowed' : 'pointer',
                    opacity: revokingId === s.id ? 0.5 : 1,
                  }}
                >
                  {revokingId === s.id ? '...' : 'REVOKE'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // ── Desktop: table layout ──────────────────────────────────────────
        <div
          style={{
            background: TOKENS.bg,
            borderRadius: 8,
            border: `1px solid ${TOKENS.line}`,
            overflowX: 'auto',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr 1fr 90px',
              padding: '8px 16px',
              borderBottom: `1px solid ${TOKENS.line}`,
              minWidth: 560,
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: TOKENS.textMute,
              letterSpacing: 1.2,
            }}
          >
            <div>LABEL</div>
            <div>LAST USED</div>
            <div>
              <Term k="truncated_ip_24">LAST IP</Term>
            </div>
            <div>CREATED</div>
            <div />
          </div>

          {sessions.map((s, i) => (
            <div
              key={s.id}
              data-testid="session-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 1fr 1fr 90px',
                padding: '12px 16px',
                alignItems: 'center',
                borderTop: i > 0 ? `1px solid ${TOKENS.line}` : 'none',
                minWidth: 560,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: TOKENS.text,
                }}
              >
                {s.label ?? '(unlabeled)'}
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  color: s.last_used_at ? TOKENS.textDim : TOKENS.textMute,
                }}
              >
                {formatDate(s.last_used_at)}
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  color: s.last_used_ip_24 ? TOKENS.textDim : TOKENS.textMute,
                }}
              >
                {s.last_used_ip_24 ?? '—'}
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  color: TOKENS.textDim,
                }}
              >
                {formatDate(s.created_at)}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(s.id)}
                  disabled={revokingId === s.id}
                  aria-label={`Revoke session ${s.label ?? s.id}`}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: `1px solid rgba(255,106,106,0.3)`,
                    background: 'rgba(255,106,106,0.08)',
                    color: TOKENS.danger,
                    fontFamily: FONTS.mono,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    cursor: revokingId === s.id ? 'not-allowed' : 'pointer',
                    opacity: revokingId === s.id ? 0.5 : 1,
                  }}
                >
                  {revokingId === s.id ? '...' : 'REVOKE'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
