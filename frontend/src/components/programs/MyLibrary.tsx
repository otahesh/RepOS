// frontend/src/components/programs/MyLibrary.tsx
// My Programs library — active view + Past toggle for abandoned/completed.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMyPrograms } from '../../lib/api/userPrograms';
import type { UserProgramRecord } from '../../lib/api/programs';
import { TOKENS, FONTS } from '../../tokens';
import { Term } from '../Term';

type ViewTab = 'active' | 'past';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  abandoned: 'Abandoned',
};

function statusColor(status: UserProgramRecord['status']): string {
  switch (status) {
    case 'active': return TOKENS.good;
    case 'paused': return TOKENS.warn;
    case 'completed': return TOKENS.accent;
    case 'abandoned': return TOKENS.textMute;
    default: return TOKENS.textDim;
  }
}

function ProgramCard({
  program,
  onResume,
  onOpen,
  faded,
}: {
  program: UserProgramRecord;
  onResume?: (id: string) => void;
  onOpen?: (id: string) => void;
  faded: boolean;
}) {
  return (
    <article
      style={{
        background: faded ? 'rgba(16,20,28,0.5)' : TOKENS.surface,
        border: `1px solid ${faded ? TOKENS.line : TOKENS.lineStrong}`,
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        opacity: faded ? 0.65 : 1,
        transition: 'opacity 150ms',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: TOKENS.text, fontFamily: FONTS.ui }}>
            {program.name}
          </h3>
        </div>
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: statusColor(program.status),
            border: `1px solid ${statusColor(program.status)}`,
            borderRadius: 4,
            padding: '2px 6px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {STATUS_LABEL[program.status] ?? program.status}
        </span>
      </header>

      <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: TOKENS.textMute, letterSpacing: 0.5 }}>
        {new Date(program.created_at).toLocaleDateString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
        {onOpen && (
          <button
            onClick={() => onOpen(program.id)}
            style={{
              padding: '8px 14px',
              background: TOKENS.surface3,
              border: `1px solid ${TOKENS.lineStrong}`,
              borderRadius: 6,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            View
          </button>
        )}
        {onResume && (
          <button
            onClick={() => onResume(program.id)}
            style={{
              padding: '8px 14px',
              background: TOKENS.accentGlow,
              border: `1px solid ${TOKENS.accentDim}`,
              borderRadius: 6,
              color: TOKENS.accent,
              fontFamily: FONTS.ui,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            Restart
          </button>
        )}
      </div>
    </article>
  );
}

export function MyLibrary({ onRestartProgram }: { onRestartProgram: (templateSlug: string) => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ViewTab>('active');
  const [programs, setPrograms] = useState<UserProgramRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setPrograms(null);
    setErr(null);
    listMyPrograms({ includePast: tab === 'past' })
      .then((rows) => { if (!ignore) setPrograms(rows); })
      .catch((e) => { if (!ignore) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { ignore = true; };
  }, [tab]);

  // Filter client-side so a tab switch doesn't flash stale data while loading
  const filtered = programs?.filter((p) =>
    tab === 'past'
      ? p.status === 'abandoned' || p.status === 'completed'
      : p.status !== 'abandoned' && p.status !== 'completed' && p.status !== 'archived',
  ) ?? null;

  function handleOpen(_id: string) {
    // Active program → live workout page.
    navigate('/today');
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px',
    border: 'none',
    borderRadius: 6,
    fontFamily: FONTS.ui,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    background: active ? TOKENS.surface3 : 'transparent',
    color: active ? TOKENS.text : TOKENS.textDim,
    borderBottom: active ? `2px solid ${TOKENS.accent}` : '2px solid transparent',
  });

  return (
    <section style={{ padding: '0 0 24px', fontFamily: FONTS.ui }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: TOKENS.text, letterSpacing: -0.3 }}>
          My Programs
        </h2>
        <div style={{ display: 'flex', gap: 2, background: TOKENS.surface, border: `1px solid ${TOKENS.line}`, borderRadius: 8, padding: 3 }}>
          <button style={tabStyle(tab === 'active')} onClick={() => setTab('active')}>
            Active
          </button>
          <button style={tabStyle(tab === 'past')} onClick={() => setTab('past')}>
            Past
          </button>
        </div>
      </div>

      {err && (
        <div style={{ color: TOKENS.danger, fontSize: 13, padding: '8px 0' }}>
          Couldn't load programs: {err}
        </div>
      )}

      {!err && !filtered && (
        <div style={{ color: TOKENS.textDim, fontSize: 13 }}>Loading…</div>
      )}

      {!err && filtered && filtered.length === 0 && (
        <div style={{ color: TOKENS.textMute, fontSize: 13, padding: '16px 0' }}>
          {tab === 'past'
            ? 'No past programs yet. Abandoned or completed programs appear here.'
            : <>No active programs. Pick a <Term k="mesocycle" /> template below to get started.</>}
        </div>
      )}

      {!err && filtered && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {filtered.map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              faded={tab === 'past'}
              onOpen={tab === 'active' ? handleOpen : undefined}
              onResume={tab === 'past' && p.template_slug
                ? () => onRestartProgram(p.template_slug!)
                : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
