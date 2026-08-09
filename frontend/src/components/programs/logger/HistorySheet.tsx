import { useEffect, useRef, useState } from 'react';
import { rpeFromRir } from '../../../lib/effort';
import { formatSessionDate } from '../../../lib/formatDate';
import { TOKENS, FONTS } from '../../../tokens';
import {
  getExerciseHistory,
  type HistorySession,
  type HistorySet,
} from '../../../lib/api/exerciseHistory';
import { isBeginnerTrack } from '../../../lib/programTracks';

// formatSessionDate moved to lib/formatDate.ts (2026-07-13 quality pass);
// re-exported so existing consumers of this import site keep working.
export { formatSessionDate };

// =============================================================================
// HistorySheet — per-exercise history bottom sheet, opened by the ⟲ button in
// ExerciseFocus. Fetches fresh on every mount (deliberately separate from the
// container's last-session prefill cache in TodayLoggerMobile — the 60s
// Cache-Control on GET /api/exercises/:slug/history is acceptable staleness
// for a backward-looking review, so no special fetch options here).
//
// Focus management mirrors DesktopSwapSheet.tsx verbatim: capture the
// pre-mount focus target, steer initial focus into the dialog, trap Tab/
// Shift+Tab inside it, and restore focus to the trigger on unmount.
// =============================================================================

export type HistorySheetProps = {
  slug: string;
  track?: string | null;
  onClose: () => void;
};

export function HistorySheet({ slug, track, onClose }: HistorySheetProps) {
  const [sessions, setSessions] = useState<HistorySession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Fetch on mount / slug change.
  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setError(null);
    getExerciseHistory(slug, 8)
      .then((res) => {
        if (cancelled) return;
        setSessions(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Capture pre-mount focus + steer initial focus into the dialog. Restore
  // on unmount. Mirrors DesktopSwapSheet.tsx:36-46.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  // ESC + focus trap on Tab/Shift+Tab. Mirrors DesktopSwapSheet.tsx:58-88.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const beginner = isBeginnerTrack(track);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Exercise history"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: TOKENS.zModal.zSheet,
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '80vh',
          background: TOKENS.surface,
          color: TOKENS.text,
          borderTop: `1px solid ${TOKENS.line}`,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          fontFamily: FONTS.ui,
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              letterSpacing: 1,
              color: TOKENS.textDim,
              textTransform: 'uppercase',
            }}
          >
            History
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: TOKENS.textDim,
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </header>

        {error ? (
          <div role="alert" style={{ fontSize: 13, color: TOKENS.danger }}>
            {"Couldn't load history: "}
            {error}
          </div>
        ) : sessions === null ? (
          <HistorySpinner />
        ) : sessions.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: TOKENS.textMute,
              fontSize: 13,
            }}
          >
            No history yet — first time doing this one.
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {sessions.map((session) => (
              <li key={session.date}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: TOKENS.textDim,
                    marginBottom: 6,
                  }}
                >
                  {formatSessionDate(session.date)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {session.sets.map((set, i) => (
                    <div key={i} style={{ fontFamily: FONTS.mono, fontSize: 14 }}>
                      {formatHistorySet(set, beginner)}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HistorySpinner() {
  return (
    <div
      role="status"
      aria-label="Loading history"
      style={{ display: 'flex', justifyContent: 'center', padding: 24 }}
    >
      <style>{'@keyframes repos-history-spin { to { transform: rotate(360deg); } }'}</style>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: `3px solid ${TOKENS.line}`,
          borderTopColor: TOKENS.accent,
          animation: 'repos-history-spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

// `135 × 8` with `BW` for a null weight (bodyweight logs), reps omitted when
// null, and ` @RIR n` appended only on non-beginner tracks — per product
// decision 2026-07-06, beginner surfaces never show RIR jargon.
// Duration sets (holds) render `40s hold` / `70 · 40s hold`; their stored
// rir is displayed as RPE (10 − rir) per the one-unit rule in lib/effort.ts.
// Mode is derived from the LOG's own duration_sec, so mixed pre/post-
// reclassification history renders each row as it was actually logged.
export function formatHistorySet(set: HistorySet, beginnerTrack: boolean): string {
  if (set.duration_sec != null) {
    let str = set.weight_lbs != null ? `${set.weight_lbs} · ` : '';
    str += `${set.duration_sec}s hold`;
    if (!beginnerTrack && set.rir != null) str += ` @RPE ${rpeFromRir(set.rir)}`;
    return str;
  }
  let str = set.weight_lbs != null ? String(set.weight_lbs) : 'BW';
  if (set.reps != null) str += ` × ${set.reps}`;
  if (!beginnerTrack && set.rir != null) str += ` @RIR ${set.rir}`;
  return str;
}
