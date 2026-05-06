// frontend/src/components/programs/ForkWizard.tsx
import { useEffect, useState } from 'react';
import { getUserProgram, getUserProgramWarnings, patchUserProgram, startUserProgram, type UserProgramDetail } from '../../lib/api/userPrograms';
import { Term } from '../Term';
import { DayCard } from './DayCard';
import { ScheduleWarnings, type ScheduleWarning } from './ScheduleWarnings';

export function ForkWizard({ userProgramId, onStarted }: { userProgramId: string; onStarted: (mesocycleRunId: string) => void }) {
  const [up, setUp] = useState<UserProgramDetail | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([]);

  useEffect(() => {
    getUserProgram(userProgramId).then(p => { setUp(p); setName(p.name); }).catch(e => setErr(String(e)));
    getUserProgramWarnings(userProgramId).then(setWarnings).catch(() => setWarnings([]));
  }, [userProgramId]);

  if (err) return <div style={{ color: '#FF6A6A', padding: 16 }}>Couldn't load: {err}</div>;
  if (!up) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;

  async function saveName() {
    if (!up) return;
    setSaving(true);
    try {
      await patchUserProgram(up.id, { name });
      getUserProgramWarnings(up.id).then(setWarnings).catch(() => setWarnings([]));
    }
    catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }

  async function start() {
    if (!up) return;
    setSaving(true);
    try {
      const { mesocycle_run_id } = await startUserProgram(up.id, {
        start_date: new Date().toISOString().slice(0, 10),
        start_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      onStarted(mesocycle_run_id);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'Inter Tight', color: '#fff', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 1, color: '#4D8DFF', textTransform: 'uppercase' }}>
          Customize before <Term k="mesocycle" /> start
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 4 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Program name</span>
            <input
              aria-label="Program name"
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ padding: '8px 12px', background: '#0A0D12', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', fontFamily: 'Inter Tight', fontSize: 14 }}
            />
          </label>
          <button
            onClick={saveName}
            disabled={saving || name === up.name}
            style={{ padding: '8px 14px', background: '#10141C', border: '1px solid rgba(77,141,255,0.5)', borderRadius: 6, color: '#4D8DFF', cursor: 'pointer', alignSelf: 'flex-end' }}
          >
            Save name
          </button>
        </div>
      </header>

      <section>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Days</h3>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${up.structure.days.length}, 1fr)`, gap: 12 }}>
          {up.structure.days.map(d => (
            <DayCard
              key={d.idx}
              day={d}
              onAddSet={(dayIdx, blockIdx) => patchUserProgram(up.id, { add_set: { day_idx: dayIdx, block_idx: blockIdx } })}
              onRemoveSet={(dayIdx, blockIdx, setIdx) => patchUserProgram(up.id, { remove_set: { day_idx: dayIdx, block_idx: blockIdx, set_idx: setIdx } })}
              onSwap={(_dayIdx, _blockIdx) => { /* TODO: open exercise picker */ }}
            />
          ))}
        </div>
      </section>

      <ScheduleWarnings warnings={warnings} />

      {(() => {
        const hasBlock = warnings.some(w => w.severity === 'block');
        return (
          <button
            onClick={start}
            disabled={saving || hasBlock}
            style={{ padding: '14px 22px', background: '#4D8DFF', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', alignSelf: 'flex-start' }}
          >
            {'Start Mesocycle'}
          </button>
        );
      })()}
      {err ? <div style={{ color: '#FF6A6A', fontSize: 13 }}>{err}</div> : null}
    </div>
  );
}
