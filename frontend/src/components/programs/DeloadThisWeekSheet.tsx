// frontend/src/components/programs/DeloadThisWeekSheet.tsx
// W2.6 — confirm sheet for the manual mid-meso deload (sheet-handover pattern
// per panel I-DELOAD-A11Y, mirroring W3's MidSessionSwapSheet). On confirm it
// POSTs deload-now and shows a success toast carrying an Undo action.
//
// zIndex: TOKENS.zModal.zSheet (panel C-Z). A11y: ESC closes, focus trap,
// initial focus into the sheet, return focus on close.
import { useEffect, useRef, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { Term } from '../Term';
import { pushToast } from '../common/ToastHost';
import { triggerManualDeload, undoManualDeload } from '../../lib/api/manualDeload';

export function DeloadThisWeekSheet({
  runId,
  onClose,
}: {
  runId: string;
  onClose: (changed: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = sheetRef.current?.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(false);
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const f = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
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
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await triggerManualDeload(runId);
      pushToast({
        severity: 'success',
        body: 'Deload applied. Sets reduced (≈half of MAV), RIR pinned to 4. Undo within 24h.',
        actionLabel: 'Undo',
        onAction: () => {
          undoManualDeload(runId)
            .then(() => pushToast({ severity: 'success', body: 'Deload reversed.' }))
            .catch(() =>
              pushToast({
                severity: 'error',
                body: 'Undo failed — the 24h window may have passed.',
              }),
            );
        },
      });
      onClose(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm deload"
      ref={sheetRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,13,18,0.72)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: TOKENS.zModal.zSheet,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div
        style={{
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: '16px 16px 0 0',
          padding: '24px 24px 32px',
          maxWidth: 560,
          width: '100%',
          fontFamily: FONTS.ui,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 700, color: TOKENS.text, margin: '0 0 8px' }}>
          <Term k="manual_deload">Deload</Term> the rest of this <Term k="mesocycle" />?
        </h3>
        <p style={{ fontSize: 14, color: TOKENS.textDim, lineHeight: 1.6, margin: '0 0 18px' }}>
          Reduce remaining-week sets to about half of <Term k="MAV" /> and pin <Term k="RIR" /> to
          4. Undoable for 24 hours.
        </p>
        {err && <p style={{ color: TOKENS.danger, fontSize: 13, margin: '0 0 12px' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'APPLYING…' : 'CONFIRM DELOAD'}
          </button>
          <button type="button" onClick={() => onClose(false)} disabled={busy} style={cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: TOKENS.warn,
  color: '#0A0D12',
  border: 'none',
  borderRadius: 10,
  padding: '12px 22px',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: FONTS.ui,
  letterSpacing: 0.4,
};
const cancelBtn: React.CSSProperties = {
  background: 'transparent',
  color: TOKENS.textDim,
  border: 'none',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: FONTS.ui,
  textDecoration: 'underline',
};
