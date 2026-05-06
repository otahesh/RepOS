import { useState } from 'react';
import { applyPreset, type EquipmentProfile } from '../../lib/api/equipment.ts';

type Preset = { id: 'home_minimal' | 'garage_gym' | 'commercial_gym'; title: string; subtitle: string; items: string[] };

const PRESETS: Preset[] = [
  { id: 'home_minimal', title: 'HOME · MINIMAL', subtitle: 'Bodyweight + walking', items: ['Walking track', 'Bodyweight only'] },
  { id: 'garage_gym',   title: 'HOME · GARAGE GYM', subtitle: 'DBs + bench + bar', items: ['Dumbbells 5–50 lb', 'Adjustable bench', 'Pullup bar'] },
  { id: 'commercial_gym', title: 'COMMERCIAL GYM', subtitle: 'Full equipment access', items: ['Barbell + rack', 'Full DB rack', 'All machines', 'Cardio gear'] },
];

export function EquipmentWizard({ onComplete }: { onComplete: (p: EquipmentProfile) => void }) {
  const [busy, setBusy] = useState(false);
  const handlePreset = async (id: Preset['id']) => {
    setBusy(true);
    try { onComplete(await applyPreset(id)); } finally { setBusy(false); }
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(10,13,18,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        background: '#10141C', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16, padding: '32px 36px', maxWidth: 720,
        fontFamily: 'Inter Tight, system-ui, sans-serif',
      }}>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 1.4, color: '#4D8DFF', marginBottom: 8 }}>
          GET STARTED
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: '0 0 6px', letterSpacing: -0.4 }}>
          What equipment do you have?
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', margin: '0 0 24px' }}>
          Pick a starting profile. You can edit it any time in Settings → Equipment.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => handlePreset(p.id)}
              disabled={busy}
              style={{
                textAlign: 'left', padding: '20px 18px', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.08)',
                background: '#0A0D12', color: '#fff', cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: 1.4, color: '#4D8DFF', marginBottom: 8 }}>
                {p.title}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{p.subtitle}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                {p.items.map(it => <li key={it} style={{ marginBottom: 4 }}>· {it}</li>)}
              </ul>
            </button>
          ))}
        </div>
        <button
          onClick={() => onComplete({ _v: 1 })}
          disabled={busy}
          style={{
            marginTop: 20, background: 'transparent', border: 'none',
            color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
          }}
        >
          Skip &amp; edit later →
        </button>
      </div>
    </div>
  );
}
