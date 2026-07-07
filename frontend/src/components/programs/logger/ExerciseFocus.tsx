import { TOKENS, FONTS } from '../../../tokens';
import { Term } from '../../Term';
import { isBeginnerTrack, effortCue } from '../../../lib/programTracks';
import { SetRow, type RowState, type RowInputs } from './SetRow';
import type { TodaySet } from '../../../lib/api/mesocycles';
import type { HistorySession } from '../../../lib/api/exerciseHistory';

// =============================================================================
// ExerciseFocus — per-exercise logging screen of the hub+focus mobile logger.
// Pure presentational: the container (TodayLoggerMobile, Task 6) owns data
// loading, prefill, and the offline-queue-backed row state machine; this
// component only renders what it's given and reports taps.
// =============================================================================

export function ExerciseFocus({
  position,
  exercise,
  sets,
  track,
  rowStates,
  rowInputs,
  onInputChange,
  onLog,
  onSkip,
  lastSession,
  onOpenHistory,
  onBack,
  onDone,
  getWeightInputRef,
  onOpenGuide,
}: {
  position: { current: number; total: number };
  exercise: { name: string; muscle: string; equipmentLabel: string; slug: string };
  sets: TodaySet[];
  track?: string | null;
  rowStates: Record<string, RowState>;
  rowInputs: Record<string, RowInputs>;
  onInputChange: (setId: string, patch: Partial<RowInputs>) => void;
  onLog: (set: TodaySet) => void;
  onSkip: (setId: string) => void;
  lastSession: HistorySession | null;
  onOpenHistory: () => void;
  onBack: () => void;
  onDone: () => void;
  /** Container-owned focus chain: returns the callback ref for a set's weight
   *  input so log-then-advance-focus keeps working inside the focus screen. */
  getWeightInputRef?: (setId: string) => (el: HTMLInputElement | null) => void;
  /** null = no guide exists for this exercise → ⓘ is hidden (spec §4). */
  onOpenGuide?: (() => void) | null;
}) {
  const beginner = isBeginnerTrack(track);
  const lastTimeLine = formatLastTime(lastSession);
  const firstSet = sets[0];

  return (
    <div
      style={{
        padding: 16,
        fontFamily: FONTS.ui,
        color: TOKENS.text,
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            aria-label="Back to plan"
            onClick={onBack}
            style={{
              minHeight: 44,
              padding: '8px 4px',
              background: 'none',
              border: 'none',
              color: TOKENS.accent,
              fontFamily: FONTS.ui,
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: 0.5,
              cursor: 'pointer',
            }}
          >
            ← PLAN
          </button>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              letterSpacing: 1,
              color: TOKENS.textDim,
              textTransform: 'uppercase',
            }}
          >
            {position.current} OF {position.total}
          </span>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {onOpenGuide ? (
              <button
                type="button"
                aria-label="How to do this exercise"
                onClick={onOpenGuide}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  background: 'none',
                  border: 'none',
                  color: TOKENS.textDim,
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ⓘ
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Exercise history"
              onClick={onOpenHistory}
              style={{
                minWidth: 44,
                minHeight: 44,
                background: 'none',
                border: 'none',
                color: TOKENS.textDim,
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              ⟲
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {exercise.muscle ? <MuscleChip muscle={exercise.muscle} /> : null}
          <h2 style={{ margin: 0, fontSize: 20 }}>{exercise.name}</h2>
        </div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: TOKENS.textDim,
            marginTop: 4,
          }}
        >
          {exercise.equipmentLabel}
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sets.map((set) => (
          <SetRow
            key={set.id}
            set={set}
            hideRir={beginner}
            state={rowStates[set.id]}
            inputs={rowInputs[set.id]}
            onInputChange={(patch) => onInputChange(set.id, patch)}
            onLog={() => onLog(set)}
            onSkip={() => onSkip(set.id)}
            weightInputRef={getWeightInputRef ? getWeightInputRef(set.id) : () => {}}
          />
        ))}
      </div>

      {lastTimeLine ? (
        <div
          style={{
            marginTop: 12,
            fontFamily: FONTS.mono,
            fontSize: 12,
            color: TOKENS.textDim,
          }}
        >
          {lastTimeLine}
        </div>
      ) : null}

      {firstSet ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: TOKENS.textDim,
          }}
        >
          {beginner ? (
            effortCue(firstSet.target_rir)
          ) : (
            <>
              <Term k="RIR" compact /> {firstSet.target_rir}
            </>
          )}
        </div>
      ) : null}

      <button
        type="button"
        aria-label="Done, back to plan"
        onClick={onDone}
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
        DONE → BACK TO PLAN
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// MuscleChip — same pattern as WorkoutHub's chip.
// -----------------------------------------------------------------------------

function MuscleChip({ muscle }: { muscle: string }) {
  return (
    <span
      data-testid="muscle-chip"
      style={{
        display: 'inline-block',
        flexShrink: 0,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        fontFamily: FONTS.mono,
        color: TOKENS.textDim,
        background: TOKENS.surface2,
        border: `1px solid ${TOKENS.line}`,
        textTransform: 'uppercase',
      }}
    >
      {muscle}
    </span>
  );
}

// -----------------------------------------------------------------------------
// formatLastTime — "last time: 25 lbs × 9, 9" when every logged set shares the
// same weight; falls back to "25×9 · 30×8" per-set when weights differ.
// Individually-nullable HistorySet fields (bodyweight logs) render weight as
// "BW"; a session with no reps recorded on any set has nothing worth showing.
// -----------------------------------------------------------------------------

function formatLastTime(session: HistorySession | null): string | null {
  if (!session || session.sets.length === 0) return null;
  const usable = session.sets.filter((s) => s.reps != null);
  if (usable.length === 0) return null;

  const weights = usable.map((s) => s.weight_lbs);
  const uniformWeight =
    weights.every((w) => w === weights[0]) && weights[0] !== null ? weights[0] : null;

  if (uniformWeight !== null) {
    const reps = usable.map((s) => s.reps).join(', ');
    return `last time: ${uniformWeight} lbs × ${reps}`;
  }

  const parts = usable.map((s) => `${s.weight_lbs === null ? 'BW' : s.weight_lbs}×${s.reps}`);
  return `last time: ${parts.join(' · ')}`;
}
