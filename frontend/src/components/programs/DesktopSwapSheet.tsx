import { useEffect, useRef, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { ExercisePicker } from '../library/ExercisePicker';
import type { Exercise } from '../../lib/api/exercises';

export type SwapScope = 'this' | 'all';
export type DesktopSwapContext = 'program_edit' | 'mid_session';

export type DesktopSwapSheetProps = {
  open: boolean;
  context: DesktopSwapContext;
  fromSlug: string;
  fromName?: string;
  onClose: () => void;
  onApply: (result: { scope: SwapScope; toExerciseSlug: string }) => void;
};

export function DesktopSwapSheet({
  open,
  context,
  fromSlug: _fromSlug,
  fromName,
  onClose,
  onApply,
}: DesktopSwapSheetProps) {
  // [Design NIT] program edit ⇒ "every occurrence" default; mid-session ⇒ "this block".
  const [scope, setScope] = useState<SwapScope>(context === 'program_edit' ? 'all' : 'this');
  const [picked, setPicked] = useState<Exercise | null>(null);
  const [pickerLoading, setPickerLoading] = useState(true); // for the async-content re-focus
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // [C-DESKTOPSWAPSHEET-A11Y (c) + (d)] Capture pre-mount focus + steer initial
  // focus into the dialog. Return-focus on unmount. Mirrors
  // MidSessionSwapPicker.tsx:64-74 verbatim.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // [C-DESKTOPSWAPSHEET-A11Y (e)] After exercise list loads, move focus to the
  // first candidate. Mirrors MidSessionSwapPicker.tsx:82-88.
  useEffect(() => {
    if (pickerLoading || !dialogRef.current) return;
    const first = dialogRef.current.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus();
  }, [pickerLoading]);

  // [C-DESKTOPSWAPSHEET-A11Y (a) + (b)] ESC + focus trap on Tab/Shift+Tab.
  // Mirrors MidSessionSwapPicker.tsx:91-118 verbatim.
  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Swap exercise"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 100,
      }}
    >
      <div
        ref={dialogRef}
        style={{
          width: 480,
          background: TOKENS.surface,
          color: TOKENS.text,
          borderLeft: `1px solid ${TOKENS.line}`,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          fontFamily: FONTS.ui,
          overflowY: 'auto',
        }}
      >
        <header>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              letterSpacing: 1,
              color: TOKENS.textDim,
              textTransform: 'uppercase',
            }}
          >
            Swap exercise
          </div>
          <h2 style={{ margin: '4px 0 0', fontSize: 18 }}>{fromName ?? 'Current exercise'}</h2>
        </header>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, color: TOKENS.textDim, marginBottom: 6 }}>
            Apply to:
          </legend>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="radio"
              name="scope"
              value="this"
              checked={scope === 'this'}
              onChange={() => setScope('this')}
            />
            This block only
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="radio"
              name="scope"
              value="all"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            {/* [I-EVERY-OCCURRENCE-TERM] plain English UI copy, not a term-of-art — no <Term> wrap. */}
            Every occurrence in this program
          </label>
        </fieldset>

        <ExercisePicker
          onPick={(e) => setPicked(e)}
          onLoadingChange={(b) => setPickerLoading(b)} /* [C-DESKTOPSWAPSHEET-A11Y (e)] */
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          <button type="button" onClick={onClose} style={btn('ghost')}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!picked}
            onClick={() => picked && onApply({ scope, toExerciseSlug: picked.slug })}
            style={btn(picked ? 'primary' : 'disabled')}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function btn(variant: 'primary' | 'ghost' | 'disabled'): React.CSSProperties {
  if (variant === 'primary')
    return {
      padding: '10px 16px',
      background: TOKENS.accent,
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      cursor: 'pointer',
      fontFamily: FONTS.ui,
      fontWeight: 600,
    };
  if (variant === 'disabled')
    return {
      padding: '10px 16px',
      background: TOKENS.surface2,
      color: TOKENS.textMute,
      border: `1px solid ${TOKENS.line}`,
      borderRadius: 8,
      cursor: 'not-allowed',
    };
  return {
    padding: '10px 16px',
    background: 'transparent',
    color: TOKENS.text,
    border: `1px solid ${TOKENS.lineStrong}`,
    borderRadius: 8,
    cursor: 'pointer',
  };
}
