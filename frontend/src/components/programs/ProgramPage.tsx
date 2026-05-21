import { useEffect, useMemo, useState, Fragment } from 'react';
import { getMesocycle, getVolumeRollup, type MesocycleRunDetail, type VolumeRollup } from '../../lib/api/mesocycles';
import { Term } from '../Term';

function tierColor(sets: number, mev: number, mav: number, mrv: number): string {
  if (sets < mev) return '#3D4048';
  if (sets <= mav) return '#6BE28B';
  if (sets < mrv - 1) return '#F5B544';
  return '#FF6A6A';
}

// Per-tier text color. The muted (below-MEV) tile is dark gray; pairing it
// with the same near-black text the colored tiles use gave ~1.3:1 contrast,
// well under WCAG's 4.5:1 floor, and most unfilled-future-week cells fall in
// this tier. Switch to a high-alpha white for the muted tier; the colored
// (green/amber/red) tiles stay with dark text — contrast there is fine.
function cellTextColor(sets: number, mev: number): string {
  if (sets < mev) return 'rgba(255, 255, 255, 0.92)';
  return '#0A0D12';
}

// API returns weeks: [{ week_idx, muscles: [{ muscle, sets, performed_sets,
// mev, mav, mrv }] }]. The heatmap renders by-muscle rows × by-week columns,
// so we pivot once.
function pivotByMuscle(vol: VolumeRollup): {
  muscles: string[];
  setsByMuscleByWeek: Record<string, number[]>;
  performedByMuscleByWeek: Record<string, number[]>;
  landmarks: Record<string, { mev: number; mav: number; mrv: number }>;
} {
  const setsByMuscleByWeek: Record<string, number[]> = {};
  const performedByMuscleByWeek: Record<string, number[]> = {};
  const landmarks: Record<string, { mev: number; mav: number; mrv: number }> = {};
  const totalWeeks = vol.weeks.length;
  for (const wk of vol.weeks) {
    for (const m of wk.muscles) {
      if (!setsByMuscleByWeek[m.muscle]) setsByMuscleByWeek[m.muscle] = Array(totalWeeks).fill(0);
      if (!performedByMuscleByWeek[m.muscle]) performedByMuscleByWeek[m.muscle] = Array(totalWeeks).fill(0);
      // week_idx is 1-indexed; align to 0-indexed array.
      setsByMuscleByWeek[m.muscle][wk.week_idx - 1] = m.sets;
      performedByMuscleByWeek[m.muscle][wk.week_idx - 1] = m.performed_sets;
      if (!landmarks[m.muscle]) landmarks[m.muscle] = { mev: m.mev, mav: m.mav, mrv: m.mrv };
    }
  }
  return {
    muscles: Object.keys(setsByMuscleByWeek).sort(),
    setsByMuscleByWeek,
    performedByMuscleByWeek,
    landmarks,
  };
}

/**
 * Render a heatmap cell's text. Planned-only weeks show just the planned
 * count; weeks with logged sets show "performed / planned" so the user can
 * eyeball progress at a glance. We round to whole sets for display because
 * fractional contributions read as noise in a dense grid.
 */
function cellText(planned: number, performed: number): string {
  const p = Math.round(planned);
  if (performed <= 0) return String(p);
  return `${Math.round(performed)}/${p}`;
}

export function ProgramPage({ mesocycleRunId }: { mesocycleRunId: string }) {
  const [run, setRun] = useState<MesocycleRunDetail | null>(null);
  const [vol, setVol] = useState<VolumeRollup | null>(null);
  useEffect(() => {
    getMesocycle(mesocycleRunId).then(setRun).catch(() => setRun(null));
    getVolumeRollup(mesocycleRunId).then(setVol).catch(() => setVol(null));
  }, [mesocycleRunId]);
  const pivot = useMemo(() => (vol ? pivotByMuscle(vol) : null), [vol]);
  if (!run || !vol || !pivot) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;

  const muscles = pivot.muscles;

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
          <Term k="working_set" />{' heatmap (logged / planned per week)'}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: `auto repeat(${run.weeks}, 1fr)`, gap: 4, fontFamily: 'JetBrains Mono', fontSize: 11 }}>
          <div></div>
          {Array.from({ length: run.weeks }, (_, i) => (
            <div key={`hdr-${i}`} style={{ textAlign: 'center', color: i + 1 === run.current_week ? '#4D8DFF' : 'rgba(255,255,255,0.5)' }}>
              {`W${i + 1}`}
            </div>
          ))}
          {muscles.map(m => {
            const lm = pivot.landmarks[m];
            const cells = pivot.setsByMuscleByWeek[m] ?? [];
            const performed = pivot.performedByMuscleByWeek[m] ?? [];
            return (
              <Fragment key={m}>
                <div style={{ color: 'rgba(255,255,255,0.7)' }}>{m}</div>
                {cells.map((sets, w) => {
                  const done = performed[w] ?? 0;
                  return (
                    <div
                      key={`${m}-${w}`}
                      data-testid={`heatmap-cell-${m}-w${w + 1}`}
                      title={`${m} · W${w + 1}: ${Math.round(done)} logged / ${Math.round(sets)} planned (Min Effective ${lm.mev} / Max Adaptive ${lm.mav} / Max Recoverable ${lm.mrv})`}
                      style={{
                        background: tierColor(sets, lm.mev, lm.mav, lm.mrv),
                        borderRadius: 3,
                        minHeight: 24,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: cellTextColor(sets, lm.mev),
                        fontWeight: 600,
                      }}
                    >
                      {cellText(sets, done)}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
          {'Tile color: planned tier ('}<Term k="MEV" />{' → '}<Term k="MAV" />{' → '}<Term k="MRV" />{'). Cell text: logged sets / planned sets — logged number appears once you start logging.'}
        </div>
      </section>
    </div>
  );
}
