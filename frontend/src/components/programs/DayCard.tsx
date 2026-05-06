// frontend/src/components/programs/DayCard.tsx
import { Term } from '../Term';

type Day = {
  idx: number;
  day_offset: number;
  kind: 'strength' | 'cardio' | 'hybrid';
  name: string;
  blocks: Array<{
    exercise_slug: string;
    mev: number;
    mav: number;
    target_reps_low: number;
    target_reps_high: number;
    target_rir: number;
    rest_sec: number;
  }>;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DayCard({
  day,
  onAddSet,
  onRemoveSet,
  onSwap,
}: {
  day: Day;
  onAddSet: (dayIdx: number, blockIdx: number) => void;
  onRemoveSet: (dayIdx: number, blockIdx: number, currentSets: number) => void;
  onSwap: (dayIdx: number, blockIdx: number) => void;
}) {
  return (
    <div style={{ background: '#10141C', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
        {WEEKDAYS[day.day_offset] ?? `+${day.day_offset}d`} · {day.kind}
      </div>
      <div style={{ fontWeight: 600, marginTop: 4 }}>{day.name}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {day.blocks.map((b, i) => (
          <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
            <div>
              <button
                onClick={() => onSwap(day.idx, i)}
                style={{ background: 'transparent', border: 'none', color: '#4D8DFF', cursor: 'pointer', padding: 0, font: 'inherit' }}
              >
                {b.exercise_slug.replace(/-/g, ' ')}
              </button>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                {b.mev}–{b.mav} sets · <Term k="RIR" /> {b.target_rir}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => onRemoveSet(day.idx, i, b.mav - 1)} style={btn}>{'− set'}</button>
              <button onClick={() => onAddSet(day.idx, i)} style={btn}>{'+ set'}</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '4px 8px',
  background: '#0A0D12',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  color: '#fff',
  fontFamily: 'JetBrains Mono',
  fontSize: 10,
  cursor: 'pointer',
};
