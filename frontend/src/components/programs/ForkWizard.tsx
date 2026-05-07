// frontend/src/components/programs/ForkWizard.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getUserProgram, getUserProgramWarnings, patchUserProgram, startUserProgram,
  type UserProgramDetail,
  ApiError,
} from '../../lib/api/userPrograms';
import { getTodayWorkout, abandonMesocycle, type TodayWorkoutResponse } from '../../lib/api/mesocycles';
import { Term } from '../Term';
import { DayCard } from './DayCard';
import { ScheduleWarnings, type ScheduleWarning } from './ScheduleWarnings';

type ConflictState = { runId: string } | null;

export function ForkWizard({ userProgramId, onStarted }: { userProgramId: string; onStarted: (mesocycleRunId: string) => void }) {
  const navigate = useNavigate();
  const [up, setUp] = useState<UserProgramDetail | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([]);
  const [conflict, setConflict] = useState<ConflictState>(null);
  const [refork, setRefork] = useState<{ latestVersion: number } | null>(null);
  const [abandoning, setAbandoning] = useState(false);

  useEffect(() => {
    getUserProgram(userProgramId).then(p => { setUp(p); setName(p.name); }).catch(e => setErr(e instanceof Error ? e.message : String(e)));
    getUserProgramWarnings(userProgramId).then(setWarnings).catch(() => setWarnings([]));
    refreshActiveRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProgramId]);

  function readActiveRun(today: TodayWorkoutResponse): ConflictState {
    return today.state === 'no_active_run' ? null : { runId: today.run_id };
  }

  async function refreshActiveRun() {
    try {
      const today = await getTodayWorkout();
      setConflict(readActiveRun(today));
    } catch { /* non-fatal — pre-check is best-effort, server still enforces */ }
  }

  if (err) return <div style={{ color: '#FF6A6A', padding: 16 }}>Couldn't load: {err}</div>;
  if (!up) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;

  async function saveName() {
    if (!up) return;
    setSaving(true);
    try {
      await patchUserProgram(up.id, { op: 'rename', name });
      getUserProgramWarnings(up.id).then(setWarnings).catch(() => setWarnings([]));
    }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function start() {
    if (!up) return;
    setSaving(true);
    setErr(null);
    try {
      const { mesocycle_run_id } = await startUserProgram(up.id, {
        start_date: new Date().toISOString().slice(0, 10),
        start_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      onStarted(mesocycle_run_id);
    } catch (e: unknown) {
      // 409s are expected: pre-check is best-effort and a different tab/race
      // can produce a stale conflict. Parse the structured body so the UI can
      // route the user to the right action instead of dumping a raw HTTP blob.
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string; latest_version?: number } | undefined;
        if (body?.error === 'active_run_exists') {
          // Re-pull today so the conflict banner has the current run_id.
          await refreshActiveRun();
        } else if (body?.error === 'template_outdated' && typeof body.latest_version === 'number') {
          setRefork({ latestVersion: body.latest_version });
        } else {
          setErr(e.message);
        }
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
    finally { setSaving(false); }
  }

  async function abandonActiveRun() {
    if (!conflict) return;
    setAbandoning(true);
    setErr(null);
    try {
      await abandonMesocycle(conflict.runId);
      setConflict(null);
    } catch (e: unknown) {
      // Tab/race: another tab abandoned this run between pre-check and our
      // POST. Treat as success — refresh today and clear the banner.
      if (e instanceof ApiError && e.status === 409) {
        await refreshActiveRun();
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally { setAbandoning(false); }
  }

  const hasBlock = warnings.some(w => w.severity === 'block');
  const startDisabled = saving || hasBlock || !!conflict || !!refork;

  return (
    <div style={{ padding: 24, fontFamily: 'Inter Tight', color: '#fff', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {conflict ? (
        <div
          role="alert"
          style={{
            padding: 16, borderRadius: 8,
            background: 'rgba(245, 181, 68, 0.08)',
            border: '1px solid rgba(245, 181, 68, 0.4)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}
        >
          <div style={{ fontSize: 14, color: '#F5B544', fontWeight: 600 }}>
            You already have an active <Term k="mesocycle" />.
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
            Only one can be active at a time. Open it in Today to confirm what's running, then come back to abandon if you want this fork to take its place.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/')}
              style={{ padding: '8px 14px', background: '#10141C', border: '1px solid rgba(77,141,255,0.5)', borderRadius: 6, color: '#4D8DFF', cursor: 'pointer' }}
            >
              View today's workout
            </button>
            <button
              onClick={abandonActiveRun}
              disabled={abandoning}
              style={{ padding: '8px 14px', background: '#10141C', border: '1px solid rgba(255,106,106,0.5)', borderRadius: 6, color: '#FF6A6A', cursor: abandoning ? 'wait' : 'pointer' }}
            >
              {abandoning ? 'Abandoning…' : 'Abandon current mesocycle'}
            </button>
          </div>
        </div>
      ) : null}

      {refork ? (
        <div
          role="alert"
          style={{
            padding: 16, borderRadius: 8,
            background: 'rgba(255,106,106,0.08)',
            border: '1px solid rgba(255,106,106,0.4)',
            fontSize: 13, color: 'rgba(255,255,255,0.85)',
          }}
        >
          The template was updated to version {refork.latestVersion} since you forked it.
          Re-fork from the catalog to pick up the latest version before starting.
        </div>
      ) : null}

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
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`, gap: 12 }}>
          {up.effective_structure.days.map(d => (
            <DayCard
              key={d.idx}
              day={d}
              onAddSet={(dayIdx, blockIdx) => patchUserProgram(up.id, { op: 'add_set', day_idx: dayIdx, block_idx: blockIdx })}
              onRemoveSet={(dayIdx, blockIdx, _setIdx) => patchUserProgram(up.id, { op: 'remove_set', day_idx: dayIdx, block_idx: blockIdx })}
              onSwap={(_dayIdx, _blockIdx) => { /* TODO: open exercise picker */ }}
            />
          ))}
        </div>
      </section>

      <ScheduleWarnings warnings={warnings} />

      <button
        onClick={start}
        disabled={startDisabled}
        style={{
          padding: '14px 22px',
          background: startDisabled ? 'rgba(77,141,255,0.3)' : '#4D8DFF',
          border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, letterSpacing: 1,
          textTransform: 'uppercase', cursor: startDisabled ? 'not-allowed' : 'pointer', alignSelf: 'flex-start',
        }}
      >
        {/* "Mesocycle" left as a string literal — the term lives inside an interactive
            button, where a nested <Term> popover would be a nested interactive. The
            term is explained in the wizard header and conflict banner above. */}
        {'Start Mesocycle'}
      </button>
      {err ? <div style={{ color: '#FF6A6A', fontSize: 13 }}>{err}</div> : null}
    </div>
  );
}
