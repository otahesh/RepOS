// frontend/src/components/onboarding/steps/ReadyStep.tsx
// W2.2 — onboarding step 5. The "Start" button calls onStart (which POSTs
// onboarding-complete + dismisses the overlay). Per panel I-PROGRAMSTEP-SKIP,
// if the user skipped ProgramStep, surface a deep link back to Programs so
// there is no dead-end empty Today card.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TOKENS, FONTS } from '../../../tokens';
import { Term } from '../../Term';

export default function ReadyStep({ onStart }: { onStart: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    try {
      await onStart();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ fontFamily: FONTS.ui }}>
      <p style={{ color: TOKENS.textDim, fontSize: 15, lineHeight: 1.6, margin: '0 0 14px' }}>
        That's it. RepOS will ramp your <Term k="mesocycle" /> automatically week to week.
      </p>
      <p style={{ color: TOKENS.textMute, fontSize: 13, lineHeight: 1.6, margin: '0 0 20px' }}>
        No program selected yet? You can browse and fork one any time from the{' '}
        <Link to="/programs" style={{ color: TOKENS.accent }}>
          Programs
        </Link>{' '}
        page — until then your Today card will be empty.
      </p>
      <button
        type="button"
        onClick={finish}
        disabled={busy}
        style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'STARTING…' : 'START TRAINING'}
      </button>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: TOKENS.accent,
  color: '#0A0D12',
  border: 'none',
  borderRadius: 10,
  padding: '12px 22px',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: FONTS.ui,
  letterSpacing: 0.4,
};
