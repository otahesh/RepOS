// frontend/src/components/dashboard/RecoveryFlagBanner.tsx
//
// W3 recovery-flag advisories (overreaching / stalled-PR / bodyweight-crash),
// surfaced on the Today page for BOTH viewports. The backend evaluators and
// /api/recovery-flags shipped in W3.1; this is the render surface.
//
// Persistent dismissible cards, not ephemeral toasts — a clinical advisory
// must survive until the user acts on it. Dismissal is per (flag, ISO week)
// server-side, so a dismissed flag stays gone for the week and re-fires the
// next week if the pattern persists.
//
// Fetch/dismiss failures are silent by design: an advisory must never break
// or block the Today page.
import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import {
  listRecoveryFlags,
  dismissRecoveryFlag,
  type RecoveryFlag,
} from '../../lib/api/recoveryFlags';
import { Term } from '../Term';

export function RecoveryFlagBanner(): JSX.Element | null {
  const [flags, setFlags] = useState<RecoveryFlag[]>([]);

  useEffect(() => {
    let cancelled = false;
    listRecoveryFlags()
      .then((res) => {
        if (!cancelled) setFlags(res.flags);
      })
      .catch(() => {
        /* advisory surface — never break Today */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (flags.length === 0) return null;

  const dismiss = async (flag: RecoveryFlag['flag']): Promise<void> => {
    try {
      await dismissRecoveryFlag(flag);
      setFlags((prev) => prev.filter((f) => f.flag !== flag));
    } catch {
      /* keep the card so the user can retry */
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {flags.map((f) => (
        <div
          key={f.flag}
          role="status"
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 14px',
            borderRadius: 10,
            border: `1px solid ${TOKENS.warn}66`,
            background: `linear-gradient(90deg, ${TOKENS.warn}1f, transparent 70%)`,
            color: TOKENS.text,
            fontFamily: FONTS.ui,
            fontSize: 14,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span aria-hidden="true" style={{ color: TOKENS.warn, fontWeight: 700 }}>
              ▲
            </span>
            <span style={{ fontWeight: 600 }}>{f.message}</span>
            {f.flag === 'overreaching' ? <Term k="deload" compact /> : null}
          </span>
          <button
            aria-label={`Dismiss for this week: ${f.message}`}
            onClick={() => void dismiss(f.flag)}
            style={{
              background: 'transparent',
              border: `1px solid ${TOKENS.warn}66`,
              color: TOKENS.warn,
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            DISMISS
          </button>
        </div>
      ))}
    </div>
  );
}
