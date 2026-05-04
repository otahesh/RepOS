import { useEffect, useState } from 'react';
import { getEquipmentProfile, putEquipmentProfile, type EquipmentProfile } from '../../lib/api/equipment.ts';

type Section = { title: string; items: ItemDef[] };
type ItemDef =
  | { key: string; label: string; kind: 'boolean' }
  | { key: string; label: string; kind: 'load_range' }
  | { key: string; label: string; kind: 'adjustable_bench' }
  | { key: string; label: string; kind: 'machines' };

const SECTIONS: Section[] = [
  { title: 'Free Weights', items: [
    { key: 'dumbbells', label: 'Dumbbells', kind: 'load_range' },
    { key: 'kettlebells', label: 'Kettlebells', kind: 'load_range' },
    { key: 'barbell', label: 'Olympic Barbell', kind: 'boolean' },
    { key: 'ez_bar', label: 'EZ Bar', kind: 'boolean' },
    { key: 'trap_bar', label: 'Trap/Hex Bar', kind: 'boolean' },
  ]},
  { title: 'Benches & Racks', items: [
    { key: 'adjustable_bench', label: 'Adjustable Bench', kind: 'adjustable_bench' },
    { key: 'flat_bench', label: 'Flat Bench', kind: 'boolean' },
    { key: 'squat_rack', label: 'Squat Rack', kind: 'boolean' },
    { key: 'pullup_bar', label: 'Pullup Bar', kind: 'boolean' },
    { key: 'dip_station', label: 'Dip Station', kind: 'boolean' },
  ]},
  { title: 'Machines', items: [
    { key: 'cable_stack', label: 'Cable Stack', kind: 'boolean' },
    { key: 'machines', label: 'Selectorized Machines', kind: 'machines' },
  ]},
  { title: 'Cardio', items: [
    { key: 'treadmill', label: 'Treadmill', kind: 'boolean' },
    { key: 'stationary_bike', label: 'Stationary Bike', kind: 'boolean' },
    { key: 'recumbent_bike', label: 'Recumbent Bike', kind: 'boolean' },
    { key: 'rowing_erg', label: 'Rowing Erg', kind: 'boolean' },
    { key: 'outdoor_walking', label: 'Outdoor Walking', kind: 'boolean' },
    { key: 'outdoor_cycling', label: 'Outdoor Cycling', kind: 'boolean' },
  ]},
];

export function EquipmentEditor() {
  const [profile, setProfile] = useState<EquipmentProfile | null>(null);
  const [draft, setDraft] = useState<EquipmentProfile>({ _v: 1 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEquipmentProfile().then(p => { setProfile(p); setDraft(p); });
  }, []);

  const updateKey = (key: string, val: unknown) => {
    setDraft(d => ({ ...d, [key]: val }));
  };

  const save = async () => {
    setSaving(true);
    try { setProfile(await putEquipmentProfile(draft)); }
    finally { setSaving(false); }
  };

  if (!profile) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: '20px 32px', maxWidth: 800, fontFamily: 'Inter Tight, system-ui' }}>
      <h2 style={{ fontSize: 22, color: '#fff', marginBottom: 8 }}>Equipment</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 24 }}>
        What you own determines which exercises and substitutions you'll see.
      </p>
      {SECTIONS.map(section => (
        <details key={section.title} open style={{
          marginBottom: 16, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
          background: '#10141C',
        }}>
          <summary style={{ padding: '14px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#fff' }}>
            {section.title}
          </summary>
          <div style={{ padding: '4px 18px 18px' }}>
            {section.items.map(it => (
              <ItemRow key={it.key} def={it} value={(draft as any)[it.key]} onChange={v => updateKey(it.key, v)} />
            ))}
          </div>
        </details>
      ))}
      <button
        onClick={save}
        disabled={saving}
        style={{
          marginTop: 16, padding: '10px 20px', borderRadius: 8, border: 'none',
          background: '#4D8DFF', color: '#fff', fontSize: 14, fontWeight: 700,
          cursor: saving ? 'wait' : 'pointer',
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function ItemRow({ def, value, onChange }: { def: ItemDef; value: any; onChange: (v: any) => void }) {
  if (def.kind === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', color: '#fff', fontSize: 14 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked || undefined)} />
        {def.label}
      </label>
    );
  }
  if (def.kind === 'load_range') {
    const have = value && typeof value === 'object';
    const o = have ? value : { min_lb: 5, max_lb: 50, increment_lb: 5 };
    return (
      <div style={{ padding: '8px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontSize: 14 }}>
          <input type="checkbox" checked={have} onChange={e => onChange(e.target.checked ? o : false)} />
          {def.label}
        </label>
        {have && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginLeft: 28, marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
            <NumField label="Lightest pair (lb)" value={o.min_lb} onChange={v => onChange({ ...o, min_lb: v })} />
            <NumField label="Heaviest pair (lb)" value={o.max_lb} onChange={v => onChange({ ...o, max_lb: v })} />
            <NumField label="Jumps (lb)" value={o.increment_lb} onChange={v => onChange({ ...o, increment_lb: v })} />
          </div>
        )}
      </div>
    );
  }
  if (def.kind === 'adjustable_bench') {
    const have = value && typeof value === 'object';
    const o = have ? value : { incline: true, decline: false };
    return (
      <div style={{ padding: '8px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontSize: 14 }}>
          <input type="checkbox" checked={have} onChange={e => onChange(e.target.checked ? o : false)} />
          {def.label}
        </label>
        {have && (
          <div style={{ marginLeft: 28, marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.7)', display: 'flex', gap: 16 }}>
            <label><input type="checkbox" checked={!!o.incline} onChange={e => onChange({ ...o, incline: e.target.checked })} /> Incline</label>
            <label><input type="checkbox" checked={!!o.decline} onChange={e => onChange({ ...o, decline: e.target.checked })} /> Decline</label>
          </div>
        )}
      </div>
    );
  }
  if (def.kind === 'machines') {
    const have = value && typeof value === 'object';
    const o = have ? value : {};
    const M_NAMES: [string, string][] = [
      ['leg_press', 'Leg Press'], ['lat_pulldown', 'Lat Pulldown'], ['chest_press', 'Chest Press'],
      ['leg_extension', 'Leg Extension'], ['leg_curl', 'Leg Curl'],
    ];
    return (
      <div style={{ padding: '8px 0' }}>
        <div style={{ color: '#fff', fontSize: 14 }}>{def.label}</div>
        <div style={{ marginLeft: 28, marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
          {M_NAMES.map(([key, lbl]) => (
            <label key={key} style={{ display: 'block', padding: '2px 0' }}>
              <input
                type="checkbox" checked={!!o[key]}
                onChange={e => onChange({ ...o, [key]: e.target.checked || undefined })}
              /> {lbl}
            </label>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label>
      <div style={{ marginBottom: 2 }}>{label}</div>
      <input
        type="number" min={1} value={value}
        onChange={e => onChange(parseInt(e.target.value, 10) || 0)}
        style={{ width: '100%', padding: '6px 8px', borderRadius: 6,
                 border: '1px solid rgba(255,255,255,0.1)', background: '#0A0D12', color: '#fff' }}
      />
    </label>
  );
}
