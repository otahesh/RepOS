// frontend/src/components/onboarding/steps/GoalStep.tsx
// W2.2 — onboarding step 3. Goal radio (cut / maintain / bulk only). Cardio-
// capacity goals are deferred to W7+ per user decision D5. Skippable.
import { TOKENS, FONTS } from '../../../tokens';
import { Term } from '../../Term';
import type { OnboardingGoal } from '../../../lib/api/onboarding';

const GOALS: { id: OnboardingGoal; title: string; blurb: string }[] = [
  { id: 'cut', title: 'CUT', blurb: 'Lose fat, hold strength. Volume near MEV.' },
  { id: 'maintain', title: 'MAINTAIN', blurb: 'Hold bodyweight, keep training quality.' },
  { id: 'bulk', title: 'BULK', blurb: 'Add muscle. Ramp toward MAV / MRV.' },
];

export default function GoalStep({
  goal,
  onChange,
  onNext,
  onSkip,
}: {
  goal: OnboardingGoal;
  onChange: (g: OnboardingGoal) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <div style={{ fontFamily: FONTS.ui }}>
      <p style={{ color: TOKENS.textDim, fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
        Your goal sets where the auto-ramp starts — closer to <Term k="MEV" /> for a cut, toward{' '}
        <Term k="MAV" /> for a bulk.
      </p>
      <div role="radiogroup" aria-label="Training goal" style={{ display: 'grid', gap: 10 }}>
        {GOALS.map((g) => {
          const selected = g.id === goal;
          return (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(g.id)}
              style={{
                textAlign: 'left',
                padding: '14px 16px',
                borderRadius: 12,
                border: `1px solid ${selected ? TOKENS.accent : TOKENS.line}`,
                background: selected ? TOKENS.accentGlow : TOKENS.bg,
                color: TOKENS.text,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  letterSpacing: 1.4,
                  color: TOKENS.accent,
                  marginBottom: 4,
                }}
              >
                {g.title}
              </div>
              <div style={{ fontSize: 13, color: TOKENS.textDim }}>{g.blurb}</div>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 18 }}>
        <button type="button" onClick={onNext} style={primaryBtn}>
          NEXT
        </button>
        <button type="button" onClick={onSkip} style={skipBtn}>
          Skip for now
        </button>
      </div>
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
const skipBtn: React.CSSProperties = {
  background: 'transparent',
  color: TOKENS.textDim,
  border: 'none',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: FONTS.ui,
  textDecoration: 'underline',
};
