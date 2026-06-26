// frontend/src/components/onboarding/steps/ProgramStep.tsx
// W2.2 — onboarding step 4. Lists curated program templates with a deep link
// to the full Programs page (where fork happens). Skippable; ReadyStep surfaces
// the come-back deep link if skipped (panel I-PROGRAMSTEP-SKIP). The goal prop
// is shown as context (cardio-capacity goals deferred to W7+).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TOKENS, FONTS } from '../../../tokens';
import { Term } from '../../Term';
import { listProgramTemplates, type ProgramTemplate } from '../../../lib/api/programs';
import type { OnboardingGoal } from '../../../lib/api/onboarding';

export default function ProgramStep({
  goal,
  onNext,
  onSkip,
}: {
  goal: OnboardingGoal;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [templates, setTemplates] = useState<ProgramTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listProgramTemplates()
      .then((t) => {
        if (!cancelled) setTemplates(t);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ fontFamily: FONTS.ui }}>
      <p style={{ color: TOKENS.textDim, fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
        Pick a curated <Term k="mesocycle" /> to fork — or browse the full library on the Programs
        page. (Goal: <strong style={{ color: TOKENS.text }}>{goal}</strong>.)
      </p>
      {loading ? (
        <div style={{ color: TOKENS.textMute, fontSize: 13 }}>Loading programs…</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {templates.slice(0, 4).map((t) => (
            <Link
              key={t.id}
              to={`/programs/${t.slug}`}
              style={{
                display: 'block',
                textDecoration: 'none',
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${TOKENS.line}`,
                background: TOKENS.bg,
                color: TOKENS.text,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: TOKENS.textDim, marginTop: 2 }}>
                {t.days_per_week} days/week · {t.weeks} weeks
              </div>
            </Link>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 18 }}>
        <Link
          to="/programs"
          style={{ ...primaryBtn, textDecoration: 'none', display: 'inline-block' }}
          onClick={onNext}
        >
          BROWSE PROGRAMS
        </Link>
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
