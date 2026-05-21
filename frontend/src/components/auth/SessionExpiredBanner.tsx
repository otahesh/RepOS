import { useEffect, useRef, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { idbQueue } from '../../lib/idbQueue';

// W1.3.7 — Session-expired surface for CF Access whole-host auth.
//
// Listens for the `cf-access-expired` window event that logBuffer emits on a
// 401+CFAccess from POST /api/set-logs. When fired:
//
//   1. Writes a synchronous localStorage marker with the unflushed-row count.
//      Why both localStorage AND IDB (Frontend reviewer Important #1): the IDB
//      queue is the durable store and already holds the rows, but Dexie open()
//      is async and races the redirect. The localStorage marker is the only
//      synchronous "we have unflushed work" signal available on the post-login
//      load before IDB reopens — without it, the user sees a flash of "nothing
//      queued" before the queue rehydrates. Do not simplify this away.
//
//   2. Redirects to the CF Access login URL with `redirect_url` pointing back
//      at the current pathname+search so the user returns to exactly where
//      they were when their session expired.
//
//   3. Safari private mode fallback (W1.3.7.2): localStorage.setItem throws in
//      private browsing. In that case we cannot guarantee the sync signal will
//      survive the round-trip, so we DON'T auto-redirect — instead we render
//      a blocking modal with a single "Sign in" CTA. User opts in explicitly.

export const CF_ACCESS_LOGIN_URL = 'https://repos.jpmtech.com/cdn-cgi/access/login';
export const LOCAL_STORAGE_KEY = 'repos.cfAccess.unflushed';

interface UnflushedMarker {
  count: number;
  at: number;
}

function buildLoginUrl(): string {
  const back = `${window.location.pathname}${window.location.search}`;
  return `${CF_ACCESS_LOGIN_URL}?redirect_url=${encodeURIComponent(back)}`;
}

export function SessionExpiredBanner(): JSX.Element | null {
  const [needsSafariFallback, setNeedsSafariFallback] = useState(false);
  // Frozen at the moment the cf-access-expired event fires; rendered into
  // the Safari fallback modal copy. We capture the count synchronously
  // inside the event handler instead of subscribing to useIdbQueueCounts —
  // the count is only needed at the discrete event moment, and the prior
  // useIdbQueueCounts subscription added a 1Hz IDB poll on every page for a
  // banner that only renders in the Safari-fallback case.
  const [unflushedAtEvent, setUnflushedAtEvent] = useState(0);
  // One-shot guard: a re-fired `cf-access-expired` (e.g. logBuffer flushing a
  // second eligible row before the first redirect resolves) must collapse to a
  // single redirect/modal — otherwise we double-write the marker or stack the
  // modal across re-renders.
  const handledRef = useRef(false);

  useEffect(() => {
    const onExpired = async (): Promise<void> => {
      if (handledRef.current) return;
      handledRef.current = true;

      // Read the IDB queue counts lazily at event time. Three Promise.all
      // peeks instead of a per-second background poll across the whole app.
      const [pending, syncing, rejected] = await Promise.all([
        idbQueue.peekPending(),
        idbQueue.peekSyncing(),
        idbQueue.peekRejected(),
      ]);
      const count = pending.length + syncing.length + rejected.length;
      setUnflushedAtEvent(count);

      const marker: UnflushedMarker = { count, at: Date.now() };
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(marker));
      } catch {
        // Safari private mode (or quota exceeded). Don't auto-redirect — the
        // sync marker we rely on for post-login UX wouldn't survive. Surface a
        // modal so the user explicitly chooses to navigate.
        setNeedsSafariFallback(true);
        return;
      }

      window.location.assign(buildLoginUrl());
    };

    window.addEventListener('cf-access-expired', onExpired);
    return () => {
      window.removeEventListener('cf-access-expired', onExpired);
    };
  }, []);

  if (!needsSafariFallback) return null;

  const count = unflushedAtEvent;
  const setWord = count === 1 ? 'set' : 'sets';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      aria-describedby="session-expired-desc"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5,8,12,0.78)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 360,
          width: '100%',
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.lineStrong}`,
          borderRadius: 12,
          padding: 24,
          color: TOKENS.text,
          fontFamily: FONTS.ui,
          textAlign: 'center',
        }}
      >
        <div
          id="session-expired-title"
          style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}
        >
          Your session expired
        </div>
        <div
          id="session-expired-desc"
          style={{ fontSize: 14, color: TOKENS.textDim, marginBottom: 20 }}
        >
          Sign in to save {count} unlogged {setWord}.
        </div>
        <button
          type="button"
          onClick={() => {
            window.location.assign(buildLoginUrl());
          }}
          style={{
            width: '100%',
            padding: '12px 20px',
            background: TOKENS.accent,
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 8,
            fontFamily: FONTS.ui,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
