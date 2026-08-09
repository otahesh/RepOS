import { useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../../../tokens';
import { Term } from '../../Term';
import { useNetworkState } from '../../../hooks/useNetworkState';
import { useIdbQueueStatus, type QueueRowStatus } from '../../../hooks/useIdbQueueStatus';
import { rowMode } from '../../../lib/effort';
import { useHoldTimer } from './useHoldTimer';
import type { TodaySet } from '../../../lib/api/mesocycles';

// =============================================================================
// SetRow — one planned set with weight/reps/RIR inputs + Log/Skip controls.
// Extracted from TodayLoggerMobile.tsx (byte-faithful move) so ExerciseFocus
// can reuse the exact same row without duplicating the offline-queue wiring.
// =============================================================================

export type RowState =
  | { phase: 'input' }
  | { phase: 'logging'; clientRequestId: string | null }
  | { phase: 'logged'; clientRequestId: string; loggedAt: number }
  | { phase: 'rejected'; clientRequestId: string };

export interface RowInputs {
  weight: string; // user-entered text; converted to number on Log
  reps: string;
  durationSec: string; // duration mode's primary input (seconds held)
  rir: number; // 0..5 (reps mode)
  /** Duration mode's OPTIONAL user-reported RPE (5..10); null = not provided.
   *  Never defaulted from the target — fabricated effort is worse than none. */
  holdRpe: number | null;
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

export function SetRow({
  set,
  hideRir = false,
  state,
  inputs,
  onInputChange,
  onLog,
  onSkip,
  weightInputRef,
}: {
  set: TodaySet;
  /** Beginner track: the RIR slider is hidden and the logged RIR silently
   *  keeps the planned target — beginners aren't asked to self-rate. */
  hideRir?: boolean;
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

  // Bodyweight movements (dead bug, planks) carry no external load — the
  // weight input is hidden and the primary input alone unlocks Log.
  const isBodyweight = set.exercise.bodyweight === true;

  // Input mode derives from the planned row's populated targets (never from
  // exercise.measurement) so pre-reclassification rows render unchanged.
  const mode = rowMode(set);

  const primaryFilled =
    mode === 'duration' ? inputs.durationSec.trim() !== '' : inputs.reps.trim() !== '';
  const canLog =
    !debounced &&
    !isLogged &&
    !isLogging &&
    (isBodyweight || inputs.weight.trim() !== '') &&
    primaryFilled;

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
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: TOKENS.textDim,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Set {set.set_idx + 1}
          {mode === 'duration' ? (
            <span
              style={{
                padding: '1px 6px',
                borderRadius: 4,
                border: `1px solid ${TOKENS.line}`,
                background: TOKENS.surface,
                letterSpacing: 1,
              }}
            >
              <Term k="hold" compact />
            </span>
          ) : null}
        </span>
        {mode === 'duration' && set.target_duration_low_sec != null ? (
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textDim }}>
            target {set.target_duration_low_sec}–{set.target_duration_high_sec}s
          </span>
        ) : set.target_load_hint ? (
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textDim }}>
            target {set.target_load_hint}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {isBodyweight ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              justifyContent: 'flex-end',
            }}
          >
            <span style={{ fontSize: 11, color: TOKENS.textDim, fontFamily: FONTS.ui }}>Load</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 10px',
                borderRadius: 6,
                border: `1px solid ${TOKENS.line}`,
                background: TOKENS.surface,
                color: TOKENS.textDim,
                fontFamily: FONTS.mono,
                fontSize: 13,
                letterSpacing: 1,
              }}
            >
              BODYWEIGHT
            </span>
          </div>
        ) : (
          <NumInput
            label="Weight"
            unit="lb"
            value={inputs.weight}
            onChange={(v) => onInputChange({ weight: v })}
            inputRef={weightInputRef}
            ariaLabel={`Set ${set.set_idx + 1} weight in pounds`}
            disabled={isLogged}
          />
        )}
        {mode === 'duration' ? (
          <NumInput
            label="Hold"
            unit="sec"
            value={inputs.durationSec}
            onChange={(v) => onInputChange({ durationSec: v })}
            inputRef={isBodyweight ? weightInputRef : undefined}
            ariaLabel={`Set ${set.set_idx + 1} hold seconds`}
            disabled={isLogged}
          />
        ) : (
          <NumInput
            label="Reps"
            unit=""
            value={inputs.reps}
            onChange={(v) => onInputChange({ reps: v })}
            inputRef={isBodyweight ? weightInputRef : undefined}
            ariaLabel={`Set ${set.set_idx + 1} reps`}
            disabled={isLogged}
          />
        )}
      </div>

      {mode === 'duration' && !isLogged ? (
        <HoldStopwatch onStop={(sec) => onInputChange({ durationSec: String(sec) })} />
      ) : null}

      {mode === 'duration'
        ? !hideRir && (
            <RpeSlider
              value={inputs.holdRpe}
              onChange={(holdRpe) => onInputChange({ holdRpe })}
              disabled={isLogged}
            />
          )
        : !hideRir && (
            <RirSlider
              value={inputs.rir}
              onChange={(rir) => onInputChange({ rir })}
              disabled={isLogged}
            />
          )}

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

// -----------------------------------------------------------------------------
// HoldStopwatch — count-up timer row for duration sets (Hevy pattern): START
// HOLD arms the wall-clock-anchored counter, STOP freezes it and fills the
// seconds input via onStop. Manual numeric entry stays available alongside.
// -----------------------------------------------------------------------------

function HoldStopwatch({ onStop }: { onStop: (sec: number) => void }) {
  const { elapsed, running, start, stop } = useHoldTimer();

  const mmss = (sec: number): string =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => {
          if (running) {
            onStop(stop());
          } else {
            start();
          }
        }}
        aria-label={running ? 'Stop hold timer' : 'Start hold timer'}
        style={{
          flex: 1,
          padding: 8,
          background: running ? TOKENS.danger : TOKENS.surface2,
          color: TOKENS.text,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 6,
          fontFamily: FONTS.ui,
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: 'uppercase',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {running ? 'Stop' : 'Start hold'}
      </button>
      <span
        aria-live="polite"
        style={{
          minWidth: 48,
          textAlign: 'right',
          fontFamily: FONTS.mono,
          fontSize: 16,
          color: running ? TOKENS.accent : TOKENS.textDim,
        }}
      >
        {elapsed != null ? mmss(elapsed) : '0:00'}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// RpeSlider — OPTIONAL effort input for duration sets. RPE 5..10 (10 = failure);
// starts unselected and stays that way unless tapped — a hold logged without
// effort sends none (never fabricated from the target). Tapping the selected
// value clears it again. Stored as RPE here; the logger converts to the DB's
// proximity-to-failure unit (rir = 10 - rpe) at enqueue via the effort seam.
// -----------------------------------------------------------------------------

function RpeSlider({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: TOKENS.textDim, fontFamily: FONTS.ui }}>
          <Term k="RPE" compact />
          <span style={{ marginLeft: 6 }}>(optional)</span>
        </span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 14, color: TOKENS.text }}>
          {value ?? '—'}
        </span>
      </div>
      <div
        role="group"
        aria-label="RPE — rate of perceived exertion (optional)"
        style={{ marginTop: 6, display: 'flex', gap: 4 }}
      >
        {[5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n === value ? null : n)}
            aria-pressed={n === value}
            aria-label={`RPE ${n}`}
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
