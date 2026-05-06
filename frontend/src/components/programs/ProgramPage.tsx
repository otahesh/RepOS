import { useEffect, useState, Fragment } from 'react';
import { getMesocycle, getVolumeRollup, type MesocycleRunDetail, type VolumeRollup } from '../../lib/api/mesocycles';
import { Term } from '../Term';

function tierColor(sets: number, mev: number, mav: number, mrv: number): string {
  if (sets < mev) return '#3D4048';
  if (sets <= mav) return '#6BE28B';
  if (sets < mrv - 1) return '#F5B544';
  return '#FF6A6A';
}

export function ProgramPage({ mesocycleRunId }: { mesocycleRunId: string }) {
  const [run, setRun] = useState<MesocycleRunDetail | null>(null);
  const [vol, setVol] = useState<VolumeRollup | null>(null);
  useEffect(() => {
    getMesocycle(mesocycleRunId).then(setRun).catch(() => setRun(null));
    getVolumeRollup(mesocycleRunId).then(setVol).catch(() => setVol(null));
  }, [mesocycleRunId]);
  if (!run || !vol) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;

  const muscles = Object.keys(vol.sets_by_week_by_muscle).sort();

  return (
    <div style={{ padding: 24, fontFamily: 'Inter Tight', color: '#fff', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 1, color: '#4D8DFF', textTransform: 'uppercase' }}>
          {'Active '}<Term k="mesocycle" />{' · Week '}{run.current_week}{' of '}{run.weeks}
        </div>
        <h2 style={{ margin: '8px 0', fontSize: 22 }}><Term k="mesocycle">Mesocycle</Term>{' Run'}</h2>
      </header>

      <section>
        <h3 style={{ marginTop: 0, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
          {'Planned '}<Term k="working_set" />{' heatmap (sets/week per muscle)'}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: `auto repeat(${run.weeks}, 1fr)`, gap: 4, fontFamily: 'JetBrains Mono', fontSize: 11 }}>
          <div></div>
          {Array.from({ length: run.weeks }, (_, i) => (
            <div key={`hdr-${i}`} style={{ textAlign: 'center', color: i + 1 === run.current_week ? '#4D8DFF' : 'rgba(255,255,255,0.5)' }}>
              {`W${i + 1}`}
            </div>
          ))}
          {muscles.map(m => {
            const lm = vol.landmarks[m];
            const cells = vol.sets_by_week_by_muscle[m] ?? [];
            return (
              <Fragment key={m}>
                <div style={{ color: 'rgba(255,255,255,0.7)' }}>{m}</div>
                {cells.map((sets, w) => (
                  <div
                    key={`${m}-${w}`}
                    title={`${m} · W${w + 1}: ${sets} sets (MEV ${lm.mev} / MAV ${lm.mav} / MRV ${lm.mrv})`}
                    style={{
                      background: tierColor(sets, lm.mev, lm.mav, lm.mrv),
                      borderRadius: 3,
                      minHeight: 24,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#0A0D12',
                      fontWeight: 600,
                    }}
                  >
                    {sets}
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
          {'Tiers: '}<Term k="MEV" />{' → '}<Term k="MAV" />{' → '}<Term k="MRV" />{' with deload final week.'}
        </div>
      </section>
    </div>
  );
}
