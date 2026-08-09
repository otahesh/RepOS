import { useEffect } from 'react';
import { TOKENS, FONTS } from '../../tokens';

export type ToastSeverity = 'info' | 'success' | 'warn' | 'error';

export interface ToastProps {
  id: string;
  severity: ToastSeverity;
  body: string;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: (id: string) => void;
}

function borderColorFor(sev: ToastSeverity): string {
  switch (sev) {
    case 'success':
      return TOKENS.good;
    case 'warn':
      return TOKENS.warn;
    case 'error':
      return TOKENS.danger;
    case 'info':
    default:
      return TOKENS.textDim;
  }
}

/**
 * A single ephemeral notification. Renders as a status (polite) live region
 * for non-error severities and an alert (assertive) region for error.
 *
 * Auto-dismisses after `durationMs` (default 5000ms). The dismiss-x and the
 * optional action button both also fire `onDismiss(id)` so the host can drop
 * it from its queue.
 */
export function Toast({
  id,
  severity,
  body,
  durationMs = 5000,
  actionLabel,
  onAction,
  onDismiss,
}: ToastProps): JSX.Element {
  useEffect(() => {
    const handle = window.setTimeout(() => onDismiss(id), durationMs);
    return () => window.clearTimeout(handle);
  }, [id, durationMs, onDismiss]);

  const role = severity === 'error' ? 'alert' : 'status';
  const ariaLive = severity === 'error' ? 'assertive' : 'polite';
  const borderColor = borderColorFor(severity);

  return (
    <div
      role={role}
      aria-live={ariaLive}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        minWidth: 280,
        maxWidth: 420,
        padding: '10px 12px',
        background: TOKENS.surface,
        border: `1px solid ${TOKENS.line}`,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 6,
        color: TOKENS.text,
        fontFamily: FONTS.ui,
        fontSize: 13,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ flex: 1, lineHeight: 1.4 }}>{body}</div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={() => {
            onAction();
            onDismiss(id);
          }}
          style={{
            background: 'transparent',
            border: `1px solid ${TOKENS.lineStrong}`,
            color: TOKENS.accent,
            fontFamily: FONTS.mono,
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            padding: '4px 8px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(id)}
        style={{
          background: 'transparent',
          border: 'none',
          color: TOKENS.textMute,
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}
