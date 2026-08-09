// frontend/src/components/onboarding/BetaDisclaimer.tsx
//
// G14 — first-run Beta disclaimer. Every cohort member must know they're on
// Beta software before anything else, so the AppShell gate renders this
// BEFORE OnboardingOverlay / ParQGate (see useOnboardingGate). One-time:
// gated on users.beta_disclaimer_ack_at, stamped via the idempotent ack
// endpoint. No dismiss-without-ack — the whole point is informed consent.
import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../lib/useIsMobile';
import { ackBetaDisclaimer } from '../../lib/api/onboarding';
import { TOKENS, FONTS } from '../../tokens';

const POINTS: Array<{ title: string; body: string }> = [
  {
    title: 'Expect rough edges.',
    body: 'RepOS is Beta software. Bugs happen. Your data is backed up nightly and restores are rehearsed — but tell us fast when something breaks.',
  },
  {
    title: 'This is not medical advice.',
    body: 'Training targets, recovery flags, and deload suggestions are software advisories, not clinical guidance. Talk to a professional about pain, injury, or health conditions.',
  },
  {
    title: 'Found something? Send feedback.',
    body: 'The Send feedback button (top right) goes straight to the engineering operator. Bugs, confusion, ideas — all of it helps.',
  },
];

export function BetaDisclaimer({ onComplete }: { onComplete: () => void }) {
  const isMobile = useIsMobile();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus();
  }, []);

  async function ack(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await ackBetaDisclaimer();
      onComplete();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-disclaimer-title"
      ref={dialogRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,13,18,0.92)',
        display: 'flex',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center',
        zIndex: TOKENS.zModal.zOverlay,
        padding: isMobile ? 0 : 24,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: isMobile ? 0 : 16,
          padding: isMobile ? '24px 16px 40px' : '32px 36px',
          maxWidth: 560,
          width: '100%',
          minHeight: isMobile ? '100vh' : 'auto',
          fontFamily: FONTS.ui,
          color: TOKENS.text,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            letterSpacing: 1.4,
            color: TOKENS.warn,
            marginBottom: 8,
          }}
        >
          BETA
        </div>
        <h2 id="beta-disclaimer-title" style={{ margin: '0 0 16px', fontSize: 24 }}>
          Before you train.
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
          {POINTS.map((p) => (
            <div key={p.title}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{p.title}</div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 1.5 }}>
                {p.body}
              </div>
            </div>
          ))}
        </div>
        {failed ? (
          <div role="alert" style={{ color: TOKENS.danger, fontSize: 13, marginBottom: 12 }}>
            Couldn't save your acknowledgment — check your connection and try again.
          </div>
        ) : null}
        <button
          onClick={() => void ack()}
          disabled={busy}
          style={{
            width: '100%',
            height: 44,
            borderRadius: 10,
            border: 0,
            background: TOKENS.accent,
            color: '#fff',
            fontFamily: FONTS.ui,
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 0.6,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          I UNDERSTAND — LET'S TRAIN
        </button>
      </div>
    </div>
  );
}
