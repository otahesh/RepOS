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
  // Capture pre-mount focus during render so we record the element that was
  // focused BEFORE FocusTrap's componentDidMount steals focus into the trap.
  // (A `useEffect` capture would run after child class-component effects, by
  // which time `document.activeElement` is already inside the trap.) Lazy
  // initialization happens once per mount, matching the cleanup lifecycle.
  const previouslyFocused = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
  );

  // Restore focus on unmount. Mirrors MidSessionSwapPicker's pattern but with
  // the capture moved out of the effect into the ref initializer above.
  useEffect(() => {
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  if (!open) return null;

  const isHeavy = tier === 'heavy';
  const typedOk = !isHeavy || (requireTyped !== undefined && typed === requireTyped);
  const confirmDisabled = !typedOk;
  const confirmColor = severity === 'danger' ? TOKENS.danger : TOKENS.accent;

  const handleConfirm = (): void => {
    if (confirmDisabled) return;
    onConfirm(isHeavy ? typed : undefined);
  };

  return (
    <FocusTrap
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
    </FocusTrap>
  );
}
