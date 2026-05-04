import { useEffect, useState } from 'react';
import { getSubstitutions, type SubResult } from '../../lib/api/exercises.ts';

export type SubstitutionRowProps = {
  fromSlug: string;
  plannedLoadLb?: number;
  onSelect: (slug: string) => void;
  showAll?: boolean;
};

export function SubstitutionRow({ fromSlug, plannedLoadLb, onSelect, showAll = false }: SubstitutionRowProps) {
  const [data, setData] = useState<SubResult | null>(null);
  const [expanded, setExpanded] = useState(showAll);

  useEffect(() => { getSubstitutions(fromSlug).then(setData).catch(() => setData(null)); }, [fromSlug]);

  if (!data) return null;

  if (data.subs.length === 0) {
    return (
      <div style={{ padding: 12, fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter Tight' }}>
        No equipment match{data.closest_partial && <> — closest partial: <code>{data.closest_partial.name}</code></>}
      </div>
    );
  }

  const visible = expanded ? data.subs : data.subs.slice(0, 3);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {visible.map(s => (
        <button key={s.slug}
          onClick={() => onSelect(s.slug)}
          style={{
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 8,
            padding: '10px 12px', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.06)', background: '#10141C', color: '#fff',
            fontFamily: 'Inter Tight', cursor: 'pointer', textAlign: 'left',
          }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
              {s.reason}
            </div>
          </div>
          {plannedLoadLb !== undefined && (
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              {plannedLoadLb} lb
            </div>
          )}
        </button>
      ))}
      {!expanded && data.subs.length > 3 && (
        <button onClick={() => setExpanded(true)}
          style={{
            padding: '6px 12px', fontFamily: 'JetBrains Mono', fontSize: 11,
            background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer', textAlign: 'left',
          }}>
          See all {data.subs.length}{data.truncated ? ` of ${data.total_matches}` : ''} →
        </button>
      )}
    </div>
  );
}
