// frontend/src/components/programs/ProgramTemplateDetail.tsx
import { useCallback, useEffect, useState } from 'react';
import { rpeFromRir, rowMode } from '../../lib/effort';
import { getProgramTemplate, type ProgramTemplate } from '../../lib/api/programs';
import { Term } from '../Term';
import { TrackChip } from './TrackChip';
import { isBeginnerTrack, effortCue } from '../../lib/programTracks';
import { Button, DataState, Page, PageHeader } from '../ui';
import { TOKENS } from '../../tokens';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function exerciseLabel(slug: string): string {
  return slug.replace(/-/g, ' ');
}

export function ProgramTemplateDetail({
  slug,
  onFork,
}: {
  slug: string;
  onFork: (slug: string, template: ProgramTemplate) => void;
}) {
  const [t, setT] = useState<ProgramTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const load = useCallback(() => {
    setT(null);
    setError(null);
    getProgramTemplate(slug)
      .then(setT)
      .catch(() => setError('This template could not be refreshed. Try again.'));
  }, [slug]);

  useEffect(() => {
    load();
  }, [load, retryKey]);
  if (error) {
    return (
      <Page width="wide">
        <DataState
          kind="error"
          title="Template could not be loaded"
          body={error}
          action={
            <Button variant="secondary" onClick={() => setRetryKey((key) => key + 1)}>
              Retry
            </Button>
          }
        />
      </Page>
    );
  }
  if (!t)
    return (
      <Page width="wide">
        <DataState kind="loading" title="Loading program template" />
      </Page>
    );
  const days = t.structure?.days ?? [];
  return (
    <Page width="data" style={{ fontFamily: 'Inter Tight', color: '#fff' }}>
      <PageHeader
        eyebrow={
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>
              {t.weeks}-week <Term k="mesocycle" /> · {t.days_per_week} days/wk
            </span>
            <TrackChip track={t.track} />
          </span>
        }
        title={t.name}
        description={t.description}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {days.map((d) => (
          <div
            key={d.idx}
            style={{
              background: '#10141C',
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                fontFamily: 'JetBrains Mono',
                fontSize: 10,
                color: 'rgba(255,255,255,0.5)',
                marginBottom: 4,
              }}
            >
              {WEEKDAYS[d.day_offset] ?? `+${d.day_offset}d`} · {d.kind}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{d.name}</div>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {d.blocks.map((b, i) => (
                <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                  {exerciseLabel(b.exercise_slug)}{' '}
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono',
                      fontSize: 10,
                      color: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    {isBeginnerTrack(t.track) ? (
                      <>
                        {b.mev} sets, building to {b.mav} ·{' '}
                        {b.target_duration_low_sec != null ? (
                          <>
                            {b.target_duration_low_sec}–{b.target_duration_high_sec}s{' '}
                            <Term k="hold" /> ·{' '}
                          </>
                        ) : (
                          <>
                            {b.target_reps_low}–{b.target_reps_high} reps ·{' '}
                          </>
                        )}
                        {effortCue(b.target_rir, rowMode(b))}
                      </>
                    ) : b.target_duration_low_sec != null ? (
                      <>
                        {b.mev}–{b.mav} sets · {b.target_duration_low_sec}–
                        {b.target_duration_high_sec}s <Term k="hold" /> · <Term k="RPE" />{' '}
                        {rpeFromRir(b.target_rir)}
                      </>
                    ) : (
                      <>
                        {b.mev}–{b.mav} sets · {b.target_reps_low}–{b.target_reps_high} reps ·{' '}
                        <Term k="RIR" /> {b.target_rir}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="repos-sticky-actions">
        <Button variant="primary" onClick={() => onFork(t.slug, t)}>
          Customize this program
        </Button>
      </div>
    </Page>
  );
}
