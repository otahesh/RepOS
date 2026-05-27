// frontend/src/components/onboarding/ParQJointPicker.tsx
// W2.3 (user decision D1) — Q5='yes' joint multi-select. Selected joints are
// sent in q5_joints on submit; the backend writes user_injuries rows (filtering
// 'other', which has no W3 joint mapping).
import { TOKENS, FONTS } from '../../tokens';
import type { ParQ5Joint } from '../../lib/api/parQ';

const JOINTS: { id: ParQ5Joint; label: string }[] = [
  { id: 'shoulder_left', label: 'Left shoulder' },
  { id: 'shoulder_right', label: 'Right shoulder' },
  { id: 'low_back', label: 'Low back' },
  { id: 'knee_left', label: 'Left knee' },
  { id: 'knee_right', label: 'Right knee' },
  { id: 'elbow', label: 'Elbow' },
  { id: 'wrist', label: 'Wrist' },
  { id: 'other', label: 'Other' },
];

export function ParQJointPicker({
  selected,
  onChange,
}: {
  selected: ParQ5Joint[];
  onChange: (next: ParQ5Joint[]) => void;
}) {
  const toggle = (id: ParQ5Joint) => {
    onChange(selected.includes(id) ? selected.filter((j) => j !== id) : [...selected, id]);
  };
  return (
    <div data-testid="parq-q5-joints" style={{ marginTop: 12, fontFamily: FONTS.ui }}>
      <div style={{ fontSize: 13, color: TOKENS.textDim, marginBottom: 8 }}>
        Which joints? (optional — helps RepOS steer exercise suggestions)
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {JOINTS.map((j) => {
          const on = selected.includes(j.id);
          return (
            <button
              key={j.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(j.id)}
              style={{
                padding: '8px 12px', borderRadius: 999, fontSize: 13,
                border: `1px solid ${on ? TOKENS.accent : TOKENS.line}`,
                background: on ? TOKENS.accentGlow : TOKENS.bg,
                color: TOKENS.text, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {j.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
