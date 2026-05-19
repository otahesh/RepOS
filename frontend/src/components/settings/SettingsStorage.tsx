import { useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { useIdbQueueCounts } from '../../hooks/useIdbQueueCounts';
import { idbQueue } from '../../lib/idbQueue';

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

export default function SettingsStorage(): JSX.Element {
  const { pending, syncing, rejected, oldestPendingCreatedAt } = useIdbQueueCounts();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const stalePendingDays =
    oldestPendingCreatedAt !== null
      ? Math.floor((Date.now() - oldestPendingCreatedAt) / ONE_DAY_MS)
      : null;

  const pendingCaption =
    stalePendingDays !== null && stalePendingDays >= 1
      ? `Oldest queued set is ${stalePendingDays} days old. Stays here until sync — clearing would lose data.`
      : 'Stays here until sync — clearing would lose data.';

  const onClear = async (): Promise<void> => {
    setClearing(true);
    try {
      await idbQueue.clearRejected();
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  const clearButton = rejected > 0 && !confirming ? (
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
            Are you sure? {rejected} rejected {rejected === 1 ? 'set' : 'sets'} will be removed
            from this device. The server keeps no copy of these.
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button
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
              onClick={() => { void onClear(); }}
              disabled={clearing}
              style={{
                background: TOKENS.danger,
                color: '#FFFFFF',
                border: 'none',
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
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
