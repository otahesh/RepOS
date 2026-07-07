import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { TOKENS, FONTS } from '../../../tokens';
import type { ExerciseGuide } from '../../../lib/api/exerciseGuide';

// =============================================================================
// SetupCardSheet — the ⓘ setup card (spec §4): photo slot, "Set up" callout,
// 3 cues, 2 don'ts. Presentational: the container fetched the guide already
// (it needed it to decide ⓘ visibility), so this receives data as a prop —
// deliberately unlike HistorySheet, which self-fetches.
//
// W2: media is always {} — the photo slot renders a placeholder. W3 wires
// committed WebP photos + app-rendered annotation tags from setup_facts.
//
// Focus management mirrors HistorySheet.tsx:55-96 verbatim: capture the
// pre-mount focus target, steer initial focus into the dialog, trap
// Tab/Shift+Tab inside it, restore focus to the trigger on unmount.
// =============================================================================

export type SetupCardSheetProps = {
  exerciseName: string;
  guide: ExerciseGuide;
  onClose: () => void;
};

export function SetupCardSheet({ exerciseName, guide, onClose }: SetupCardSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Capture pre-mount focus + steer initial focus into the dialog. Restore
  // on unmount. Mirrors HistorySheet.tsx:55-64.
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

  // ESC + focus trap on Tab/Shift+Tab. Mirrors HistorySheet.tsx:67-96.
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`How to set up: ${exerciseName}`}
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
          maxHeight: '85vh',
          background: TOKENS.surface,
          color: TOKENS.text,
          borderTop: `1px solid ${TOKENS.line}`,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
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
            How to set up
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

        {/* Photo slot — placeholder until W3 lands committed photos. */}
        {guide.media.start ? (
          <img
            src={guide.media.start}
            alt={`${exerciseName} setup position`}
            style={{ width: '100%', borderRadius: 12, display: 'block' }}
          />
        ) : (
          <div
            data-testid="setup-photo-placeholder"
            aria-hidden="true"
            style={{
              width: '100%',
              aspectRatio: '4 / 3',
              borderRadius: 12,
              background: TOKENS.surface2,
              border: `1px dashed ${TOKENS.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: TOKENS.textMute,
              fontFamily: FONTS.mono,
              fontSize: 11,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            Photo coming soon
          </div>
        )}

        <section aria-label="Set up">
          <SectionLabel>Set up</SectionLabel>
          <div
            style={{
              background: TOKENS.surface2,
              border: `1px solid ${TOKENS.line}`,
              borderLeft: `3px solid ${TOKENS.accent}`,
              borderRadius: 8,
              padding: 12,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {guide.setup_callout}
          </div>
        </section>

        <section aria-label="Cues">
          <SectionLabel>Cues</SectionLabel>
          <ul
            style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {guide.cues.map((cue, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.4 }}>
                {cue}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Common mistakes">
          <SectionLabel color={TOKENS.danger}>Don&rsquo;t</SectionLabel>
          <ul
            style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {guide.donts.map((dont, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.4, color: TOKENS.textDim }}>
                {dont}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function SectionLabel({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontFamily: FONTS.mono,
        fontSize: 10,
        letterSpacing: 1,
        color: color ?? TOKENS.textDim,
        textTransform: 'uppercase',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
