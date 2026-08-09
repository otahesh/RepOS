// frontend/src/components/onboarding/steps/EquipmentStep.tsx
// W2.2 — onboarding step 2. Inline preset picker (reuses the equipment
// applyPreset API). We do NOT embed the standalone EquipmentWizard because it
// is itself a full-screen fixed overlay with its own modal chrome — nesting it
// inside the onboarding overlay would double-stack modals. Skippable
// (master plan W2.2: steps 2–4 skippable). Edit later in Settings → Equipment.
import { useState } from 'react';
import { TOKENS, FONTS } from '../../../tokens';
import { applyPreset } from '../../../lib/api/equipment';

type PresetId = 'home_minimal' | 'garage_gym' | 'commercial_gym';
const PRESETS: { id: PresetId; title: string; subtitle: string; items: string[] }[] = [
  {
    id: 'home_minimal',
    title: 'HOME · MINIMAL',
    subtitle: 'Bodyweight + walking',
    items: ['Walking track', 'Bodyweight only'],
  },
  {
    id: 'garage_gym',
    title: 'HOME · GARAGE GYM',
    subtitle: 'DBs + bench + bar',
    items: ['Dumbbells 5–50 lb', 'Adjustable bench', 'Pullup bar'],
  },
  {
    id: 'commercial_gym',
    title: 'COMMERCIAL GYM',
    subtitle: 'Full equipment access',
    items: ['Barbell + rack', 'Full DB rack', 'All machines', 'Cardio gear'],
  },
];

export default function EquipmentStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const pick = async (id: PresetId) => {
    setBusy(true);
    try {
      await applyPreset(id);
      onNext();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ fontFamily: FONTS.ui }}>
      <p style={{ color: TOKENS.textDim, fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
        Pick the kit you train with. RepOS filters exercise suggestions to what you can actually do.
        You can edit this any time in Settings → Equipment.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => pick(p.id)}
            disabled={busy}
            style={{
              textAlign: 'left',
              padding: '18px 16px',
              borderRadius: 12,
              border: `1px solid ${TOKENS.line}`,
              background: TOKENS.bg,
              color: TOKENS.text,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 10,
                letterSpacing: 1.4,
                color: TOKENS.accent,
                marginBottom: 8,
              }}
            >
              {p.title}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{p.subtitle}</div>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                fontSize: 12,
                color: TOKENS.textDim,
              }}
            >
              {p.items.map((it) => (
                <li key={it} style={{ marginBottom: 4 }}>
                  · {it}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
      <button type="button" onClick={onSkip} disabled={busy} style={skipBtn}>
        Skip for now
      </button>
    </div>
  );
}

const skipBtn: React.CSSProperties = {
  background: 'transparent',
  color: TOKENS.textDim,
  border: 'none',
  padding: '14px 0 0',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: FONTS.ui,
  textDecoration: 'underline',
};
