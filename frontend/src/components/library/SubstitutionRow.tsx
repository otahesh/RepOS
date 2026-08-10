import { useEffect, useState } from 'react';
import { getSubstitutions, type SubResult } from '../../lib/api/exercises.ts';
import { TOKENS } from '../../tokens';
import { Button, DataState } from '../ui';

export type SubstitutionRowProps = {
  fromSlug: string;
  plannedLoadLb?: number;
  onSelect: (slug: string) => void;
  showAll?: boolean;
};

export function SubstitutionRow({
  fromSlug,
  plannedLoadLb,
  onSelect,
  showAll = false,
}: SubstitutionRowProps) {
  const [data, setData] = useState<SubResult | null>(null);
  const [expanded, setExpanded] = useState(showAll);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setError(false);
    getSubstitutions(fromSlug)
      .then(setData)
      .catch(() => setError(true));
  }, [fromSlug, retryKey]);

  if (error)
    return (
      <DataState
        compact
        kind="error"
        title="Substitutions could not be loaded"
        body="Your current exercise remains selected."
        action={
          <Button variant="secondary" onClick={() => setRetryKey((key) => key + 1)}>
            Retry
          </Button>
        }
      />
    );

  if (!data) return <DataState compact kind="loading" title="Loading substitutions" />;

  if (data.subs.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 13,
          color: TOKENS.textDim,
          fontFamily: 'Inter Tight',
        }}
      >
        No equipment match
        {data.closest_partial && (
          <>
            {' '}
            — closest partial: <code>{data.closest_partial.name}</code>
          </>
        )}
      </div>
    );
  }

  const visible = expanded ? data.subs : data.subs.slice(0, 3);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {visible.map((s) => (
        <button
          key={s.slug}
          onClick={() => onSelect(s.slug)}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.06)',
            background: '#10141C',
            color: '#fff',
            fontFamily: 'Inter Tight',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: TOKENS.textMute }}>
              {s.reason}
            </div>
          </div>
          {plannedLoadLb !== undefined && (
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: TOKENS.textMute }}>
              {plannedLoadLb} lb
            </div>
          )}
        </button>
      ))}
      {!expanded && data.subs.length > 3 && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            padding: '6px 12px',
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
            background: 'transparent',
            border: 'none',
            color: TOKENS.textMute,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          See all {data.subs.length}
          {data.truncated ? ` of ${data.total_matches}` : ''} →
        </button>
      )}
    </div>
  );
}
