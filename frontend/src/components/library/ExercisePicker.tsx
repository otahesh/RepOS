import { useEffect, useMemo, useState } from 'react';
import { listExercises, type Exercise } from '../../lib/api/exercises.ts';

export type PickerProps = {
  onPick: (e: Exercise) => void;
  defaultEquipmentToggle?: boolean;
  source?: 'catalog' | 'mine';   // reserved for v3; UI hides until then
};

const GROUP_TO_SLUGS: Record<string, string[]> = {
  chest: ['chest'],
  back: ['lats', 'upper_back'],
  shoulders: ['front_delt', 'side_delt', 'rear_delt'],
  arms: ['biceps', 'triceps'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  core: [], // no core muscles in v1 catalog
};

export function ExercisePicker({ onPick, defaultEquipmentToggle = true }: PickerProps) {
  const [all, setAll] = useState<Exercise[]>([]);
  const [q, setQ] = useState('');
  const [muscles, setMuscles] = useState<Set<string>>(new Set());
  const [equipOnly, setEquipOnly] = useState(defaultEquipmentToggle);

  useEffect(() => { listExercises().then(setAll).catch(() => setAll([])); }, []);

  const filtered = useMemo(() => {
    return all.filter(e => {
      if (q && !e.name.toLowerCase().includes(q.toLowerCase()) && !e.slug.includes(q.toLowerCase())) return false;
      if (muscles.size > 0 && ![...muscles].some(g => GROUP_TO_SLUGS[g]?.includes(e.primary_muscle))) return false;
      // equipOnly: stub for now — true wiring requires user equipment_profile + per-exercise pass check
      void equipOnly;
      return true;
    });
  }, [all, q, muscles, equipOnly]);

  return (
    <div style={{ background: '#10141C', borderRadius: 12, padding: 16, fontFamily: 'Inter Tight' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text" placeholder="Search exercises…"
          value={q} onChange={e => setQ(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6,
                   border: '1px solid rgba(255,255,255,0.1)', background: '#0A0D12', color: '#fff' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
          <input type="checkbox" checked={equipOnly} onChange={e => setEquipOnly(e.target.checked)} />
          Available only
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {['chest', 'back', 'shoulders', 'arms', 'legs', 'core'].map(g => {
          const active = muscles.has(g);
          return (
            <button key={g}
              onClick={() => {
                const next = new Set(muscles);
                active ? next.delete(g) : next.add(g);
                setMuscles(next);
              }}
              style={{
                padding: '4px 10px', borderRadius: 100, fontSize: 11, fontFamily: 'JetBrains Mono', letterSpacing: 1,
                border: `1px solid ${active ? '#4D8DFF' : 'rgba(255,255,255,0.08)'}`,
                background: active ? 'rgba(77,141,255,0.15)' : 'transparent',
                color: active ? '#4D8DFF' : 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
              }}>{g.toUpperCase()}</button>
          );
        })}
      </div>
      <div style={{ maxHeight: 400, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map(e => (
          <button key={e.slug} onClick={() => onPick(e)}
            style={{
              textAlign: 'left', padding: '10px 12px', borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.06)', background: '#0A0D12', color: '#fff',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
              {e.primary_muscle_name} · {e.movement_pattern}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
