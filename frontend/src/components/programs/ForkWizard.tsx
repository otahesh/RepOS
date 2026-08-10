// frontend/src/components/programs/ForkWizard.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getUserProgram,
  getUserProgramWarnings,
  patchUserProgram,
  startUserProgram,
  type UserProgramDetail,
  ApiError,
} from '../../lib/api/userPrograms';
import {
  getTodayWorkout,
  abandonMesocycle,
  type TodayWorkoutResponse,
} from '../../lib/api/mesocycles';
import { Term } from '../Term';
import { DayCard } from './DayCard';
import { DesktopSwapSheet } from './DesktopSwapSheet';
import { ScheduleWarnings, type ScheduleWarning } from './ScheduleWarnings';
import { useIsMobile } from '../../lib/useIsMobile';
import { Button, DataState, Page, StatusBadge } from '../ui';

type ConflictState = { runId: string } | null;

export function ForkWizard({
  userProgramId,
  onStarted,
}: {
  userProgramId: string;
  onStarted: (mesocycleRunId: string) => void;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [up, setUp] = useState<UserProgramDetail | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([]);
  const [conflict, setConflict] = useState<ConflictState>(null);
  const [refork, setRefork] = useState<{ latestVersion: number } | null>(null);
  const [abandoning, setAbandoning] = useState(false);
  const [swapTarget, setSwapTarget] = useState<{ dayIdx: number; blockIdx: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [mobileStep, setMobileStep] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    setLoadError(null);
    setUp(null);
    getUserProgram(userProgramId)
      .then((p) => {
        setUp(p);
        setName(p.name);
      })
      .catch(() => setLoadError('The program draft could not be refreshed.'));
    getUserProgramWarnings(userProgramId)
      .then(setWarnings)
      .catch(() => setWarnings([]));
    refreshActiveRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProgramId, retryKey]);

  function readActiveRun(today: TodayWorkoutResponse): ConflictState {
    // Only an in-progress 'workout' run is a real conflict. 'mesocycle_complete'
    // is a finished run (the server's active_run_exists guard is active-only, and
    // /abandon rejects non-active runs) — treating it as a conflict would strand
    // a user who just finished a program: Start disabled, Abandon 409s in a loop.
    return today.state === 'workout' ? { runId: today.run_id } : null;
  }

  async function refreshActiveRun() {
    try {
      const today = await getTodayWorkout();
      setConflict(readActiveRun(today));
    } catch {
      /* non-fatal — pre-check is best-effort, server still enforces */
    }
  }

  if (loadError)
    return (
      <Page width="wide">
        <DataState
          kind="error"
          title="Couldn't load program"
          body={loadError}
          action={
            <Button variant="secondary" onClick={() => setRetryKey((key) => key + 1)}>
              Retry
            </Button>
          }
        />
      </Page>
    );
  if (!up)
    return (
      <Page width="wide">
        <DataState kind="loading" title="Loading program editor" />
      </Page>
    );

  async function refreshProgram() {
    if (!up) return;
    const p = await getUserProgram(up.id);
    setUp(p);
  }

  async function handleAddSet(dayIdx: number, blockIdx: number) {
    if (!up) return;
    try {
      await patchUserProgram(up.id, { op: 'add_set', day_idx: dayIdx, block_idx: blockIdx });
      await refreshProgram();
    } catch (e) {
      setErr(`Add set failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleRemoveSet(dayIdx: number, blockIdx: number) {
    if (!up) return;
    try {
      await patchUserProgram(up.id, { op: 'remove_set', day_idx: dayIdx, block_idx: blockIdx });
      await refreshProgram();
    } catch (e) {
      setErr(`Remove set failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function saveName() {
    if (!up) return;
    setSaving(true);
    try {
      await patchUserProgram(up.id, { op: 'rename', name });
      getUserProgramWarnings(up.id)
        .then(setWarnings)
        .catch(() => setWarnings([]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
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
    } finally {
      setSaving(false);
    }
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
    } finally {
      setAbandoning(false);
    }
  }

  const hasBlock = warnings.some((w) => w.severity === 'block');
  const startDisabled = saving || hasBlock || !!conflict || !!refork;

  return (
    <Page
      width="data"
      style={{
        fontFamily: 'Inter Tight',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {isMobile ? (
        <div style={{ display: 'grid', gap: 9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 650 }}>Build your program</span>
            <StatusBadge tone="accent">Step {mobileStep} of 3</StatusBadge>
          </div>
          <div
            role="progressbar"
            aria-label="Program editor progress"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={mobileStep}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}
          >
            {[1, 2, 3].map((step) => (
              <span
                key={step}
                aria-hidden="true"
                style={{
                  height: 3,
                  borderRadius: 99,
                  background: step <= mobileStep ? '#4D8DFF' : 'rgba(255,255,255,0.12)',
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
      {conflict ? (
        <div
          role="alert"
          style={{
            padding: 16,
            borderRadius: 8,
            background: 'rgba(245, 181, 68, 0.08)',
            border: '1px solid rgba(245, 181, 68, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 14, color: '#F5B544', fontWeight: 600 }}>
            You already have an active <Term k="mesocycle" />.
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
            Only one can be active at a time. Open it in Today to confirm what's running, then come
            back to abandon if you want this fork to take its place.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/')}
              style={{
                padding: '8px 14px',
                background: '#10141C',
                border: '1px solid rgba(77,141,255,0.5)',
                borderRadius: 6,
                color: '#4D8DFF',
                cursor: 'pointer',
              }}
            >
              View today's workout
            </button>
            <button
              onClick={abandonActiveRun}
              disabled={abandoning}
              style={{
                padding: '8px 14px',
                background: '#10141C',
                border: '1px solid rgba(255,106,106,0.5)',
                borderRadius: 6,
                color: '#FF6A6A',
                cursor: abandoning ? 'wait' : 'pointer',
              }}
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
            padding: 16,
            borderRadius: 8,
            background: 'rgba(255,106,106,0.08)',
            border: '1px solid rgba(255,106,106,0.4)',
            fontSize: 13,
            color: 'rgba(255,255,255,0.85)',
          }}
        >
          The template was updated to version {refork.latestVersion} since you forked it. Re-fork
          from the catalog to pick up the latest version before starting.
        </div>
      ) : null}

      {(!isMobile || mobileStep === 1) && (
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
            Customize before <Term k="mesocycle" /> start
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 4 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Program name</span>
              <input
                aria-label="Program name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  padding: '8px 12px',
                  background: '#0A0D12',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  color: '#fff',
                  fontFamily: 'Inter Tight',
                  fontSize: 14,
                }}
              />
            </label>
            <button
              onClick={saveName}
              disabled={saving || name === up.name}
              style={{
                padding: '8px 14px',
                background: '#10141C',
                border: '1px solid rgba(77,141,255,0.5)',
                borderRadius: 6,
                color: '#4D8DFF',
                cursor: 'pointer',
                alignSelf: 'flex-end',
              }}
            >
              Save name
            </button>
          </div>
        </header>
      )}

      {(!isMobile || mobileStep === 2) && (
        <section>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Days</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
              gap: 12,
            }}
          >
            {up.effective_structure.days.map((d) => (
              <DayCard
                key={d.idx}
                day={d}
                track={up.track}
                onAddSet={(dayIdx, blockIdx) => void handleAddSet(dayIdx, blockIdx)}
                onRemoveSet={(dayIdx, blockIdx, _setIdx) => void handleRemoveSet(dayIdx, blockIdx)}
                onSwap={(dayIdx, blockIdx) => setSwapTarget({ dayIdx, blockIdx })}
              />
            ))}
          </div>
        </section>
      )}

      {/* Pre-start swap picker. Unlike MyProgramPage (where mobile is steered to
          the live-workout swap flow), a draft fork has no live run yet — the
          sheet is the only swap path, so it opens on every viewport. */}
      {swapTarget &&
        (() => {
          const block = up.effective_structure.days[swapTarget.dayIdx]?.blocks[swapTarget.blockIdx];
          if (!block) return null;
          return (
            <DesktopSwapSheet
              open
              context="program_edit"
              fromSlug={block.exercise_slug}
              onClose={() => setSwapTarget(null)}
              onApply={async ({ scope, toExerciseSlug }) => {
                try {
                  const op =
                    scope === 'all'
                      ? {
                          op: 'swap_exercise_all' as const,
                          from_slug: block.exercise_slug,
                          to_exercise_slug: toExerciseSlug,
                        }
                      : {
                          op: 'swap_exercise' as const,
                          day_idx: swapTarget.dayIdx,
                          block_idx: swapTarget.blockIdx,
                          to_exercise_slug: toExerciseSlug,
                        };
                  await patchUserProgram(up.id, op);
                  await refreshProgram();
                  setSwapTarget(null);
                } catch (e) {
                  setErr(`Swap failed: ${e instanceof Error ? e.message : String(e)}`);
                  setSwapTarget(null);
                }
              }}
            />
          );
        })()}

      {(!isMobile || mobileStep === 3) && <ScheduleWarnings warnings={warnings} />}

      <div className={isMobile ? 'repos-sticky-actions' : undefined}>
        {isMobile && mobileStep > 1 ? (
          <Button variant="quiet" onClick={() => setMobileStep((step) => (step - 1) as 1 | 2)}>
            Back
          </Button>
        ) : null}
        {isMobile && mobileStep < 3 ? (
          <Button variant="primary" onClick={() => setMobileStep((step) => (step + 1) as 2 | 3)}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={startDisabled}>
            {/* "Mesocycle" left as a string literal — the term lives inside an interactive
            button, where a nested <Term> popover would be a nested interactive. The
            term is explained in the wizard header and conflict banner above. */}
            {'Start Mesocycle'}
          </Button>
        )}
      </div>
      {err ? (
        <div role="alert" style={{ color: '#FF6A6A', fontSize: 13 }}>
          {err}
        </div>
      ) : null}
    </Page>
  );
}
