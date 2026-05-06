// frontend/src/components/programs/ProgramTemplateDetail.tsx
import { useEffect, useState } from 'react';
import { getProgramTemplate, type ProgramTemplate } from '../../lib/api/programs';
import { Term } from '../Term';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function exerciseLabel(slug: string): string {
  return slug.replace(/-/g, ' ');
}

export function ProgramTemplateDetail({ slug, onFork }: { slug: string; onFork: (slug: string) => void }) {
  const [t, setT] = useState<ProgramTemplate | null>(null);
  useEffect(() => { getProgramTemplate(slug).then(setT).catch(() => setT(null)); }, [slug]);
  if (!t) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;
  const days = t.structure?.days ?? [];
  return (
    <div style={{ padding: 24, fontFamily: 'Inter Tight', color: '#fff' }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 1, color: '#4D8DFF', textTransform: 'uppercase' }}>
          {t.weeks}-week <Term k="mesocycle" /> · {t.days_per_week} days/wk
        </div>
        <h2 style={{ margin: '8px 0 4px', fontSize: 22 }}>{t.name}</h2>
        <p style={{ margin: 0, color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>{t.description}</p>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 12, marginBottom: 16 }}>
        {days.map(d => (
          <div key={d.idx} style={{ background: '#10141C', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>
              {WEEKDAYS[d.day_offset] ?? `+${d.day_offset}d`} · {d.kind}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{d.name}</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {d.blocks.map((b, i) => (
                <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                  {exerciseLabel(b.exercise_slug)}{' '}
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                    {b.mev}–{b.mav} sets · {b.target_reps_low}–{b.target_reps_high} reps · <Term k="RIR" /> {b.target_rir}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <button
        onClick={() => onFork(t.slug)}
        style={{ padding: '12px 20px', background: '#4D8DFF', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}
      >
        Fork & Customize
      </button>
    </div>
  );
}
