// frontend/src/components/settings/AccountEventsTimeline.tsx
//
// Beta W6 Task 16 — reverse-chronological audit feed on /settings/account
// (spec lines 3621–3632).
//
// Each row renders the humanized `kind`, a relative `occurred_at`, the
// already-/24-truncated `ip`, and the relevant `meta` details
// (meta.revoked_count / meta.token_id / meta.fields) per I-ACCOUNT-EVENTS-META.
//
// Relative-time note (per project_alpine_smallicu): there is currently no
// shared formatToParts-based formatter in src/lib/ (the only date formatting in
// the codebase is ActiveSessionsTable's inline YYYY-MM-DD HH:MM helper). We use
// a self-contained relative formatter here that does pure integer arithmetic on
// elapsed milliseconds — no Intl locale tags, so the Alpine small-icu fallback
// (MM/DD/YYYY) cannot bite us. An absolute UTC timestamp is included as the
// title attribute for precision.
//
// Pagination is keyset (per I-PAGINATION-KEYSET): "Load older" passes the prior
// page's `next_cursor` ({ before_ts, before_id }) to listEvents(). Page size 50.
//
// `session` + `bearer_token` terms are wrapped in the section header (per
// feedback_terms_of_art_tooltips + spec line 3630).

import { useCallback, useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import {
  listEvents,
  type AccountEventCursor,
  type AccountEventKind,
  type AccountEventRow,
} from '../../lib/api/account';
import { Term } from '../Term';

const PAGE_SIZE = 50;

const KIND_LABELS: Record<AccountEventKind, string> = {
  profile_changed: 'Profile changed',
  signout_everywhere: 'Signed out everywhere',
  token_revoked: 'Token revoked',
  token_minted: 'Token minted',
  delete_initiated: 'Delete initiated',
  par_q_acknowledged: 'PAR-Q acknowledged',
  onboarding_completed: 'Onboarding completed',
  restore_replayed: 'Restore replayed',
};

function humanizeKind(kind: AccountEventKind): string {
  // Fall back to the raw key for any kind not in the map (forward-compat with
  // server-side additions); the timeline still renders rather than blanking.
  return KIND_LABELS[kind] ?? kind;
}

/**
 * Pure-arithmetic relative time — "just now", "5m ago", "3h ago", "2d ago",
 * "4w ago". No Intl locale tags (per project_alpine_smallicu: Alpine small-icu
 * silently ignores them). Returns an empty string for unparseable input so the
 * caller can fall back to the absolute title.
 */
function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  return `${wk}w ago`;
}

/** Absolute UTC timestamp (YYYY-MM-DD HH:MM) for the row's title attribute. */
function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Render the human-relevant meta details for a given event row, if any. */
function metaDetail(row: AccountEventRow): string | null {
  const m = row.meta ?? {};
  const parts: string[] = [];
  if (typeof m.revoked_count === 'number') {
    parts.push(`${m.revoked_count} revoked`);
  }
  if (typeof m.token_id === 'string' && m.token_id) {
    parts.push(`token ${m.token_id}`);
  }
  if (Array.isArray(m.fields) && m.fields.length > 0) {
    parts.push(m.fields.filter((f): f is string => typeof f === 'string').join(', '));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function AccountEventsTimeline(): JSX.Element {
  const [rows, setRows] = useState<AccountEventRow[] | null>(null);
  const [cursor, setCursor] = useState<AccountEventCursor | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Initial page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await listEvents({ limit: PAGE_SIZE });
        if (cancelled) return;
        setRows(page.events);
        setCursor(page.next_cursor);
        setLoadErr(null);
      } catch (err) {
        if (cancelled) return;
        setLoadErr(err instanceof Error ? err.message : 'Failed to load activity.');
        setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listEvents({
        before_ts: cursor.before_ts,
        before_id: cursor.before_id,
        limit: PAGE_SIZE,
      });
      setRows((prev) => [...(prev ?? []), ...page.events]);
      setCursor(page.next_cursor);
      setLoadErr(null);
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : 'Failed to load older activity.');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor]);

  const empty = rows !== null && rows.length === 0;

  return (
    <section
      aria-labelledby="account-events-title"
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3
          id="account-events-title"
          style={{ fontSize: 14, fontWeight: 600, color: TOKENS.text, margin: 0 }}
        >
          Recent activity
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.5,
            color: TOKENS.textDim,
          }}
        >
          A record of changes to your account — each <Term k="session">session</Term> and{' '}
          <Term k="bearer_token">bearer token</Term> event, newest first.
        </p>
      </div>

      {loadErr ? (
        <div role="alert" style={{ fontSize: 12, color: TOKENS.danger }}>
          {loadErr}
        </div>
      ) : null}

      {rows === null ? (
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
          No account activity yet.
        </div>
      ) : (
        <>
          <ol
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {rows.map((row, i) => {
              const detail = metaDetail(row);
              return (
                <li
                  key={row.id}
                  data-testid="event-row"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    padding: '12px 0',
                    borderTop: i > 0 ? `1px solid ${TOKENS.line}` : 'none',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TOKENS.text }}>
                      {humanizeKind(row.kind)}
                    </span>
                    <span
                      style={{
                        fontFamily: FONTS.mono,
                        fontSize: 11,
                        color: TOKENS.textDim,
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      {row.ip ? <span>{row.ip}</span> : null}
                      {detail ? <span>{detail}</span> : null}
                      {row.user_email_at_event ? <span>{row.user_email_at_event}</span> : null}
                    </span>
                  </div>
                  <time
                    dateTime={row.occurred_at}
                    title={absoluteTime(row.occurred_at)}
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 11,
                      color: TOKENS.textMute,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {relativeTime(row.occurred_at) || absoluteTime(row.occurred_at)}
                  </time>
                </li>
              );
            })}
          </ol>

          {cursor ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingMore}
                style={{
                  height: 32,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: `1px solid ${TOKENS.lineStrong}`,
                  background: 'transparent',
                  color: TOKENS.text,
                  fontFamily: FONTS.ui,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loadingMore ? 'not-allowed' : 'pointer',
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore ? 'Loading…' : 'Load older'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
