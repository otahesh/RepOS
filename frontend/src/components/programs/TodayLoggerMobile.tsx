import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TOKENS, FONTS } from '../../tokens';
import { useCurrentUser } from '../../auth';
import { completeDayWorkout } from '../../lib/api/dayWorkouts';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { pushToast } from '../common/ToastHost';
import {
  getTodayWorkout,
  type TodayDay,
  type TodaySet,
  type TodayWorkoutResponse,
} from '../../lib/api/mesocycles';
import { listExercises } from '../../lib/api/exercises';
import { getExerciseHistory, type HistorySession } from '../../lib/api/exerciseHistory';
import { getExerciseGuide, type ExerciseGuide } from '../../lib/api/exerciseGuide';
import type { PredicateT } from '../../lib/api/predicates';
import { logBuffer, QueueFullError } from '../../lib/logBuffer';
import { useRestTimer } from './logger/useRestTimer';
import { WorkoutHub, type HubBlock } from './logger/WorkoutHub';
import { ExerciseFocus } from './logger/ExerciseFocus';
import { HistorySheet } from './logger/HistorySheet';
import { SetupCardSheet } from './logger/SetupCardSheet';
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
          // Sequence-workouts: `today` is workout | mesocycle_complete |
          // no_active_run — there is NO rest state. The else-branch is
          // mesocycle_complete (rest is gone); it must never say "Rest day."
          setLoadError(
            res.state === 'no_active_run' ? 'No active mesocycle.' : 'Program complete.',
          );
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
      currentUserTz={user?.timezone ?? null}
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
  currentUserTz,
  quotaError,
  setQuotaError,
}: {
  data: { run_id: string; day: TodayDay; sets: TodaySet[]; track?: string | null };
  currentUserId: string | null;
  currentUserTz: string | null;
  quotaError: string | null;
  setQuotaError: (msg: string | null) => void;
}) {
  const navigate = useNavigate();
  const { blockIdx: blockIdxParam } = useParams<{ blockIdx?: string }>();
  const [searchParams] = useSearchParams();

  // Backfill mode: /today/:run/log?for=YYYY-MM-DD stamps every set log AND the
  // day-workout completion at the chosen past date rather than "now". Guard the
  // shape so a garbage `?for=` can't slip a malformed date into a POST body.
  const forParam = searchParams.get('for');
  const forDate = forParam && /^\d{4}-\d{2}-\d{2}$/.test(forParam) ? forParam : null;
  // Backfill is a MODE, so `?for=` must survive every hub↔focus hop inside the
  // logger — otherwise tapping an exercise would silently drop back to "now".
  const logSearch = forDate ? `?for=${forDate}` : '';

  // Workout-level completion (FINISH WORKOUT in the hub). Not per-exercise —
  // completing terminally closes the whole day workout (spec §2/§3).
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

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
    // No cancellation on cleanup: histRequested dedupes forever, so a result
    // dropped mid-flight (StrictMode re-fire, or any focusedEntry identity
    // change) would never be refetched. The caches are slug-keyed and the
    // prefill only touches untouched, unlogged rows, so a late write is safe.
    getExerciseHistory(slug, 1)
      .then((sessions) => {
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
        // History is a nicety — logging must not depend on it.
        setHistBySlug((prev) => ({ ...prev, [slug]: null }));
      });
  }, [focusedEntry]);

  // Setup-card guide per exercise slug: powers the ⓘ button + SetupCardSheet.
  // Fetched lazily when a block is first focused; the ref dedupes
  // in-flight/completed fetches so each slug is requested at most once.
  // null (no guide on the server, or fetch failed) hides ⓘ — guides are a
  // nicety and logging must not depend on them.
  const [guideBySlug, setGuideBySlug] = useState<Record<string, ExerciseGuide | null>>({});
  const guideRequested = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!focusedEntry) return;
    const slug = focusedEntry[1][0]?.exercise.slug;
    if (!slug || guideRequested.current.has(slug)) return;
    guideRequested.current.add(slug);
    // No cancellation on cleanup — same reasoning as the history effect above:
    // the ref dedupes forever, so a mid-flight drop would hide ⓘ for the
    // whole session. Slug-keyed cache writes are safe whenever they land.
    getExerciseGuide(slug)
      .then((guide) => {
        setGuideBySlug((prev) => ({ ...prev, [slug]: guide }));
      })
      .catch(() => {
        setGuideBySlug((prev) => ({ ...prev, [slug]: null }));
      });
  }, [focusedEntry]);

  // Bottom sheets — a single state slot so "both sheets open" is
  // unrepresentable (each sheet installs a document-level Escape listener at
  // the same z-index; two independent booleans could close both with one
  // keypress). State owns whether a sheet is mounted; HistorySheet fetches
  // its own data on mount (see logger/HistorySheet.tsx) while SetupCardSheet
  // receives the already-fetched guide. Reset whenever the focused block
  // changes (including back-to-hub, where focusedEntry is null) so a sheet
  // left open in one block doesn't pop back open when a different block is
  // later focused.
  const [openSheet, setOpenSheet] = useState<'history' | 'guide' | null>(null);
  useEffect(() => {
    setOpenSheet(null);
  }, [focusedEntry]);

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
      // Backfill mode stamps the chosen date at 12:00 user-local (noon keeps the
      // sample well clear of a midnight DST/tz date-flip); live logging stamps
      // now. `performed_at` is what the server buckets the set into a day by.
      const performedAt = forDate
        ? zonedNoonISO(forDate, currentUserTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
        : new Date().toISOString();
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
    [currentUserId, currentUserTz, forDate, rowInputs, setRow, focusNext, setQuotaError],
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

  // Sets neither server-logged nor logged this session — drives the
  // "N sets unlogged. Finish anyway?" confirm before a partial completion.
  const unloggedCount = useMemo(
    () => hubBlocks.reduce((n, b) => n + (b.setsTotal - b.setsDone), 0),
    [hubBlocks],
  );

  // Terminal, workout-level completion. `completed_on` backfills the chosen
  // date in backfill mode; omitted otherwise (server stamps now()). On success
  // we return to the today screen; a run-closing completion celebrates. On
  // failure we surface the server's own message and stay put — never silent,
  // never generic, never a navigation that loses the error.
  const doFinish = useCallback(async () => {
    setFinishing(true);
    setCompleteError(null);
    try {
      const res = await completeDayWorkout(data.day.id, { completed_on: forDate ?? undefined });
      if (res.run_completed) {
        pushToast({
          severity: 'success',
          body: 'MESOCYCLE COMPLETE. You finished the program — review it in history.',
        });
      }
      navigate('/');
    } catch (err: unknown) {
      setCompleteError(err instanceof Error ? err.message : String(err));
      setFinishing(false);
    }
  }, [data.day.id, forDate, navigate]);

  const requestFinish = useCallback(() => {
    if (unloggedCount > 0) setConfirmFinish(true);
    else void doFinish();
  }, [unloggedCount, doFinish]);

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

  // Backfill banner — a persistent mode indicator shown on BOTH the hub and the
  // focus screen (it's a mode for the whole logger session, not one screen).
  const backfillBanner = forDate ? (
    <div
      role="status"
      style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 0', boxSizing: 'border-box' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          background: 'rgba(245,181,68,0.1)',
          border: `1px solid ${TOKENS.warn}`,
          borderRadius: 8,
          padding: '10px 12px',
          color: TOKENS.warn,
          fontFamily: FONTS.ui,
          fontSize: 13,
        }}
      >
        <span style={{ fontWeight: 600 }}>Logging for </span>
        <span style={{ fontFamily: FONTS.mono, fontWeight: 700, letterSpacing: 0.3 }}>
          {formatBackfillDate(forDate)}
        </span>
      </div>
    </div>
  ) : null;

  // Completion-failure banner — server message verbatim, mirrors the quota
  // banner's danger treatment. Completion only fires from the hub.
  const completeErrorBanner = completeError ? (
    <div
      role="alert"
      style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 0', boxSizing: 'border-box' }}
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
        {`Couldn't finish workout — ${completeError}`}
      </div>
    </div>
  ) : null;

  if (!focusedEntry) {
    return (
      <div style={{ paddingBottom: restTimer.remaining != null ? 72 : 0 }}>
        {backfillBanner}
        {quotaBanner}
        {completeErrorBanner}
        <WorkoutHub
          dayName={data.day.name}
          blocks={hubBlocks}
          onOpenBlock={(blockIdx) => navigate(`/today/${data.run_id}/log/${blockIdx}${logSearch}`)}
          onFinish={requestFinish}
          finishing={finishing}
        />
        <ConfirmDialog
          open={confirmFinish}
          tier="medium"
          title={`${unloggedCount} set${unloggedCount === 1 ? '' : 's'} unlogged.`}
          body="This day will be marked complete with only the sets you've logged. Finish anyway?"
          confirmLabel={finishing ? 'Finishing…' : 'Finish Anyway'}
          onConfirm={() => {
            setConfirmFinish(false);
            void doFinish();
          }}
          onCancel={() => setConfirmFinish(false)}
        />
        <RestTimerPill remaining={restTimer.remaining} />
      </div>
    );
  }

  const [focusedIdx, focusedSets] = focusedEntry;
  const slug = focusedSets[0].exercise.slug;
  const meta = exMeta[slug];
  const guide = guideBySlug[slug] ?? null;
  const backToHub = () => navigate(`/today/${data.run_id}/log${logSearch}`);

  return (
    <div style={{ paddingBottom: restTimer.remaining != null ? 72 : 0 }}>
      {backfillBanner}
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
        onOpenHistory={() => setOpenSheet('history')}
        onOpenGuide={guide ? () => setOpenSheet('guide') : null}
        onBack={backToHub}
        onDone={backToHub}
        getWeightInputRef={getWeightInputRef}
      />
      {openSheet === 'history' ? (
        <HistorySheet slug={slug} track={data.track} onClose={() => setOpenSheet(null)} />
      ) : null}
      {openSheet === 'guide' && guide ? (
        <SetupCardSheet
          exerciseName={focusedSets[0].exercise.name}
          guide={guide}
          onClose={() => setOpenSheet(null)}
        />
      ) : null}
      <RestTimerPill remaining={restTimer.remaining} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// RestTimerPill — the REST m:ss pill. Rendered on both the hub and focus
// branches: a set is usually logged right before backing out to the hub to
// eye the next exercise, and the rest countdown needs to stay visible there
// too, not just while a block is focused.
// -----------------------------------------------------------------------------

function RestTimerPill({ remaining }: { remaining: number | null }) {
  if (remaining == null) return null;
  return (
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
      REST {formatRest(remaining)}
    </div>
  );
}

// m:ss with zero-padded seconds — 180 → "3:00".
function formatRest(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// Backfill date helpers.
//
// small-icu discipline (project_alpine_smallicu): build every date string from
// numeric `formatToParts` fields — never `.format()`'s locale-sensitive layout,
// which Alpine small-icu silently reshapes. These read the same regardless of
// the runtime ICU build.
// -----------------------------------------------------------------------------

// Offset (ms, +east) of `tz` at instant `at` — the wall-clock-minus-UTC diff.
function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24, // small-icu can render midnight as "24"
    Number(p.minute),
    Number(p.second),
  );
  return asUTC - at.getTime();
}

// ISO instant for `dateStr` (YYYY-MM-DD) at 12:00 in `tz`. Noon keeps the sample
// far from any midnight tz/DST date-flip, so the server buckets it on the day
// the user chose. DST never transitions at noon, so a single offset correction
// is exact.
function zonedNoonISO(dateStr: string, tz: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noonAsUTC = Date.UTC(y, m - 1, d, 12, 0, 0);
  const offset = tzOffsetMs(tz, new Date(noonAsUTC));
  return new Date(noonAsUTC - offset).toISOString();
}

// "Sunday, Jul 5" — weekday + short month + day, tz-independent (the date is a
// bare calendar day, read as UTC midnight so no local shift moves it).
function formatBackfillDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.month} ${p.day}`;
}
