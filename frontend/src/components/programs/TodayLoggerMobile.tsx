import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { useCurrentUser } from '../../auth';
import { Term } from '../Term';
import { isBeginnerTrack, effortCue } from '../../lib/programTracks';
import {
  getTodayWorkout,
  type TodayDay,
  type TodaySet,
  type TodayWorkoutResponse,
} from '../../lib/api/mesocycles';
import { logBuffer, QueueFullError } from '../../lib/logBuffer';
import { useRestTimer } from '../../hooks/useRestTimer';
import { SetRow, type RowState, type RowInputs } from './logger/SetRow';

// =============================================================================
// TodayLoggerMobile — mobile-first live workout logger.
// Mounted at /today/:mesocycleRunId/log; entered from TodayWorkoutMobile.
// Persists set logs through logBuffer → idbQueue (offline-tolerant).
// =============================================================================

// W1.3.4 code-review follow-ups deferred to W1.3.x cleanup:
//   - weight upper/lower bound validation (currently server-side only)
//   - Skip button currently no-op; awaits W1.3.5 design
//   - quota-error banner needs dismiss/recover affordance (awaits W1.3.8 Settings storage UI)
//   - inline styles could hoist to module-scope const for GC
//   - extract RirSlider + NumInput into their own files when reused (W2.x desktop logger)

export interface TodayLoggerMobileProps {
  /**
   * Test-only hatch: bypasses getTodayWorkout() so tests don't have to mock
   * the network. In production this is always undefined and the component
   * fetches its own data on mount.
   */
  preloaded?: { run_id: string; day: TodayDay; sets: TodaySet[]; track?: string | null };
}

export default function TodayLoggerMobile({ preloaded }: TodayLoggerMobileProps) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [data, setData] = useState<{
    run_id: string;
    day: TodayDay;
    sets: TodaySet[];
    track?: string | null;
  } | null>(preloaded ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  useEffect(() => {
    if (preloaded) return;
    let cancelled = false;
    getTodayWorkout()
      .then((res: TodayWorkoutResponse) => {
        if (cancelled) return;
        if (res.state === 'workout') {
          setData({ run_id: res.run_id, day: res.day, sets: res.sets, track: res.track });
        } else {
          setLoadError(res.state === 'no_active_run' ? 'No active mesocycle.' : 'Rest day.');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load workout');
      });
    return () => {
      cancelled = true;
    };
  }, [preloaded]);

  if (loadError) {
    return (
      <div style={{ padding: 16, color: TOKENS.textDim, fontFamily: FONTS.ui }}>
        {loadError}{' '}
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            color: TOKENS.accent,
            textDecoration: 'underline',
            cursor: 'pointer',
            fontFamily: FONTS.ui,
          }}
        >
          Back to Today
        </button>
      </div>
    );
  }
  if (!data) {
    return <div style={{ padding: 16, color: TOKENS.textDim, fontFamily: FONTS.ui }}>Loading…</div>;
  }

  return (
    <LoggerInner
      data={data}
      currentUserId={user?.id ?? null}
      quotaError={quotaError}
      setQuotaError={setQuotaError}
    />
  );
}

// -----------------------------------------------------------------------------
// LoggerInner — split so the data-loading branch up-top can early-return
// without provoking hook-order issues.
// -----------------------------------------------------------------------------

function LoggerInner({
  data,
  currentUserId,
  quotaError,
  setQuotaError,
}: {
  data: { run_id: string; day: TodayDay; sets: TodaySet[]; track?: string | null };
  currentUserId: string | null;
  quotaError: string | null;
  setQuotaError: (msg: string | null) => void;
}) {
  const navigate = useNavigate();

  // Group sets by block_idx so the UI shows "exercise → its sets" together.
  const blocks = useMemo(() => {
    const m = new Map<number, TodaySet[]>();
    for (const s of data.sets) {
      if (!m.has(s.block_idx)) m.set(s.block_idx, []);
      m.get(s.block_idx)!.push(s);
    }
    // sort within block by set_idx so rows are stable.
    for (const arr of m.values()) arr.sort((a, b) => a.set_idx - b.set_idx);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [data.sets]);

  // Flat ordering used for "next set focus" jumps.
  const flatOrder = useMemo(() => blocks.flatMap(([, arr]) => arr.map((s) => s.id)), [blocks]);

  // Per-row state machine + inputs, keyed by planned_set_id.
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(data.sets.map((s) => [s.id, { phase: 'input' as const }])),
  );
  const [rowInputs, setRowInputs] = useState<Record<string, RowInputs>>(() =>
    Object.fromEntries(data.sets.map((s) => [s.id, { weight: '', reps: '', rir: s.target_rir }])),
  );

  // Most-recently-logged-at drives a single rest-timer instance at the bottom.
  const [lastLoggedAt, setLastLoggedAt] = useState<number | null>(null);
  // Rest target = the just-logged set's rest_sec. Falls back to 90s on first mount.
  const [activeRestSec, setActiveRestSec] = useState<number>(90);

  // Focus chain: weight-input refs keyed by set id; after a successful Log
  // we focus the next set's weight input.
  const weightRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const setRow = useCallback((id: string, next: RowState) => {
    setRowStates((prev) => ({ ...prev, [id]: next }));
  }, []);

  const setInput = useCallback((id: string, patch: Partial<RowInputs>) => {
    setRowInputs((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const focusNext = useCallback(
    (currentId: string) => {
      const i = flatOrder.indexOf(currentId);
      if (i < 0) return;
      const nextId = flatOrder[i + 1];
      if (!nextId) {
        // End of workout — focus the complete CTA via id (rendered below).
        const cta = document.getElementById('logger-complete-cta');
        cta?.focus();
        return;
      }
      weightRefs.current[nextId]?.focus();
    },
    [flatOrder],
  );

  const handleLog = useCallback(
    async (set: TodaySet) => {
      if (!currentUserId) return; // shouldn't happen — AuthGate blocks render
      const inputs = rowInputs[set.id];
      const weight = parseFloat(inputs.weight);
      const reps = parseInt(inputs.reps, 10);
      if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps <= 0) {
        // Validation gate — UI surfaces via the disabled CTA; nothing to do.
        return;
      }

      setRow(set.id, { phase: 'logging', clientRequestId: null });
      const performedAt = new Date().toISOString();
      try {
        const clientRequestId = await logBuffer.enqueue(
          set.id,
          { weight_lbs: weight, reps, rir: inputs.rir, performed_at: performedAt },
          currentUserId,
        );
        const loggedAt = Date.now();
        setRow(set.id, { phase: 'logged', clientRequestId, loggedAt });
        setLastLoggedAt(loggedAt);
        setActiveRestSec(set.rest_sec || 90);
        // Defer focus shift so React commits the new affordance first; if the
        // next input doesn't exist yet (rare), the document.getElementById
        // path catches it.
        setTimeout(() => focusNext(set.id), 0);
      } catch (err: unknown) {
        if (err instanceof QueueFullError) {
          setQuotaError('Offline queue is full — logs cannot be saved until storage is freed.');
          setRow(set.id, { phase: 'input' });
          return;
        }
        // Unknown error — surface but leave the user the ability to retry.
        setRow(set.id, { phase: 'input' });
        throw err;
      }
    },
    [currentUserId, rowInputs, setRow, focusNext, setQuotaError],
  );

  const restTimer = useRestTimer({ lastLoggedAt, targetRestSec: activeRestSec });

  return (
    <div
      style={{
        padding: 16,
        fontFamily: FONTS.ui,
        color: TOKENS.text,
        maxWidth: 480,
        margin: '0 auto',
        paddingBottom: 96, // reserve space for the sticky rest-timer footer
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: 1,
            color: TOKENS.accent,
            textTransform: 'uppercase',
          }}
        >
          Week {data.day.week_idx} · Day {data.day.day_idx + 1}
        </div>
        <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>{data.day.name}</h2>
      </header>

      {quotaError ? (
        <div
          role="alert"
          style={{
            background: 'rgba(255,106,106,0.08)',
            border: `1px solid ${TOKENS.danger}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
            color: TOKENS.danger,
            fontSize: 13,
          }}
        >
          {quotaError}
        </div>
      ) : null}

      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {blocks.map(([blockIdx, sets]) => (
          <li
            key={blockIdx}
            style={{
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 10,
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15 }}>{sets[0].exercise.name}</div>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                color: TOKENS.textDim,
                marginTop: 4,
              }}
            >
              {sets[0].target_reps_low}–{sets[0].target_reps_high} reps ·{' '}
              {isBeginnerTrack(data.track) ? (
                effortCue(sets[0].target_rir)
              ) : (
                <>
                  <Term k="RIR" compact /> {sets[0].target_rir}
                </>
              )}{' '}
              · {sets[0].rest_sec}s rest
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sets.map((set) => (
                <SetRow
                  key={set.id}
                  set={set}
                  hideRir={isBeginnerTrack(data.track)}
                  state={rowStates[set.id]}
                  inputs={rowInputs[set.id]}
                  onInputChange={(patch) => setInput(set.id, patch)}
                  onLog={() => handleLog(set)}
                  onSkip={() => setRow(set.id, { phase: 'input' })}
                  weightInputRef={(el) => {
                    weightRefs.current[set.id] = el;
                  }}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      <button
        id="logger-complete-cta"
        onClick={() => navigate('/')}
        style={{
          marginTop: 24,
          padding: 14,
          width: '100%',
          background: TOKENS.accent,
          border: 'none',
          borderRadius: 8,
          color: TOKENS.text,
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: 'uppercase',
          fontSize: 14,
          cursor: 'pointer',
          fontFamily: FONTS.ui,
        }}
      >
        Workout complete
      </button>

      {lastLoggedAt !== null ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 12,
            left: 0,
            right: 0,
            margin: '0 auto',
            maxWidth: 480,
            padding: '10px 16px',
            background: restTimer.isOvertime ? TOKENS.surface2 : TOKENS.surface,
            border: `1px solid ${restTimer.isOvertime ? TOKENS.warn : TOKENS.line}`,
            borderRadius: 10,
            color: restTimer.isOvertime ? TOKENS.warn : TOKENS.text,
            fontFamily: FONTS.mono,
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          {restTimer.isOvertime
            ? `Rest +${Math.abs(restTimer.remainingSec)}s over`
            : `Rest ${Math.max(0, restTimer.remainingSec)}s`}
        </div>
      ) : null}
    </div>
  );
}

