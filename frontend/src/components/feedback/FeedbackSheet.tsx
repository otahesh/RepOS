// frontend/src/components/feedback/FeedbackSheet.tsx
// Beta W7 — modal wrapper around FeedbackForm, opened from the Topbar bug-button.
// Autofills the current route so the engineer sees where the user was.
//
// zIndex: TOKENS.zModal.zOverlay (panel C-Z). Deliberately above zBanner so the
// LogBufferRecovery banner cannot paint over an open feedback modal.
// A11y: ESC closes, focus trap, initial focus into the dialog, return focus to
// the trigger on close — via focus-trap-react, mirroring ConfirmDialog.
import { useEffect, useRef } from 'react';
import FocusTrap from 'focus-trap-react';
import { useLocation } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { FeedbackForm } from './FeedbackForm';

export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();

  // Capture the element focused BEFORE the trap steals focus, so we can restore
  // it on close. Re-captured on every false→true transition because the trap is
  // always mounted and toggled via `active` rather than mounted/unmounted.
  const previouslyFocused = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && open ? (document.activeElement as HTMLElement | null) : null,
  );
  const wasOpen = useRef(open);
  if (open && !wasOpen.current) {
    previouslyFocused.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  }
  wasOpen.current = open;

  // Restore focus to the trigger when the dialog closes — either by flipping
  // `open` back to false or by unmounting. FocusTrap's own
  // returnFocusOnDeactivate stays false so this ref-based path is the single
  // source of truth, matching the ConfirmDialog pattern.
  useEffect(() => {
    if (!open) {
      previouslyFocused.current?.focus?.();
    }
    return () => {
      previouslyFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    // FocusTrap is ALWAYS rendered; activation is driven by the `active` prop
    // (supported in focus-trap-react@12). Toggling `active` instead of
    // conditionally unmounting the whole trap is StrictMode-safe — the dev-mode
    // mount→unmount→remount double-invoke desyncs focus-trap-react's lifecycle
    // when the trap is unmounted. When `active={false}` the body child is
    // `null`, so the trap has no container and stays inert.
    <FocusTrap
      active={open}
      focusTrapOptions={{
        escapeDeactivates: true,
        clickOutsideDeactivates: false,
        allowOutsideClick: true,
        onDeactivate: onClose,
        // returnFocusOnDeactivate is FALSE — we manage return-focus ourselves via
        // the previouslyFocused ref + cleanup, since the component may close by
        // flipping `open` before the trap deactivates.
        returnFocusOnDeactivate: false,
        // jsdom does not compute layout, so the default `displayCheck: 'full'`
        // rejects every node as untabbable and `activate()` throws. Real
        // browsers tab correctly regardless.
        tabbableOptions: { displayCheck: 'none' },
        // Apply initial focus synchronously during activation rather than on the
        // next tick — the default setTimeout(0) doesn't flush under jsdom + RTL.
        delayInitialFocus: false,
      }}
    >
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Send feedback"
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: TOKENS.zModal.zOverlay,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '12vh 16px 16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 460,
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 14,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontFamily: FONTS.ui, color: TOKENS.text }}>
                Send feedback
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  color: TOKENS.textMute,
                  cursor: 'pointer',
                  fontSize: 18,
                }}
              >
                ×
              </button>
            </div>
            <FeedbackForm initialRoute={location.pathname} onSubmitted={onClose} />
          </div>
        </div>
      ) : null}
    </FocusTrap>
  );
}
