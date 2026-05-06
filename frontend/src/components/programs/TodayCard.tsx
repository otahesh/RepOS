import { useEffect, useState } from 'react';
import { getTodayWorkout, type TodayWorkoutResponse } from '../../lib/api/mesocycles';
import { Term } from '../Term';

export function TodayCard({ onStart }: { onStart: (runId: string, dayId: string) => void }) {
  const [data, setData] = useState<TodayWorkoutResponse | null>(null);
  useEffect(() => { getTodayWorkout().then(setData).catch(() => setData(null)); }, []);
  if (!data) return <div style={card('rgba(255,255,255,0.5)')}>Loading…</div>;
  if (data.state === 'no_active_run') return <div style={card('rgba(255,255,255,0.5)')}>Pick a program to get started.</div>;
  if (data.state === 'rest') return <div style={card('#6BE28B')}><strong>Rest day.</strong><br /><span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Eat. Sleep. Tomorrow&apos;s a workout.</span></div>;
  const { day, sets } = data;
  return (
    <div style={card('#4D8DFF')}>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 1, color: '#4D8DFF', textTransform: 'uppercase', marginBottom: 4 }}>
        Week {day.week_idx} · Day {day.day_idx + 1}
      </div>
      <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#fff' }}>{day.name}</h3>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
        {sets.length} <Term k="working_set" compact />{'s'}
      </div>
      <button
        onClick={() => onStart(data.run_id, day.id)}
        style={{ padding: '12px 18px', width: '100%', background: '#4D8DFF', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}
      >
        {'Start Workout'}
      </button>
    </div>
  );
}

function card(accent: string): React.CSSProperties {
  return {
    background: '#10141C',
    border: `1px solid ${accent}`,
    borderRadius: 12,
    padding: 16,
    fontFamily: 'Inter Tight',
    color: '#fff',
  };
}
