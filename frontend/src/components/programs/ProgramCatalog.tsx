// frontend/src/components/programs/ProgramCatalog.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listProgramTemplates,
  extractEquipment,
  type ProgramTemplate,
} from '../../lib/api/programs';
import { PROGRAM_TRACKS, TRACK_META, type ProgramTrack } from '../../lib/programTracks';
import { Term } from '../Term';

export type ProgramCatalogProps = {
  onPick: (slug: string) => void;
  /** Scope the catalog to a single track (e.g. from a `?track=` deep link off
   *  a template's track badge). Omit for the default full-catalog view. */
  initialTrack?: ProgramTrack;
};

export function ProgramCatalog({ onPick, initialTrack }: ProgramCatalogProps) {
  const [rows, setRows] = useState<ProgramTemplate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    listProgramTemplates(initialTrack)
      .then(setRows)
      .catch((e) => setErr(String(e)));
  }, [initialTrack]);

  if (err)
    return <div style={{ color: '#FF6A6A', padding: 16 }}>Couldn't load programs: {err}</div>;
  if (!rows) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;

  const tracks = initialTrack ? [initialTrack] : PROGRAM_TRACKS;

  return (
    <div
      style={{
        padding: 16,
        fontFamily: 'Inter Tight',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
      }}
    >
      {initialTrack && (
        <Link
          to="/programs"
          style={{
            fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
            textDecoration: 'none',
            fontFamily: 'JetBrains Mono',
          }}
        >
          ← All tracks
        </Link>
      )}
      {tracks.map((key) => {
        const meta = TRACK_META[key];
        const group = rows.filter((t) => t.track === key);
        return (
          <section key={key}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: meta.color,
                  flexShrink: 0,
                }}
              />
              <h3
                style={{
                  margin: 0,
                  fontSize: 13,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.85)',
                  fontFamily: 'JetBrains Mono',
                }}
              >
                {meta.label}
              </h3>
            </div>
            <p style={{ margin: '4px 0 12px 16px', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              {meta.blurb}
            </p>
            {group.length === 0 ? (
              <div
                style={{
                  padding: 20,
                  background: '#10141C',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: 13,
                }}
              >
                More coming — new {meta.label} programs are on the way.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 16,
                }}
              >
                {group.map((t) => {
                  const equipment = extractEquipment(t.description);
                  return (
                    <article
                      key={t.slug}
                      style={{
                        background: '#10141C',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 12,
                        padding: 20,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        color: '#fff',
                      }}
                    >
                      <header>
                        <div
                          style={{
                            fontFamily: 'JetBrains Mono',
                            fontSize: 11,
                            letterSpacing: 1,
                            color: '#4D8DFF',
                            textTransform: 'uppercase',
                          }}
                        >
                          {t.weeks}-week <Term k="mesocycle" />
                        </div>
                        <h4 style={{ margin: '6px 0 0', fontSize: 18 }}>{t.name}</h4>
                      </header>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          color: 'rgba(255,255,255,0.7)',
                          lineHeight: 1.4,
                        }}
                      >
                        {t.description}
                      </p>
                      <div
                        style={{
                          fontFamily: 'JetBrains Mono',
                          fontSize: 11,
                          color: 'rgba(255,255,255,0.5)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span>{t.days_per_week} days/week</span>
                        {equipment && (
                          <span style={{ color: 'rgba(255,255,255,0.4)' }}>
                            Equipment: {equipment}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => onPick(t.slug)}
                        style={{
                          marginTop: 'auto',
                          padding: '10px 14px',
                          background: '#4D8DFF',
                          border: 'none',
                          borderRadius: 6,
                          color: '#fff',
                          fontFamily: 'Inter Tight',
                          fontWeight: 600,
                          letterSpacing: 1,
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                        }}
                      >
                        Customize & Fork
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
