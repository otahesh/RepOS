import { useCallback, useEffect, useState } from 'react';
import {
  listProgramTemplates,
  extractEquipment,
  type ProgramTemplate,
} from '../../lib/api/programs';
import { PROGRAM_TRACKS, TRACK_META, type ProgramTrack } from '../../lib/programTracks';
import { FONTS, TOKENS } from '../../tokens';
import { Button, DataState, SegmentedControl, SkeletonCards, StatusBadge } from '../ui';

export type ProgramCatalogProps = {
  onPick: (slug: string) => void;
  initialTrack?: ProgramTrack;
};

type TrackFilter = 'all' | ProgramTrack;

const FILTERS: ReadonlyArray<{ value: TrackFilter; label: string }> = [
  { value: 'all', label: 'All levels' },
  ...PROGRAM_TRACKS.map((track) => ({ value: track, label: TRACK_META[track].label })),
];

export function ProgramCatalog({ onPick, initialTrack }: ProgramCatalogProps) {
  const [track, setTrack] = useState<TrackFilter>(initialTrack ?? 'all');
  const [rows, setRows] = useState<ProgramTemplate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const load = useCallback(() => {
    setRows(null);
    setErr(null);
    listProgramTemplates(track === 'all' ? undefined : track)
      .then(setRows)
      .catch(() => setErr('Templates could not be refreshed. Your program library is unchanged.'));
  }, [track]);

  useEffect(() => {
    load();
  }, [load, retryKey]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SegmentedControl
        label="Experience level"
        value={track}
        options={FILTERS}
        onChange={setTrack}
      />

      {err ? (
        <DataState
          kind="error"
          title="Templates could not be loaded"
          body={err}
          action={
            <Button variant="secondary" onClick={() => setRetryKey((key) => key + 1)}>
              Retry
            </Button>
          }
        />
      ) : rows === null ? (
        <SkeletonCards />
      ) : rows.length === 0 ? (
        <DataState
          title={`No ${track === 'all' ? '' : TRACK_META[track].label.toLowerCase() + ' '}templates yet`}
          body="New programs will appear here as they become available. You can still build and customize a program on this device."
        />
      ) : (
        <div className="repos-grid-3" data-testid="program-template-grid">
          {rows.map((template) => (
            <TemplateCard key={template.slug} template={template} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onPick,
}: {
  template: ProgramTemplate;
  onPick: (slug: string) => void;
}) {
  const equipment = extractEquipment(template.description);
  const meta = TRACK_META[template.track];
  const description = template.description.replace(/\s*Equipment minimum:[^.]+\.?/i, '').trim();
  const tone =
    template.track === 'beginner'
      ? ('good' as const)
      : template.track === 'advanced'
        ? ('warning' as const)
        : ('accent' as const);

  return (
    <article
      className="repos-card repos-card--interactive"
      style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 248 }}
    >
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <StatusBadge tone={tone}>{meta.label}</StatusBadge>
          <span
            style={{
              fontFamily: FONTS.mono,
              color: TOKENS.textMute,
              fontSize: 10,
              letterSpacing: 0.6,
            }}
          >
            {template.weeks} weeks
          </span>
        </div>
        <h3 style={{ margin: '12px 0 0', fontSize: 18, color: TOKENS.text, lineHeight: 1.2 }}>
          {template.name}
        </h3>
      </header>

      <p style={{ margin: 0, color: TOKENS.textDim, fontSize: 13, lineHeight: 1.45 }}>
        {description || meta.blurb}
      </p>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          gap: '5px 10px',
          margin: 'auto 0 0',
          color: TOKENS.textDim,
          fontFamily: FONTS.mono,
          fontSize: 10,
        }}
      >
        <dt>Schedule</dt>
        <dd style={{ margin: 0, color: TOKENS.text }}>{template.days_per_week} days / week</dd>
        <dt>Equipment</dt>
        <dd style={{ margin: 0, color: TOKENS.text }}>{equipment ?? 'See program details'}</dd>
      </dl>

      <Button variant="primary" onClick={() => onPick(template.slug)}>
        Customize program
      </Button>
    </article>
  );
}
