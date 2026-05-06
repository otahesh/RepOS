import { useEffect, useState } from 'react';
import { getTodayWorkout, type TodayWorkoutResponse } from '../../lib/api/mesocycles';
import { Term } from '../Term';

export function TodayWorkoutMobile({ onStart }: { onStart: (runId: string, dayId: string) => void }) {
  const [data, setData] = useState<TodayWorkoutResponse | null>(null);
  useEffect(() => { getTodayWorkout().then(setData).catch(() => setData(null)); }, []);
  if (!data) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;
  if (data.state === 'no_active_run') return <div style={{ padding: 16, color: 'rgba(255,255,255,0.7)' }}>{'No active '}<Term k="mesocycle" />{'. Pick a program on desktop.'}</div>;
  if (data.state === 'rest') return <div style={{ padding: 16, color: '#6BE28B', fontFamily: 'Inter Tight' }}><strong>Rest day.</strong></div>;
  const { day, sets, cardio } = data;
  // Group sets by block_idx to show "exercise → N sets"
  const groups = new Map<number, typeof sets>();
  for (const s of sets) {
    if (!groups.has(s.block_idx)) groups.set(s.block_idx, []);
    groups.get(s.block_idx)!.push(s);
  }
  return (
    <div style={{ padding: 16, fontFamily: 'Inter Tight', color: '#fff', maxWidth: 480, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: 1, color: '#4D8DFF', textTransform: 'uppercase' }}>
          Week {day.week_idx} · Day {day.day_idx + 1}
        </div>
        <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>{day.name}</h2>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[...groups.entries()].map(([blockIdx, blockSets]) => {
          const first = blockSets[0];
          return (
            <li key={blockIdx} style={{ background: '#10141C', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{first.exercise_name ?? first.exercise_slug ?? `Exercise ${first.exercise_id}`}</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                {blockSets.length} <Term k="working_set" compact />{'s · '}{first.target_reps_low}{'–'}{first.target_reps_high}{' reps · '}<Term k="RIR" compact />{' '}{first.target_rir}{' · '}{first.rest_sec}{'s rest'}
              </div>
              {first.suggested_substitution ? (
                <div style={{ marginTop: 6, fontSize: 11, color: '#F5B544' }}>
                  {'Suggested sub: '}{first.suggested_substitution.name}{' ('}{first.suggested_substitution.reason}{')'}
                </div>
              ) : null}
            </li>
          );
        })}
        {cardio.map(c => (
          <li key={c.id} style={{ background: '#10141C', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{c.exercise_name ?? `Cardio ${c.exercise_id}`}</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
              {c.target_duration_sec ? `${Math.round(c.target_duration_sec / 60)} min` : null}
              {c.target_distance_m ? ` · ${(c.target_distance_m / 1000).toFixed(1)} km` : null}
              {c.target_zone ? <>{' · '}<Term k={(`Z${c.target_zone}`) as 'Z2' | 'Z4' | 'Z5'} compact /></> : null}
            </div>
          </li>
        ))}
      </ul>
      <button
        onClick={() => onStart(data.run_id, day.id)}
        style={{ marginTop: 24, padding: '14px', width: '100%', background: '#4D8DFF', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', fontSize: 14, cursor: 'pointer' }}
      >
        {'Start Workout'}
      </button>
    </div>
  );
}
