import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { useCurrentUser } from '../../auth';
import {
  getTodayWorkout,
  type TodayDay,
  type TodaySet,
  type TodayWorkoutResponse,
} from '../../lib/api/mesocycles';
import { listExercises } from '../../lib/api/exercises';
import { getExerciseHistory, type HistorySession } from '../../lib/api/exerciseHistory';
import type { PredicateT } from '../../lib/api/predicates';
import { logBuffer, QueueFullError } from '../../lib/logBuffer';
import { useRestTimer } from './logger/useRestTimer';
import { WorkoutHub, type HubBlock } from './logger/WorkoutHub';
import { ExerciseFocus } from './logger/ExerciseFocus';
import { HistorySheet } from './logger/HistorySheet';
import type { RowState, RowInputs } from './logger/SetRow';

// =============================================================================
// TodayLoggerMobile — container for the hub+focus mobile logger.
// Mounted at /today/:mesocycleRunId/log and /today/:mesocycleRunId/log/:blockIdx;
// entered from TodayWorkoutMobile. No :blockIdx → WorkoutHub (day checklist);
// with :blockIdx → ExerciseFocus for that block. The container owns data
// loading, the per-row state machine, history prefill, and the rest timer.
// Persists set logs through logBuffer → idbQueue (offline-tolerant) — that
// machinery is unchanged from the single-scroll logger.
// =============================================================================

// W1.3.4 code-review follow-ups deferred to W1.3.x cleanup:
//   - weight upper/lower bound validation (currently server-side only)
//   - Skip button currently no-op; awaits W1.3.5 design
//   - quota-error banner needs dismiss/recover affordance (awaits W1.3.8 Settings storage UI)

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
// Exercise metadata — the today-workout payload only carries {id, slug, name}
// per exercise, but the hub chip + focus header need the primary muscle and an
// equipment label. Source both from the existing /api/exercises list, keyed by
// slug. Missing metadata degrades to empty labels rather than blocking logging.
// -----------------------------------------------------------------------------

type ExerciseMeta = { muscle: string; equipmentLabel: string };

const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: 'Barbell',
  flat_bench: 'Flat bench',
  squat_rack: 'Squat rack',
  pullup_bar: 'Pull-up bar',
  dip_station: 'Dip station',
  cable_stack: 'Cable stack',
  rowing_erg: 'Rowing erg',
  treadmill: 'Treadmill',
  dumbbells: 'Dumbbells',
  adjustable_bench: 'Adjustable bench',
  recumbent_bike: 'Recumbent bike',
  outdoor_walking: 'Outdoors',
};

function equipmentLabelOf(required: { requires?: unknown[] } | null | undefined): string {
  const reqs = (required?.requires ?? []) as PredicateT[];
  if (reqs.length === 0) return 'Bodyweight';
  const parts = reqs.map((p) =>
    p.type === 'machine' ? `${p.name} machine` : (EQUIPMENT_LABELS[p.type] ?? p.type),
  );
  return [...new Set(parts)].join(' · ');
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
  const { blockIdx: blockIdxParam } = useParams<{ blockIdx?: string }>();

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

  // Per-row state machine + inputs, keyed by planned_set_id. Every set in
  // data.sets gets an entry up-front — ExerciseFocus/SetRow assume non-null
  // lookups. Server-logged sets initialize in the 'logged' phase (inputs show
  // the logged weight × reps, disabled) so completion survives reload; their
  // sentinel clientRequestId is never in the IDB queue, and idbQueue.getStatus
  // collapses "absent" to 'synced' — the row correctly reads "Logged · locked".
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      data.sets.map((s) => [
        s.id,
        s.logged
          ? { phase: 'logged' as const, clientRequestId: `server:${s.id}`, loggedAt: 0 }
          : { phase: 'input' as const },
      ]),
    ),
  );
  const [rowInputs, setRowInputs] = useState<Record<string, RowInputs>>(() =>
    Object.fromEntries(
      data.sets.map((s) => [
        s.id,
        {
          // `logged` fields are individually nullable (reps-only bodyweight
          // logs) — seed only non-null values, never render "null".
          weight: s.logged?.weight_lbs != null ? String(s.logged.weight_lbs) : '',
          reps: s.logged?.reps != null ? String(s.logged.reps) : '',
          rir: s.target_rir,
        },
      ]),
    ),
  );

  // Slug → {muscle, equipmentLabel} for the hub chips + focus header.
  const [exMeta, setExMeta] = useState<Record<string, ExerciseMeta>>({});
  useEffect(() => {
    let cancelled = false;
    listExercises()
      .then((list) => {
        if (cancelled) return;
        setExMeta(
          Object.fromEntries(
            list.map((e) => [
              e.slug,
              { muscle: e.primary_muscle, equipmentLabel: equipmentLabelOf(e.required_equipment) },
            ]),
          ),
        );
      })
      .catch(() => {
        // Metadata is decorative — logging works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focused block (focus screen) — invalid/absent param renders the hub.
  const focusedEntry = useMemo(() => {
    if (blockIdxParam == null) return null;
    const idx = Number(blockIdxParam);
    if (!Number.isInteger(idx)) return null;
    return blocks.find(([b]) => b === idx) ?? null;
  }, [blockIdxParam, blocks]);

  // Last-session history per exercise slug: powers prefill + the last-time
  // line. Fetched lazily when a block is first focused; the ref dedupes
  // in-flight/completed fetches so each slug is requested at most once.
  const [histBySlug, setHistBySlug] = useState<Record<string, HistorySession | null>>({});
  const histRequested = useRef<Set<string>>(new Set());

  const setInput = useCallback((id: string, patch: Partial<RowInputs>) => {
    setRowInputs((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  useEffect(() => {
    if (!focusedEntry) return;
    const sets = focusedEntry[1];
    const slug = sets[0]?.exercise.slug;
    if (!slug || histRequested.current.has(slug)) return;
    histRequested.current.add(slug);
    let cancelled = false;
    getExerciseHistory(slug, 1)
      .then((sessions) => {
        if (cancelled) return;
        const last = sessions[0] ?? null;
        setHistBySlug((prev) => ({ ...prev, [slug]: last }));
        if (!last || last.sets.length === 0) return;
        // Prefill: seed weight/reps for this block's unlogged, untouched rows
        // from the same set_idx last session (first set as fallback). Rows the
        // user already typed in (or logged — logging requires non-empty
        // inputs) are left alone via the empty-inputs guard. History fields
        // are individually nullable — seed only non-null values.
        setRowInputs((prev) => {
          const next = { ...prev };
          for (const set of sets) {
            if (set.logged) continue;
            const cur = prev[set.id];
            if (!cur || cur.weight !== '' || cur.reps !== '') continue;
            const hs = last.sets[set.set_idx] ?? last.sets[0];
            if (!hs) continue;
            next[set.id] = {
              ...cur,
              weight: hs.weight_lbs != null ? String(hs.weight_lbs) : cur.weight,
              reps: hs.reps != null ? String(hs.reps) : cur.reps,
            };
          }
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        // History is a nicety — logging must not depend on it.
        setHistBySlug((prev) => ({ ...prev, [slug]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [focusedEntry]);

  // History sheet — state owns whether it's mounted; HistorySheet fetches its
  // own data on mount (see logger/HistorySheet.tsx).
  const [historyOpen, setHistoryOpen] = useState(false);

  // Focus chain: weight-input refs keyed by set id; after a successful Log
  // we focus the next set's weight input.
  const weightRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const getWeightInputRef = useCallback(
    (id: string) => (el: HTMLInputElement | null) => {
      weightRefs.current[id] = el;
    },
    [],
  );

  const setRow = useCallback((id: string, next: RowState) => {
    setRowStates((prev) => ({ ...prev, [id]: next }));
  }, []);

  const focusNext = useCallback(
    (currentId: string) => {
      const i = flatOrder.indexOf(currentId);
      if (i < 0) return;
      const nextId = flatOrder[i + 1];
      // Next set's input only exists while its block is on screen; end of the
      // focused block (or of the workout) is a no-op.
      if (nextId) weightRefs.current[nextId]?.focus();
    },
    [flatOrder],
  );

  const handleLog = useCallback(
    async (set: TodaySet): Promise<boolean> => {
      if (!currentUserId) return false; // shouldn't happen — AuthGate blocks render
      const inputs = rowInputs[set.id];
      const weight = parseFloat(inputs.weight);
      const reps = parseInt(inputs.reps, 10);
      if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps <= 0) {
        // Validation gate — UI surfaces via the disabled CTA; nothing to do.
        return false;
      }

      setRow(set.id, { phase: 'logging', clientRequestId: null });
      const performedAt = new Date().toISOString();
      try {
        const clientRequestId = await logBuffer.enqueue(
          set.id,
          { weight_lbs: weight, reps, rir: inputs.rir, performed_at: performedAt },
          currentUserId,
        );
        setRow(set.id, { phase: 'logged', clientRequestId, loggedAt: Date.now() });
        // Defer focus shift so React commits the new affordance first.
        setTimeout(() => focusNext(set.id), 0);
        return true;
      } catch (err: unknown) {
        if (err instanceof QueueFullError) {
          setQuotaError('Offline queue is full — logs cannot be saved until storage is freed.');
          setRow(set.id, { phase: 'input' });
          return false;
        }
        // Unknown error — surface but leave the user the ability to retry.
        setRow(set.id, { phase: 'input' });
        throw err;
      }
    },
    [currentUserId, rowInputs, setRow, focusNext, setQuotaError],
  );

  const restTimer = useRestTimer();
  const handleLogWithRest = useCallback(
    async (set: TodaySet) => {
      const ok = await handleLog(set);
      if (ok) restTimer.start(set.rest_sec || 90);
    },
    [handleLog, restTimer],
  );

  // Hub rows: setsDone counts server-logged sets plus this session's local
  // (queue-backed) logs.
  const hubBlocks: HubBlock[] = useMemo(
    () =>
      blocks.map(([blockIdx, sets]) => ({
        blockIdx,
        exerciseName: sets[0].exercise.name,
        muscle: exMeta[sets[0].exercise.slug]?.muscle ?? '',
        setsTotal: sets.length,
        setsDone: sets.filter((s) => s.logged != null || rowStates[s.id]?.phase === 'logged')
          .length,
      })),
    [blocks, exMeta, rowStates],
  );

  const quotaBanner = quotaError ? (
    <div
      role="alert"
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '16px 16px 0',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          background: 'rgba(255,106,106,0.08)',
          border: `1px solid ${TOKENS.danger}`,
          borderRadius: 8,
          padding: 12,
          color: TOKENS.danger,
          fontSize: 13,
          fontFamily: FONTS.ui,
        }}
      >
        {quotaError}
      </div>
    </div>
  ) : null;

  if (!focusedEntry) {
    return (
      <>
        {quotaBanner}
        <WorkoutHub
          dayName={data.day.name}
          blocks={hubBlocks}
          onOpenBlock={(blockIdx) => navigate(`/today/${data.run_id}/log/${blockIdx}`)}
        />
      </>
    );
  }

  const [focusedIdx, focusedSets] = focusedEntry;
  const slug = focusedSets[0].exercise.slug;
  const meta = exMeta[slug];
  const backToHub = () => navigate(`/today/${data.run_id}/log`);

  return (
    <div style={{ paddingBottom: restTimer.remaining != null ? 72 : 0 }}>
      {quotaBanner}
      <ExerciseFocus
        position={{
          current: blocks.findIndex(([b]) => b === focusedIdx) + 1,
          total: blocks.length,
        }}
        exercise={{
          name: focusedSets[0].exercise.name,
          muscle: meta?.muscle ?? '',
          equipmentLabel: meta?.equipmentLabel ?? '',
          slug,
        }}
        sets={focusedSets}
        track={data.track}
        rowStates={rowStates}
        rowInputs={rowInputs}
        onInputChange={setInput}
        onLog={handleLogWithRest}
        onSkip={(setId) => setRow(setId, { phase: 'input' })}
        lastSession={histBySlug[slug] ?? null}
        onOpenHistory={() => setHistoryOpen(true)}
        onBack={backToHub}
        onDone={backToHub}
        getWeightInputRef={getWeightInputRef}
      />
      {historyOpen ? (
        <HistorySheet slug={slug} track={data.track} onClose={() => setHistoryOpen(false)} />
      ) : null}
      {restTimer.remaining != null ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="rest-timer"
          style={{
            position: 'fixed',
            bottom: 12,
            left: 0,
            right: 0,
            margin: '0 auto',
            maxWidth: 480,
            padding: '10px 16px',
            boxSizing: 'border-box',
            background: TOKENS.surface,
            border: `1px solid ${TOKENS.accent}`,
            borderRadius: 10,
            color: TOKENS.text,
            fontFamily: FONTS.mono,
            fontSize: 12,
            letterSpacing: 1,
            textAlign: 'center',
          }}
        >
          REST {formatRest(restTimer.remaining)}
        </div>
      ) : null}
    </div>
  );
}

// m:ss with zero-padded seconds — 180 → "3:00".
function formatRest(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
