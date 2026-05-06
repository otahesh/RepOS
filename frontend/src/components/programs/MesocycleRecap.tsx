import { Term } from '../Term';

export type RecapChoice = 'deload' | 'run_it_back' | 'new_program';

export function MesocycleRecap({
  stats,
  onChoice,
}: {
  stats: { weeks: number; total_sets: number; prs: number };
  onChoice: (c: RecapChoice) => void;
}) {
  return (
    <div style={{ padding: 32, fontFamily: 'Inter Tight', color: '#fff', maxWidth: 720, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 1, color: '#4D8DFF', textTransform: 'uppercase' }}>
          <Term k="mesocycle" />{' complete'}
        </div>
        <h1 style={{ margin: '8px 0', fontSize: 28 }}>Solid block.</h1>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
          {stats.weeks}{' weeks · '}{stats.total_sets}{' '}<Term k="working_set" compact />{'s · '}{stats.prs}{' PR'}{stats.prs === 1 ? '' : 's'}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <Choice
          accent="#6BE28B"
          recommended
          label={'Take a deload'}
          desc={<>{'One light week to clear fatigue, then a fresh ramp. Recommended after a hard '}{'mesocycle'}{'.'}</>}
          onClick={() => onChoice('deload')}
        />
        <Choice
          accent="#4D8DFF"
          label="Run it back"
          desc={<>{'Same program, adjusted weights. Good if last block clicked.'}</>}
          onClick={() => onChoice('run_it_back')}
        />
        <Choice
          accent="#F5B544"
          label="New program"
          desc={<>{'Pick a new template from the catalog.'}</>}
          onClick={() => onChoice('new_program')}
        />
      </div>
    </div>
  );
}

function Choice({ accent, recommended, label, desc, onClick }: { accent: string; recommended?: boolean; label: string; desc: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: '#10141C',
        border: `1px solid ${recommended ? accent : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 12,
        padding: 20,
        textAlign: 'left',
        color: '#fff',
        fontFamily: 'Inter Tight',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {recommended ? (
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: 1, color: accent, textTransform: 'uppercase' }}>
          Recommended
        </div>
      ) : null}
      <div style={{ fontWeight: 600, fontSize: 16 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}
