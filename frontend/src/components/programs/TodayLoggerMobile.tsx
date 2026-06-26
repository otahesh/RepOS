import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { useCurrentUser } from '../../auth';
import { Term } from '../Term';
import { useNetworkState } from '../../hooks/useNetworkState';
import {
  getTodayWorkout,
  type TodayDay,
  type TodaySet,
  type TodayWorkoutResponse,
} from '../../lib/api/mesocycles';
import { logBuffer, QueueFullError } from '../../lib/logBuffer';
import { useIdbQueueStatus, type QueueRowStatus } from '../../hooks/useIdbQueueStatus';
import { useRestTimer } from '../../hooks/useRestTimer';

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
  preloaded?: { run_id: string; day: TodayDay; sets: TodaySet[] };
}

type RowState =
  | { phase: 'input' }
  | { phase: 'logging'; clientRequestId: string | null }
  | { phase: 'logged'; clientRequestId: string; loggedAt: number }
  | { phase: 'rejected'; clientRequestId: string };

interface RowInputs {
  weight: string; // user-entered text; converted to number on Log
  reps: string;
  rir: number; // 0..5
}

const DEBOUNCE_MS = 500;

// Map idb status → user-facing affordance text.
// 'synced' surfaces "locked — Settings to edit" so users understand a typo can't
// be fixed inline; the PATCH/DELETE routes exist (24h audit window) but the
// inline edit/undo UI ships in a later wave per scope. Until then the message
// explicitly points users at the right surface.
function affordanceText(status: QueueRowStatus): string {
  switch (status) {
    case 'pending':
      return 'Queued offline';
    case 'syncing':
      return 'Syncing…';
    case 'synced':
      return 'Logged · locked (24h). Edit via Settings.';
    case 'rejected':
      return 'Rejected — review';
    case 'unknown':
    default:
      return '';
  }
}

function affordanceColor(status: QueueRowStatus): string {
  switch (status) {
    case 'synced':
      return TOKENS.good;
    case 'rejected':
      return TOKENS.danger;
    case 'pending':
    case 'syncing':
      return TOKENS.warn;
    default:
      return TOKENS.textDim;
  }
}

export default function TodayLoggerMobile({ preloaded }: TodayLoggerMobileProps) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [data, setData] = useState<{ run_id: string; day: TodayDay; sets: TodaySet[] } | null>(
    preloaded ?? null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  useEffect(() => {
    if (preloaded) return;
    let cancelled = false;
    getTodayWorkout()
      .then((res: TodayWorkoutResponse) => {
        if (cancelled) return;
        if (res.state === 'workout') {
          setData({ run_id: res.run_id, day: res.day, sets: res.sets });
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
  data: { run_id: string; day: TodayDay; sets: TodaySet[] };
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
              {sets[0].target_reps_low}–{sets[0].target_reps_high} reps · <Term k="RIR" compact />{' '}
              {sets[0].target_rir} · {sets[0].rest_sec}s rest
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sets.map((set) => (
                <SetRow
                  key={set.id}
                  set={set}
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

// -----------------------------------------------------------------------------
// SetRow — one planned set with weight/reps/RIR inputs + Log/Skip controls.
// -----------------------------------------------------------------------------

function SetRow({
  set,
  state,
  inputs,
  onInputChange,
  onLog,
  onSkip,
  weightInputRef,
}: {
  set: TodaySet;
  state: RowState;
  inputs: RowInputs;
  onInputChange: (patch: Partial<RowInputs>) => void;
  onLog: () => void;
  onSkip: () => void;
  weightInputRef: (el: HTMLInputElement | null) => void;
}) {
  // 500ms client-side debounce on the Log button (separate from row state so
  // a transient network error doesn't bypass it).
  const [debounced, setDebounced] = useState(false);
  useEffect(() => {
    if (!debounced) return;
    const t = setTimeout(() => setDebounced(false), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [debounced]);

  const clientRequestId =
    state.phase === 'logged' || state.phase === 'rejected' ? state.clientRequestId : null;
  const status = useIdbQueueStatus(clientRequestId);
  // Show "Log (offline)" on the button label when the network is down so the
  // user sees the queue behavior BEFORE pressing, not only after — covers the
  // mid-workout-on-an-elevator "did this even register?" UX miss.
  const { online } = useNetworkState();

  const isLogged = state.phase === 'logged';
  const isLogging = state.phase === 'logging';

  const handleLogClick = (): void => {
    if (debounced || isLogged || isLogging) return;
    setDebounced(true);
    onLog();
  };

  const canLog =
    !debounced &&
    !isLogged &&
    !isLogging &&
    inputs.weight.trim() !== '' &&
    inputs.reps.trim() !== '';

  const logLabel = (() => {
    if (isLogged) return 'Logged';
    if (debounced) return 'Set queued';
    return online ? 'Log' : 'Log (offline)';
  })();

  return (
    <div
      data-testid={`set-row-${set.set_idx}`}
      style={{
        background: TOKENS.bg,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textDim }}>
          Set {set.set_idx + 1}
        </span>
        {set.target_load_hint ? (
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textDim }}>
            target {set.target_load_hint}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <NumInput
          label="Weight"
          unit="lb"
          value={inputs.weight}
          onChange={(v) => onInputChange({ weight: v })}
          inputRef={weightInputRef}
          ariaLabel={`Set ${set.set_idx + 1} weight in pounds`}
          disabled={isLogged}
        />
        <NumInput
          label="Reps"
          unit=""
          value={inputs.reps}
          onChange={(v) => onInputChange({ reps: v })}
          ariaLabel={`Set ${set.set_idx + 1} reps`}
          disabled={isLogged}
        />
      </div>

      <RirSlider
        value={inputs.rir}
        onChange={(rir) => onInputChange({ rir })}
        disabled={isLogged}
      />

      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button
          onClick={handleLogClick}
          disabled={!canLog}
          style={{
            flex: 2,
            padding: 10,
            background: canLog ? TOKENS.accent : TOKENS.surface3,
            color: TOKENS.text,
            border: 'none',
            borderRadius: 6,
            fontFamily: FONTS.ui,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: 'uppercase',
            fontSize: 12,
            cursor: canLog ? 'pointer' : 'not-allowed',
          }}
        >
          {logLabel}
        </button>
        <button
          onClick={onSkip}
          disabled={isLogged}
          style={{
            flex: 1,
            padding: 10,
            background: 'transparent',
            color: TOKENS.textDim,
            border: `1px solid ${TOKENS.line}`,
            borderRadius: 6,
            fontFamily: FONTS.ui,
            fontSize: 12,
            cursor: isLogged ? 'not-allowed' : 'pointer',
          }}
        >
          Skip
        </button>
      </div>

      <div
        role="status"
        aria-live="polite"
        data-testid={`set-row-${set.set_idx}-status`}
        style={{
          marginTop: 8,
          minHeight: 16,
          fontFamily: FONTS.mono,
          fontSize: 11,
          color: affordanceColor(status),
        }}
      >
        {isLogged ? affordanceText(status) : ''}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// NumInput — numeric text input styled with mono font for data values.
// -----------------------------------------------------------------------------

function NumInput({
  label,
  unit,
  value,
  onChange,
  inputRef,
  ariaLabel,
  disabled,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: TOKENS.textDim, fontFamily: FONTS.ui }}>
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      <input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
        style={{
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 6,
          padding: '10px 10px',
          color: TOKENS.text,
          fontFamily: FONTS.mono,
          fontSize: 16,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

// -----------------------------------------------------------------------------
// RirSlider — accessible 0..5 slider with arrow-key + Home/End support.
// Implemented as role="slider" div so we control keyboard semantics + styling.
// -----------------------------------------------------------------------------

function RirSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(5, value + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(0, value - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 5;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== value) onChange(next);
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: TOKENS.textDim, fontFamily: FONTS.ui }}>
          <Term k="RIR" compact />
        </span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 14, color: TOKENS.text }}>{value}</span>
      </div>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={value}
        aria-label="RIR — reps in reserve"
        aria-disabled={disabled ? 'true' : 'false'}
        onKeyDown={handleKey}
        style={{
          marginTop: 6,
          display: 'flex',
          gap: 4,
          outline: 'none',
        }}
      >
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => onChange(n)}
            aria-hidden="true"
            style={{
              flex: 1,
              height: 36,
              borderRadius: 4,
              border: 'none',
              background: n === value ? TOKENS.accent : TOKENS.surface2,
              color: n === value ? TOKENS.text : TOKENS.textDim,
              fontFamily: FONTS.mono,
              fontSize: 13,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
