import { useEffect, useRef, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { getSubstitutions, type SubstitutionCandidate } from '../../lib/api/exercises';
import { MidSessionSwapSheet } from './MidSessionSwapSheet';
import { injuryAdvisoryCopy } from '../../lib/terms';

/**
 * Beta W3.3 — mid-session swap candidate list.
 *
 * Bridge between `<BlockOverflowMenu>` ("Got a tweak?") and the existing
 * single-target `<MidSessionSwapSheet>`. Fetches ranked candidates via
 * `getSubstitutions`, renders the list with an injury-advisory line under any
 * row the server-side injuryRanker tagged (advisory only — clicking a tagged
 * row still opens the confirm sheet). On confirm/cancel, propagates `changed`
 * upward so callers can refetch the workout.
 *
 * Dialog a11y (W3 reviewer Critical #1):
 *   - ESC closes via onClose(false).
 *   - Initial focus lands on the first focusable in the panel (Cancel falls
 *     back when subs are still loading).
 *   - Tab / Shift+Tab cycle within the dialog.
 *   - Focus returns to the previously-focused element on cancel/ESC. When the
 *     user picks a sub we hand off to MidSessionSwapSheet; the handover ref
 *     suppresses the focus restore so the sheet can take focus instead.
 */
export function MidSessionSwapPicker({
  plannedSetId,
  fromName,
  fromSlug,
  onClose,
}: {
  plannedSetId: string;
  fromName: string;
  fromSlug: string;
  onClose: (changed: boolean) => void;
}) {
  const [subs, setSubs] = useState<SubstitutionCandidate[]>([]);
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const handingOffRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getSubstitutions(fromSlug);
        if (cancelled) return;
        setSubs(r.subs ?? []);
      } catch (e: unknown) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromSlug]);

  // Capture pre-mount focus + steer initial focus into the dialog.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => {
      if (handingOffRef.current) return;
      previouslyFocused.current?.focus?.();
    };
  }, []);

  // After subs load, the first focusable becomes the top candidate button
  // (Cancel was the only focusable during the loading state). Move focus to
  // it so keyboard users land on the actionable content rather than the
  // bottom Cancel button. Brief load windows (<100ms typical) mean the
  // user hasn't had time to interact yet, so a focus shift here is not
  // intrusive.
  useEffect(() => {
    if (loading || !dialogRef.current) return;
    const first = dialogRef.current.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus();
  }, [loading]);

  // ESC + focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(false);
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

  // When a candidate is picked, hand off to the existing confirm sheet.
  // We do NOT keep the picker mounted underneath — the sheet is the active
  // dialog. On close, propagate `changed` upward and close the picker too.
  if (pick) {
    return (
      <MidSessionSwapSheet
        plannedSetId={plannedSetId}
        fromName={fromName}
        toId={pick.id}
        toName={pick.name}
        onClose={(changed) => {
          setPick(null);
          onClose(changed);
        }}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 100,
      }}
    >
      <div
        ref={dialogRef}
        style={{
          background: TOKENS.surface,
          borderRadius: '16px 16px 0 0',
          padding: 24,
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
          color: TOKENS.text,
          fontFamily: FONTS.ui,
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        <h3 id="picker-title" style={{ marginTop: 0, fontSize: 16 }}>
          Swap {fromName}?
        </h3>
        {loading && <p style={{ color: TOKENS.textDim, fontSize: 13 }}>Loading…</p>}
        {!loading && err && (
          <p style={{ color: TOKENS.danger, fontSize: 13 }}>Couldn’t load alternatives: {err}</p>
        )}
        {!loading && !err && subs.length === 0 && (
          <p style={{ color: TOKENS.textDim, fontSize: 13 }}>
            No alternatives match your equipment.
          </p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {subs.map((s) => (
            <li key={s.id} style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  handingOffRef.current = true;
                  setPick({ id: s.id, name: s.name });
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: `1px solid ${TOKENS.line}`,
                  borderRadius: 8,
                  padding: 12,
                  color: TOKENS.text,
                  cursor: 'pointer',
                  fontFamily: FONTS.ui,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                {s.injury_advisory && (
                  <div style={{ color: TOKENS.warn, fontSize: 11, marginTop: 4 }}>
                    <span aria-hidden="true">⚠ </span>
                    {injuryAdvisoryCopy(s.injury_advisory.joint, s.injury_advisory.level)}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onClose(false)}
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: 'transparent',
            border: `1px solid ${TOKENS.lineStrong}`,
            color: TOKENS.text,
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: FONTS.ui,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
