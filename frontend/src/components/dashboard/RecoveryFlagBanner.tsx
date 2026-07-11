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
// The flags FETCH failing is silent by design: an advisory must never break
// or block the Today page. A DISMISS failing is user feedback (error toast +
// card retained) — the user acted and must know the action didn't stick.
import { useEffect, useState, type ReactNode } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import {
  listRecoveryFlags,
  dismissRecoveryFlag,
  type RecoveryFlag,
} from '../../lib/api/recoveryFlags';
import { Term } from '../Term';
import { pushToast } from '../common/ToastHost';
import type { TermKey } from '../../lib/terms';

// Terms-of-art inside API-provided advisory copy get Term tooltips. The copy
// arrives at runtime, so the JSX-literal term-coverage script can't see it —
// this map is the coverage. First occurrence of `word` is wrapped.
const MESSAGE_TERMS: Partial<Record<RecoveryFlag['flag'], { word: string; k: TermKey }>> = {
  overreaching: { word: 'deload', k: 'deload' },
  stalled_pr: { word: 'PR', k: 'pr' },
};

function renderMessage(f: RecoveryFlag): ReactNode {
  const wrap = MESSAGE_TERMS[f.flag];
  if (!wrap) return f.message;
  const at = f.message.indexOf(wrap.word);
  if (at === -1) return f.message;
  return (
    <>
      {f.message.slice(0, at)}
      <Term k={wrap.k}>{wrap.word}</Term>
      {f.message.slice(at + wrap.word.length)}
    </>
  );
}

export function RecoveryFlagBanner(): JSX.Element | null {
  const [flags, setFlags] = useState<RecoveryFlag[]>([]);
  const [pending, setPending] = useState<RecoveryFlag['flag'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRecoveryFlags()
      .then((res) => {
        // `?? []` — a malformed payload must degrade to "no advisories",
        // same contract as the catch below.
        if (!cancelled) setFlags(res?.flags ?? []);
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
    setPending(flag);
    try {
      await dismissRecoveryFlag(flag);
      setFlags((prev) => prev.filter((f) => f.flag !== flag));
    } catch {
      pushToast({
        severity: 'error',
        body: "Couldn't dismiss the advisory — check your connection and try again.",
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {flags.map((f) => (
        <div
          key={f.flag}
          role="status"
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
            <span style={{ fontWeight: 600 }}>{renderMessage(f)}</span>
          </span>
          <button
            aria-label={`Dismiss for this week: ${f.message}`}
            title="Hides this advisory for the rest of the week. It returns next week if the pattern persists."
            disabled={pending === f.flag}
            onClick={() => void dismiss(f.flag)}
            style={{
              background: 'transparent',
              border: `1px solid ${TOKENS.warn}66`,
              color: TOKENS.warn,
              borderRadius: 6,
              padding: '4px 10px',
              cursor: pending === f.flag ? 'default' : 'pointer',
              opacity: pending === f.flag ? 0.5 : 1,
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
