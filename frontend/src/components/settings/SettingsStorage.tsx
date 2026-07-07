import { useEffect, useRef, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { useIdbQueueCounts } from '../../hooks/useIdbQueueCounts';
import { idbQueue } from '../../lib/idbQueue';
import { logBuffer } from '../../lib/logBuffer';

// W1.3.8 — Settings → Storage. Surfaces the offline-queue state and a single
// safe-to-clear bucket (rejected). Pending and syncing rows are intentionally
// NOT clearable: those are user training data that hasn't reached the server,
// and dropping them would silently lose work.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface RowProps {
  label: string;
  count: number;
  testId: string;
  caption: string;
  action?: JSX.Element;
}

function StorageRow({ label, count, testId, caption, action }: RowProps): JSX.Element {
  return (
    <div
      data-testid={`row-${testId}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '14px 0',
        borderTop: `1px solid ${TOKENS.line}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textMute,
            letterSpacing: 1.2,
          }}
        >
          {label.toUpperCase()}
        </span>
        <span
          data-testid={`count-${testId}`}
          style={{
            fontFamily: FONTS.mono,
            fontSize: 18,
            color: TOKENS.text,
          }}
        >
          {count}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 12, color: TOKENS.textDim, lineHeight: 1.5 }}>{caption}</span>
        {action}
      </div>
    </div>
  );
}

// Per Security review: a same-origin script could otherwise drive Clear →
// Confirm with two synthetic clicks. Requiring the user to type the literal
// word "CLEAR" raises the bar from "one event dispatch" to "key-by-key
// input." Trivial UX speed bump, real defense-in-depth.
const CONFIRM_PHRASE = 'CLEAR';

export default function SettingsStorage(): JSX.Element {
  const { pending, syncing, rejected, stalled, oldestPendingCreatedAt } = useIdbQueueCounts();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // a11y on the confirm modal: when it opens, move focus to Cancel and let
  // Escape close it. The modal isn't full-screen so a focus-trap library
  // isn't strictly needed, but the auto-focus + Escape pair covers the
  // "keyboard users don't even know the modal appeared" failure mode.
  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    setConfirmInput('');
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !clearing) {
        e.preventDefault();
        setConfirming(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, clearing]);

  const stalePendingDays =
    oldestPendingCreatedAt !== null
      ? Math.floor((Date.now() - oldestPendingCreatedAt) / ONE_DAY_MS)
      : null;

  const stuckNote =
    stalled > 0
      ? `${stalled} ${stalled === 1 ? 'set' : 'sets'} stuck after repeated sync failures — retry re-arms them. `
      : '';
  const pendingCaption =
    stuckNote +
    (stalePendingDays !== null && stalePendingDays >= 1
      ? `Oldest queued set is ${stalePendingDays} days old. Stays here until sync — clearing would lose data.`
      : 'Stays here until sync — clearing would lose data.');

  const onClear = async (): Promise<void> => {
    setClearing(true);
    try {
      await idbQueue.clearRejected();
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  const onRetry = async (): Promise<void> => {
    setRetrying(true);
    try {
      // Re-arms attempt-capped rows and kicks a flush; the 1s count poll
      // updates the row as they drain. No confirm — retrying can't lose data.
      await logBuffer.retryStalled();
    } finally {
      setRetrying(false);
    }
  };

  const retryButton =
    stalled > 0 ? (
      <button
        type="button"
        onClick={() => {
          void onRetry();
        }}
        disabled={retrying}
        style={{
          background: 'transparent',
          color: TOKENS.accent,
          border: `1px solid ${TOKENS.accent}`,
          padding: '6px 12px',
          borderRadius: 6,
          fontFamily: FONTS.ui,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          cursor: retrying ? 'not-allowed' : 'pointer',
          opacity: retrying ? 0.6 : 1,
        }}
      >
        Retry sync
      </button>
    ) : undefined;

  const clearButton =
    rejected > 0 && !confirming ? (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{
          background: 'transparent',
          color: TOKENS.danger,
          border: `1px solid ${TOKENS.danger}`,
          padding: '6px 12px',
          borderRadius: 6,
          fontFamily: FONTS.ui,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Clear rejected
      </button>
    ) : undefined;

  return (
    <div
      style={{
        padding: '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 640,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: TOKENS.textMute,
            letterSpacing: 1.2,
            marginBottom: 4,
          }}
        >
          SETTINGS
        </div>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: -0.5,
            color: TOKENS.text,
          }}
        >
          Storage
        </h2>
      </div>

      <div
        style={{
          background: TOKENS.surface,
          borderRadius: 12,
          border: `1px solid ${TOKENS.line}`,
          padding: '4px 22px 18px',
        }}
      >
        <StorageRow
          label="Pending"
          count={pending}
          testId="pending"
          caption={pendingCaption}
          action={retryButton}
        />
        <StorageRow
          label="Syncing"
          count={syncing}
          testId="syncing"
          caption="In-flight to the server. Will resolve to logged or rejected."
        />
        <StorageRow
          label="Rejected"
          count={rejected}
          testId="rejected"
          caption="Server refused these (deleted plan, audit window closed). Safe to clear."
          action={clearButton}
        />
      </div>

      {confirming && (
        <div
          role="alertdialog"
          aria-modal="true"
          style={{
            background: TOKENS.surface,
            border: `1px solid ${TOKENS.danger}`,
            borderRadius: 12,
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 14, color: TOKENS.text, lineHeight: 1.5 }}>
            Are you sure? {rejected} rejected {rejected === 1 ? 'set' : 'sets'} will be removed from
            this device. The server keeps no copy of these.
          </div>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 12,
              color: TOKENS.textDim,
            }}
          >
            Type{' '}
            <code style={{ fontFamily: FONTS.mono, color: TOKENS.danger }}>{CONFIRM_PHRASE}</code>{' '}
            to confirm
            <input
              type="text"
              aria-label="Type CLEAR to confirm"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              disabled={clearing}
              autoComplete="off"
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                padding: '8px 10px',
                background: TOKENS.bg,
                color: TOKENS.text,
                border: `1px solid ${TOKENS.line}`,
                borderRadius: 6,
              }}
            />
          </label>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button
              ref={cancelRef}
              type="button"
              onClick={() => setConfirming(false)}
              disabled={clearing}
              style={{
                background: 'transparent',
                color: TOKENS.text,
                border: `1px solid ${TOKENS.line}`,
                padding: '8px 14px',
                borderRadius: 6,
                fontFamily: FONTS.ui,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                cursor: clearing ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void onClear();
              }}
              disabled={clearing || confirmInput !== CONFIRM_PHRASE}
              style={{
                background: confirmInput === CONFIRM_PHRASE ? TOKENS.danger : TOKENS.surface3,
                color: confirmInput === CONFIRM_PHRASE ? '#FFFFFF' : TOKENS.textDim,
                border: 'none',
                padding: '8px 14px',
                borderRadius: 6,
                fontFamily: FONTS.ui,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                cursor: clearing || confirmInput !== CONFIRM_PHRASE ? 'not-allowed' : 'pointer',
              }}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
