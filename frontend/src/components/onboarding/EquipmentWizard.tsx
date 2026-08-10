import { useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { applyPreset, type EquipmentProfile } from '../../lib/api/equipment.ts';
import { FONTS, TOKENS } from '../../tokens';
import { Button, DataState } from '../ui';

type Preset = {
  id: 'home_minimal' | 'garage_gym' | 'commercial_gym';
  title: string;
  subtitle: string;
  items: string[];
};

const PRESETS: Preset[] = [
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

export function EquipmentWizard({ onComplete }: { onComplete: (p: EquipmentProfile) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstPresetRef = useRef<HTMLButtonElement | null>(null);
  const handlePreset = async (id: Preset['id']) => {
    setBusy(true);
    setError(null);
    try {
      onComplete(await applyPreset(id));
    } catch {
      setError('That equipment profile could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,13,18,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: TOKENS.zModal.zOverlay,
      }}
    >
      <FocusTrap
        focusTrapOptions={{
          initialFocus: () => firstPresetRef.current,
          fallbackFocus: '#equipment-wizard',
          escapeDeactivates: false,
          allowOutsideClick: false,
        }}
      >
        <div
          id="equipment-wizard"
          role="dialog"
          aria-modal="true"
          aria-labelledby="equipment-wizard-title"
          tabIndex={-1}
          className="equipment-wizard"
          style={{
            background: TOKENS.surface,
            border: `1px solid ${TOKENS.lineStrong}`,
            borderRadius: 16,
            padding: '32px 36px',
            width: 'min(720px, calc(100vw - 32px))',
            maxHeight: 'calc(100dvh - 32px)',
            overflowY: 'auto',
            fontFamily: FONTS.ui,
          }}
        >
          <div className="repos-eyebrow" style={{ marginBottom: 8 }}>
            Get started · 1 of 3
          </div>
          <h2
            id="equipment-wizard-title"
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: TOKENS.text,
              margin: '0 0 6px',
              letterSpacing: -0.4,
            }}
          >
            What equipment do you have?
          </h2>
          <p style={{ fontSize: 14, color: TOKENS.textDim, margin: '0 0 24px' }}>
            Pick a starting profile. You can edit it any time in Settings → Equipment.
          </p>
          {error ? (
            <DataState
              kind="error"
              title="Equipment was not saved"
              body={error}
              action={<span>Choose a profile below to retry.</span>}
            />
          ) : null}
          <div className="repos-grid-3" style={{ marginTop: error ? 16 : 0 }}>
            {PRESETS.map((p, index) => (
              <button
                ref={index === 0 ? firstPresetRef : undefined}
                key={p.id}
                onClick={() => void handlePreset(p.id)}
                disabled={busy}
                className="repos-card repos-card--interactive"
                style={{
                  textAlign: 'left',
                  padding: '20px 18px',
                  color: TOKENS.text,
                  cursor: busy ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div className="repos-eyebrow" style={{ marginBottom: 8 }}>
                  {p.title}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{p.subtitle}</div>
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
          <Button
            variant="quiet"
            onClick={() => onComplete({ _v: 1 })}
            disabled={busy}
            style={{ marginTop: 16 }}
          >
            Skip and edit later →
          </Button>
          {busy ? (
            <div role="status" aria-live="polite" className="sr-only">
              Saving equipment profile
            </div>
          ) : null}
        </div>
      </FocusTrap>
    </div>
  );
}
