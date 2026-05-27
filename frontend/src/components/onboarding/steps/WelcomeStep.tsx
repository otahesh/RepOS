// frontend/src/components/onboarding/steps/WelcomeStep.tsx
// W2.2 — onboarding step 1. Informational + Next.
import { TOKENS, FONTS } from '../../../tokens';
import { Term } from '../../Term';

export default function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ fontFamily: FONTS.ui }}>
      <p style={{ color: TOKENS.textDim, fontSize: 15, lineHeight: 1.6, margin: '0 0 20px' }}>
        RepOS plans your training in <Term k="mesocycle">mesocycles</Term> — short blocks that ramp
        volume from <Term k="MEV" /> toward <Term k="MAV" />, then <Term k="deload">deload</Term>. Five
        quick steps and you're lifting.
      </p>
      <button
        type="button"
        onClick={onNext}
        style={primaryBtn}
      >
        GET STARTED
      </button>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: TOKENS.accent, color: '#0A0D12', border: 'none', borderRadius: 10,
  padding: '12px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
  fontFamily: FONTS.ui, letterSpacing: 0.4,
};
