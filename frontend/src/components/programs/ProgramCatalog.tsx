// frontend/src/components/programs/ProgramCatalog.tsx
import { useEffect, useState } from 'react';
import { listProgramTemplates, type ProgramTemplate } from '../../lib/api/programs';
import { Term } from '../Term';

export type ProgramCatalogProps = {
  onPick: (slug: string) => void;
};

const TRACKS: { key: 'beginner' | 'intermediate' | 'advanced'; label: string }[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

export function ProgramCatalog({ onPick }: ProgramCatalogProps) {
  const [rows, setRows] = useState<ProgramTemplate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listProgramTemplates()
      .then(setRows)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err)
    return <div style={{ color: '#FF6A6A', padding: 16 }}>Couldn't load programs: {err}</div>;
  if (!rows) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;

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
      {TRACKS.map(({ key, label }) => {
        const group = rows.filter((t) => t.track === key);
        return (
          <section key={key}>
            <h3
              style={{
                margin: '0 0 12px',
                fontSize: 13,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.6)',
                fontFamily: 'JetBrains Mono',
              }}
            >
              {label}
            </h3>
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
                More coming — new {label} programs are on the way.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 16,
                }}
              >
                {group.map((t) => (
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
                      <h3 style={{ margin: '6px 0 0', fontSize: 18 }}>{t.name}</h3>
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
                      }}
                    >
                      {t.days_per_week} days/week
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
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
