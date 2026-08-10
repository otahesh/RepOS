import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import {
  getMesocycle,
  getVolumeRollup,
  type MesocycleRunDetail,
  type VolumeRollup,
} from '../../lib/api/mesocycles';
import { Term } from '../Term';
import { useIsMobile } from '../../lib/useIsMobile';
import { Button, Card, DataState, StatusBadge } from '../ui';
import { FONTS, TOKENS } from '../../tokens';

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
      if (!performedByMuscleByWeek[m.muscle])
        performedByMuscleByWeek[m.muscle] = Array(totalWeeks).fill(0);
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
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const isMobile = useIsMobile();

  useEffect(() => {
    let ignore = false;
    setError(false);
    Promise.all([getMesocycle(mesocycleRunId), getVolumeRollup(mesocycleRunId)])
      .then(([nextRun, nextVol]) => {
        if (ignore) return;
        setRun(nextRun);
        setVol(nextVol);
      })
      .catch(() => {
        if (!ignore) setError(true);
      });
    return () => {
      ignore = true;
    };
  }, [mesocycleRunId, retryKey]);
  const pivot = useMemo(() => (vol ? pivotByMuscle(vol) : null), [vol]);
  const retry = useCallback(() => {
    setRun(null);
    setVol(null);
    setRetryKey((key) => key + 1);
  }, []);

  if (error)
    return (
      <DataState
        kind="error"
        title="Program progress could not be loaded"
        body="Your program and logged sets were not changed."
        action={
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        }
      />
    );
  if (!run || !vol || !pivot) return <DataState kind="loading" title="Loading program progress" />;

  const muscles = pivot.muscles;

  return (
    <Card style={{ padding: isMobile ? 16 : 24, display: 'grid', gap: 24 }}>
      <header>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            letterSpacing: 1,
            color: TOKENS.accent,
            textTransform: 'uppercase',
          }}
        >
          {'Active '}
          <Term k="mesocycle" />
          {' · Week '}
          {run.current_week}
          {' of '}
          {run.weeks}
        </div>
        <h2 style={{ margin: '8px 0 0', fontSize: 22 }}>
          <Term k="mesocycle">Mesocycle</Term>
          {' Run'}
        </h2>
      </header>

      <section>
        <h3 style={{ marginTop: 0, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
          <Term k="working_set" />
          {' heatmap (logged / planned per week)'}
        </h3>
        {isMobile ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {muscles.map((muscle) => {
              const lm = pivot.landmarks[muscle];
              const cells = pivot.setsByMuscleByWeek[muscle] ?? [];
              const performed = pivot.performedByMuscleByWeek[muscle] ?? [];
              return (
                <div key={muscle} className="repos-data-card" data-testid={`heatmap-row-${muscle}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <strong style={{ textTransform: 'capitalize' }}>{muscle}</strong>
                    <StatusBadge tone="neutral">
                      <Term k="MEV" variant="abbr" /> {lm.mev} · <Term k="MAV" variant="abbr" />{' '}
                      {lm.mav} · <Term k="MRV" variant="abbr" /> {lm.mrv}
                    </StatusBadge>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${run.weeks}, 1fr)`,
                      gap: 5,
                    }}
                  >
                    {cells.map((sets, week) => {
                      const done = performed[week] ?? 0;
                      const description = `${muscle}, week ${week + 1}: ${Math.round(done)} logged of ${Math.round(sets)} planned. Min Effective ${lm.mev}, Max Adaptive ${lm.mav}, Max Recoverable ${lm.mrv}.`;
                      return (
                        <div key={week} style={{ display: 'grid', gap: 4, textAlign: 'center' }}>
                          <span
                            style={{
                              color:
                                week + 1 === run.current_week ? TOKENS.accent : TOKENS.textMute,
                              fontFamily: FONTS.mono,
                              fontSize: 9,
                            }}
                          >
                            W{week + 1}
                          </span>
                          <div
                            data-testid={`heatmap-cell-${muscle}-w${week + 1}`}
                            aria-label={description}
                            tabIndex={0}
                            style={{
                              background: tierColor(sets, lm.mev, lm.mav, lm.mrv),
                              borderRadius: 5,
                              minHeight: 44,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: cellTextColor(sets, lm.mev),
                              fontFamily: FONTS.mono,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {cellText(sets, done)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `auto repeat(${run.weeks}, 1fr)`,
              gap: 4,
              fontFamily: FONTS.mono,
              fontSize: 11,
            }}
          >
            <div></div>
            {Array.from({ length: run.weeks }, (_, i) => (
              <div
                key={`hdr-${i}`}
                style={{
                  textAlign: 'center',
                  color: i + 1 === run.current_week ? TOKENS.accent : TOKENS.textMute,
                }}
              >
                {`W${i + 1}`}
              </div>
            ))}
            {muscles.map((m) => {
              const lm = pivot.landmarks[m];
              const cells = pivot.setsByMuscleByWeek[m] ?? [];
              const performed = pivot.performedByMuscleByWeek[m] ?? [];
              return (
                <Fragment key={m}>
                  <div data-testid={`heatmap-row-${m}`} style={{ color: TOKENS.textDim }}>
                    {m}
                  </div>
                  {cells.map((sets, w) => {
                    const done = performed[w] ?? 0;
                    // Hidden description region keyed via aria-describedby so
                    // screen readers and AT can surface the full landmarks
                    // context. The native `title` is retained for sighted-pointer
                    // hover, but is hidden from most ATs and untouchable on
                    // touch devices.
                    const describeId = `heatmap-${m}-w${w + 1}-desc`;
                    const description = `${m}, week ${w + 1}: ${Math.round(done)} logged of ${Math.round(sets)} planned. Min Effective ${lm.mev}, Max Adaptive ${lm.mav}, Max Recoverable ${lm.mrv}.`;
                    return (
                      <div
                        key={`${m}-${w}`}
                        data-testid={`heatmap-cell-${m}-w${w + 1}`}
                        aria-describedby={describeId}
                        title={description}
                        tabIndex={0}
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
                        <span
                          id={describeId}
                          style={{
                            position: 'absolute',
                            width: 1,
                            height: 1,
                            padding: 0,
                            margin: -1,
                            overflow: 'hidden',
                            clip: 'rect(0,0,0,0)',
                            whiteSpace: 'nowrap',
                            border: 0,
                          }}
                        >
                          {description}
                        </span>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 11, color: TOKENS.textDim }}>
          {'Tile color: planned tier ('}
          <Term k="MEV" />
          {' → '}
          <Term k="MAV" />
          {' → '}
          <Term k="MRV" />
          {
            '). Cell text: logged sets / planned sets — logged number appears once you start logging.'
          }
        </div>
      </section>
    </Card>
  );
}
