import { useEffect, useId, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { TOKENS, FONTS } from '../../tokens';

export type ConfirmTier = 'medium' | 'heavy';

export interface ConfirmDialogProps {
  open: boolean;
  tier: ConfirmTier;
  title: string;
  body: string;
  /** Heavy tier — Confirm is enabled only when typed input matches this exactly. */
  requireTyped?: string;
  /** Defaults to "Confirm". Callers can pass a busy label, e.g. "Signing out…". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual severity for the confirm button. Defaults to 'accent'. */
  severity?: 'accent' | 'danger';
  onConfirm: (typed?: string) => void;
  onCancel: () => void;
}

/**
 * W6 Task 12 — Two-tier destructive confirmation primitive.
 *
 * Tiers:
 *   - medium: title + body + Confirm/Cancel.
 *   - heavy:  adds a typed-confirm text input; Confirm is disabled until the
 *             typed value matches `requireTyped` exactly.
 *
 * A11y invariants:
 *   - role="dialog", aria-modal="true", aria-labelledby={titleId}.
 *   - ESC fires onCancel exactly once (per C-CONFIRMDIALOG-ESC). The ONLY
 *     ESC handler is focus-trap-react's `escapeDeactivates: true` +
 *     `onDeactivate: onCancel`. No separate keydown listener — that would
 *     double-fire.
 *   - Heavy tier: initial focus lands on the typed-confirm input
 *     (per C-CONFIRMDIALOG-FOCUS). Medium tier: default first focusable.
 *   - Return-focus: previously-focused element is captured on mount and
 *     restored on unmount (per C-CONFIRMDIALOG-RETURNFOCUS), mirroring the
 *     MidSessionSwapPicker pattern.
 */
export function ConfirmDialog({
  open,
  tier,
  title,
  body,
  requireTyped,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  severity = 'accent',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element | null {
  const titleId = useId();
  const [typed, setTyped] = useState('');
  // Capture pre-open focus so we record the element that was focused BEFORE
  // FocusTrap's activation steals focus into the trap. We re-capture on every
  // false→true transition of `open` (not just once at mount), because the trap
  // is now always mounted and toggled via the `active` prop rather than being
  // mounted/unmounted — so a single mount-time capture would miss the real
  // trigger when the parent keeps <ConfirmDialog open={false}/> mounted.
  const previouslyFocused = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && open
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  const wasOpen = useRef(open);

  // Track open transitions to (a) capture the return-focus target on open and
  // (b) reset the heavy-tier typed input each time the dialog reopens — the
  // previous implementation got this reset for free via unmount, but the trap
  // now stays mounted across open/close cycles.
  if (open && !wasOpen.current) {
    previouslyFocused.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (typed !== '') setTyped('');
  }
  wasOpen.current = open;

  // Restore focus when the dialog closes — either by unmounting (the
  // conditional-render pattern) or by flipping `open` back to false (the
  // always-mounted pattern). FocusTrap's own returnFocusOnDeactivate stays
  // false so this ref-based path remains the single source of truth, matching
  // the MidSessionSwapPicker pattern.
  useEffect(() => {
    if (!open) {
      previouslyFocused.current?.focus?.();
    }
    return () => {
      previouslyFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isHeavy = tier === 'heavy';
  const typedOk = !isHeavy || (requireTyped !== undefined && typed === requireTyped);
  const confirmDisabled = !typedOk;
  const confirmColor = severity === 'danger' ? TOKENS.danger : TOKENS.accent;

  const handleConfirm = (): void => {
    if (confirmDisabled) return;
    onConfirm(isHeavy ? typed : undefined);
  };

  return (
    // FocusTrap is ALWAYS rendered; activation is driven by the `active` prop
    // (supported in focus-trap-react@12). This is StrictMode-safe: the dev-mode
    // mount→unmount→remount double-invoke desyncs focus-trap-react's class
    // lifecycle when the whole trap is conditionally unmounted, leaving the
    // trap rendering nothing. Toggling `active` instead keeps the instance
    // stable across the double-invoke. When `active={false}` the body child is
    // `null`, so the trap has no container element and stays inert (it never
    // attempts to trap focus or throw).
    <FocusTrap
      active={open}
      focusTrapOptions={{
        escapeDeactivates: true,
        clickOutsideDeactivates: false,
        allowOutsideClick: true,
        onDeactivate: onCancel,
        // Heavy tier focuses the typed-confirm input; medium tier uses default.
        // Function form lets us bypass focus-trap's `isFocusable` check, which
        // depends on layout-sensitive tabbable checks that don't compute in
        // jsdom even with `displayCheck: 'none'`.
        initialFocus: isHeavy
          ? () => document.querySelector<HTMLInputElement>('input[type="text"]') ?? false
          : undefined,
        // returnFocusOnDeactivate is FALSE here because we manage return-focus
        // ourselves via the previouslyFocused ref + unmount cleanup. The
        // component may unmount before the trap deactivates (e.g. parent
        // closes by flipping `open`), so the ref-based path is the source of
        // truth.
        returnFocusOnDeactivate: false,
        // jsdom does not compute layout, so the default `displayCheck: 'full'`
        // rejects every node as untabbable and `activate()` throws. The actual
        // DOM in real browsers tabs correctly regardless of this option.
        tabbableOptions: { displayCheck: 'none' },
        // Apply initial focus synchronously during activation rather than on
        // the next tick. The default `true` defers focus to a setTimeout(0)
        // which doesn't flush deterministically under jsdom + RTL.
        delayInitialFocus: false,
      }}
    >
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 440,
              margin: '0 16px',
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
            }}
          >
            <h3
              id={titleId}
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: TOKENS.text,
              }}
            >
              {title}
            </h3>
            {body && (
              <p
                style={{
                  margin: '12px 0 0',
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: TOKENS.textDim,
                }}
              >
                {body}
              </p>
            )}
            {isHeavy && requireTyped !== undefined && (
              <div style={{ marginTop: 16 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontFamily: FONTS.mono,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                    color: TOKENS.textMute,
                    marginBottom: 6,
                  }}
                >
                  Type <span style={{ color: TOKENS.text }}>{requireTyped}</span> to confirm
                </label>
                <input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: TOKENS.surface2,
                    border: `1px solid ${TOKENS.lineStrong}`,
                    borderRadius: 6,
                    color: TOKENS.text,
                    fontFamily: FONTS.mono,
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
              }}
            >
              <button
                type="button"
                onClick={onCancel}
                style={{
                  padding: '8px 14px',
                  background: 'transparent',
                  border: `1px solid ${TOKENS.lineStrong}`,
                  borderRadius: 6,
                  color: TOKENS.text,
                  fontFamily: FONTS.ui,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirmDisabled}
                style={{
                  padding: '8px 14px',
                  background: confirmDisabled ? 'transparent' : confirmColor,
                  border: `1px solid ${confirmDisabled ? TOKENS.line : confirmColor}`,
                  borderRadius: 6,
                  color: confirmDisabled ? TOKENS.textMute : '#fff',
                  fontFamily: FONTS.ui,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                  opacity: confirmDisabled ? 0.6 : 1,
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </FocusTrap>
  );
}
