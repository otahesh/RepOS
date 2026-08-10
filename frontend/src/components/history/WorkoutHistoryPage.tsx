import { useEffect, useMemo, useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { useIsMobile } from '../../lib/useIsMobile';
import { useCurrentUser } from '../../auth';
import {
  getWorkoutHistory,
  ApiError,
  type HistoryExercise,
  type HistoryItem,
  type HistorySet,
} from '../../lib/api/workoutHistory';
import { reopenDayWorkout } from '../../lib/api/dayWorkouts';
import { pushToast } from '../common/ToastHost';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { formatHistorySet } from '../programs/logger/HistorySheet';
import { formatSessionDate, formatZonedDate } from '../../lib/formatDate';
import Icon from '../Icon';
import { Button, DataState, Page, PageHeader, SegmentedControl, StatusBadge } from '../ui';

type DateFilter = '30d' | '90d' | '1y' | 'all';
type StatusFilter = 'all' | 'completed' | 'skipped';

// =============================================================================
// WorkoutHistoryPage — the /history surface (spec §4/§7).
//
// Finished (completed | skipped) day-workouts, newest first, keyset-paginated.
// Every item can be REOPENED, which puts it back into the active sequence as
// not-done — this is also the recovery path for a day skipped by mistake. The
// mutation is gated behind a confirm because it is a state change reachable
// from a browse surface.
//
// Layout is device-aware (project_device_split / no-desktop-exclusive rule):
// mobile is a flat single-column list; desktop groups cards under WEEK <n>
// headings in a two-column grid. Same data, same actions — only layout shifts.
// =============================================================================

export default function WorkoutHistoryPage() {
  const isMobile = useIsMobile();
  const { user } = useCurrentUser();
  // Display completion instants in the user's own zone. Fall back to the
  // runtime zone if the user record hasn't loaded (never guess UTC — a
  // late-night workout must not read as the next/previous day).
  const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reopenTarget, setReopenTarget] = useState<HistoryItem | null>(null);
  const [reopening, setReopening] = useState(false);
  const [exerciseFilter, setExerciseFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('90d');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredItems = useMemo(
    () => filterHistory(items ?? [], exerciseFilter, dateFilter, statusFilter),
    [items, exerciseFilter, dateFilter, statusFilter],
  );

  function load(): void {
    setError(null);
    setItems(null);
    getWorkoutHistory()
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.next_cursor);
        // Open the most recent workout by default so the page reads as a
        // finished session, not a wall of collapsed rows.
        setExpanded(page.items[0] ? new Set([page.items[0].id]) : new Set());
      })
      .catch((err: unknown) => {
        const msg = serverMessage(err);
        const status = err instanceof ApiError ? err.status : undefined;
        setError(
          `Couldn't load history — GET /api/workouts/history${
            msg ? `: ${msg}` : status ? ` returned HTTP ${status}` : ' failed (network)'
          }.`,
        );
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getWorkoutHistory(nextCursor);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (err) {
      const msg = serverMessage(err);
      const status = err instanceof ApiError ? err.status : undefined;
      pushToast({
        severity: 'error',
        body: `Couldn't load more history${
          msg ? ` — ${msg}` : status ? ` — HTTP ${status}` : ''
        }. Try again.`,
      });
    } finally {
      setLoadingMore(false);
    }
  }

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmReopen(): Promise<void> {
    if (!reopenTarget) return;
    const target = reopenTarget;
    setReopening(true);
    try {
      await reopenDayWorkout(target.id);
      setReopenTarget(null);
      // Reopening pulls the workout out of history (it is no longer terminal),
      // so refetch from the top rather than surgically splicing.
      load();
    } catch (err) {
      // Surface the server's recovery instruction (e.g. 409 "another program is
      // active — abandon it first"), not a bare status the user can't act on.
      const msg = serverMessage(err);
      const status = err instanceof ApiError ? err.status : undefined;
      setReopenTarget(null);
      pushToast({
        severity: 'error',
        body: `Couldn't reopen "${target.name}"${
          msg ? ` — ${msg}` : status ? ` — HTTP ${status}` : ' — request failed (network)'
        }.`,
      });
    } finally {
      setReopening(false);
    }
  }

  return (
    <Page
      width="wide"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, color: TOKENS.text }}
    >
      <PageHeader
        eyebrow="Progress"
        title="Workout history"
        description="Review completed and skipped workouts, compare prior performance, and recover an entry when needed."
      />

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 10,
            padding: 14,
            borderRadius: 10,
            border: `1px solid ${TOKENS.danger}`,
            background: 'rgba(255,106,106,0.08)',
            color: TOKENS.danger,
            fontFamily: FONTS.mono,
            fontSize: 12,
          }}
        >
          <span>{error}</span>
          <button type="button" onClick={load} style={retryBtnStyle}>
            Retry
          </button>
        </div>
      )}

      {!error && items === null && <HistorySkeleton isMobile={isMobile} />}

      {!error && items?.length === 0 && (
        <DataState
          title="No workouts yet"
          body="Complete or skip a workout and it will appear here with its logged performance."
        />
      )}

      {!error && items && items.length > 0 && (
        <>
          <HistoryFilters
            exercise={exerciseFilter}
            onExercise={setExerciseFilter}
            date={dateFilter}
            onDate={setDateFilter}
            status={statusFilter}
            onStatus={setStatusFilter}
          />

          {filteredItems.length === 0 ? (
            <DataState
              title="No workouts match these filters"
              body="Adjust the exercise, date range, or completion state to broaden the result."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setExerciseFilter('');
                    setDateFilter('all');
                    setStatusFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filteredItems.map((item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  tz={tz}
                  open={expanded.has(item.id)}
                  onToggle={() => toggle(item.id)}
                  onReopen={() => setReopenTarget(item)}
                  allItems={items}
                  isMobile
                />
              ))}
            </div>
          ) : (
            groupByWeek(filteredItems).map(([week, weekItems]) => (
              <section key={week} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h2
                  style={{
                    margin: '4px 0 0',
                    fontFamily: FONTS.mono,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    color: TOKENS.textDim,
                  }}
                >
                  WEEK {week}
                </h2>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 12,
                  }}
                >
                  {weekItems.map((item) => (
                    <HistoryCard
                      key={item.id}
                      item={item}
                      tz={tz}
                      open={expanded.has(item.id)}
                      onToggle={() => toggle(item.id)}
                      onReopen={() => setReopenTarget(item)}
                      allItems={items}
                      isMobile={false}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          {nextCursor && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              style={{
                alignSelf: 'center',
                marginTop: 8,
                padding: '10px 20px',
                borderRadius: 8,
                border: `1px solid ${TOKENS.line}`,
                background: TOKENS.surface,
                color: loadingMore ? TOKENS.textMute : TOKENS.text,
                fontFamily: FONTS.ui,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.5,
                cursor: loadingMore ? 'default' : 'pointer',
              }}
            >
              {loadingMore ? 'LOADING…' : 'LOAD MORE'}
            </button>
          )}
        </>
      )}

      <ConfirmDialog
        open={reopenTarget !== null}
        tier="medium"
        title="Reopen this workout?"
        body={
          reopenTarget
            ? `"${reopenTarget.name}" goes back into your active sequence as not-done. Any sets you already logged are kept.`
            : ''
        }
        confirmLabel={reopening ? 'Reopening…' : 'Reopen'}
        cancelLabel="Cancel"
        onConfirm={() => void confirmReopen()}
        onCancel={() => setReopenTarget(null)}
      />
    </Page>
  );
}

function HistoryFilters({
  exercise,
  onExercise,
  date,
  onDate,
  status,
  onStatus,
}: {
  exercise: string;
  onExercise: (value: string) => void;
  date: DateFilter;
  onDate: (value: DateFilter) => void;
  status: StatusFilter;
  onStatus: (value: StatusFilter) => void;
}) {
  return (
    <section
      aria-label="History filters"
      className="repos-card"
      style={{ padding: 14, display: 'grid', gap: 12 }}
    >
      <label className="repos-field">
        Exercise or workout
        <input
          type="search"
          value={exercise}
          placeholder="Filter by name"
          onChange={(event) => onExercise(event.target.value)}
        />
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <SegmentedControl
          label="History date range"
          value={date}
          options={[
            { value: '30d', label: '30 days' },
            { value: '90d', label: '90 days' },
            { value: '1y', label: '1 year' },
            { value: 'all', label: 'All time' },
          ]}
          onChange={onDate}
        />
        <SegmentedControl
          label="Workout completion state"
          value={status}
          options={[
            { value: 'all', label: 'All' },
            { value: 'completed', label: 'Completed' },
            { value: 'skipped', label: 'Skipped' },
          ]}
          onChange={onStatus}
        />
      </div>
    </section>
  );
}

function filterHistory(
  items: HistoryItem[],
  exerciseFilter: string,
  dateFilter: DateFilter,
  statusFilter: StatusFilter,
): HistoryItem[] {
  const query = exerciseFilter.trim().toLocaleLowerCase();
  const rangeDays =
    dateFilter === '30d' ? 30 : dateFilter === '90d' ? 90 : dateFilter === '1y' ? 365 : null;
  const cutoff = rangeDays === null ? null : Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (cutoff !== null) {
      const date = new Date(`${item.scheduled_date}T12:00:00`).getTime();
      if (Number.isFinite(date) && date < cutoff) return false;
    }
    if (!query) return true;
    return (
      item.name.toLocaleLowerCase().includes(query) ||
      item.exercises.some((exercise) => exercise.name.toLocaleLowerCase().includes(query))
    );
  });
}

// Preserve encounter order (API is newest-first): first-seen week ordering wins.
function groupByWeek(items: HistoryItem[]): Array<[number, HistoryItem[]]> {
  const groups = new Map<number, HistoryItem[]>();
  for (const item of items) {
    const bucket = groups.get(item.week_idx);
    if (bucket) bucket.push(item);
    else groups.set(item.week_idx, [item]);
  }
  return [...groups.entries()];
}

// The server returns a recovery instruction in ApiError.body.error (e.g. a 409
// "another program is active — abandon it first"). Surface it verbatim rather
// than a bare status code the user can't act on.
function serverMessage(err: unknown): string | null {
  if (err instanceof ApiError && err.body && typeof err.body === 'object' && 'error' in err.body) {
    return String((err.body as { error: unknown }).error);
  }
  return null;
}

function displayDate(item: HistoryItem, tz: string): string {
  // completed_at is an instant — localize it to the user's zone so a session
  // finished near local midnight shows the LOCAL calendar day, not the UTC one
  // (repo rule: never derive/display a UTC-shifted date). scheduled_date is a
  // bare DATE with no drift, so the UTC-midnight formatter is exact for it.
  return item.completed_at
    ? formatZonedDate(item.completed_at, tz)
    : formatSessionDate(item.scheduled_date);
}

function HistoryCard({
  item,
  tz,
  open,
  onToggle,
  onReopen,
  allItems,
  isMobile,
}: {
  item: HistoryItem;
  tz: string;
  open: boolean;
  onToggle: () => void;
  onReopen: () => void;
  allItems: HistoryItem[];
  isMobile: boolean;
}) {
  const skipped = item.status === 'skipped';
  const hasSets = item.exercises.some((ex) => ex.sets.length > 0);
  return (
    <div
      data-testid="history-card"
      style={{
        background: TOKENS.surface,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gridColumn: open && !isMobile ? '1 / -1' : undefined,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 14,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          fontFamily: 'inherit',
          width: '100%',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: FONTS.ui,
                fontSize: 14,
                fontWeight: 600,
                color: TOKENS.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </span>
            <KindBadge kind={item.kind} />
            {skipped && <SkippedBadge />}
          </div>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: TOKENS.textDim }}>
            {displayDate(item, tz)}
          </span>
        </div>
        <span
          style={{
            display: 'inline-flex',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease',
            color: TOKENS.textMute,
          }}
          aria-hidden="true"
        >
          <Icon name="chevronDown" size={16} />
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: '0 14px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            borderTop: `1px solid ${TOKENS.line}`,
            paddingTop: 12,
          }}
        >
          {!hasSets ? (
            <div style={{ fontSize: 13, color: TOKENS.textMute, fontFamily: FONTS.ui }}>
              {skipped ? 'Skipped — no sets logged.' : 'No sets logged.'}
            </div>
          ) : (
            item.exercises.map((ex) => {
              const comparison = compareExercise(item, ex, allItems);
              return (
                <div key={ex.slug} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 650, color: TOKENS.text }}>
                      {ex.name}
                    </div>
                    {comparison.isPr ? (
                      <StatusBadge tone="good">Personal record</StatusBadge>
                    ) : null}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isMobile
                        ? 'minmax(0, 1fr)'
                        : 'repeat(2, minmax(0, 1fr))',
                      gap: 8,
                    }}
                  >
                    <SetComparisonColumn label="This workout" sets={ex.sets} />
                    <SetComparisonColumn
                      label="Previous"
                      sets={comparison.previous?.sets ?? []}
                      emptyCopy={
                        comparison.previous ? 'No sets logged.' : 'First logged performance.'
                      }
                    />
                  </div>
                  {comparison.delta ? (
                    <div
                      style={{
                        color: comparison.isPr ? TOKENS.good : TOKENS.textDim,
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                      }}
                    >
                      {comparison.delta}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReopen();
              }}
              aria-label={`Reopen ${item.name}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 6,
                border: `1px solid ${TOKENS.accentDim}`,
                background: 'transparent',
                color: TOKENS.accent,
                fontFamily: FONTS.ui,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Icon name="swap" size={13} color={TOKENS.accent} />
              Reopen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SetComparisonColumn({
  label,
  sets,
  emptyCopy = 'No sets logged.',
}: {
  label: string;
  sets: HistorySet[];
  emptyCopy?: string;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: 10,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 8,
        background: TOKENS.bg,
      }}
    >
      <div
        style={{
          marginBottom: 6,
          color: TOKENS.textMute,
          fontFamily: FONTS.mono,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.7,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      {sets.length === 0 ? (
        <div style={{ color: TOKENS.textMute, fontSize: 12 }}>{emptyCopy}</div>
      ) : (
        sets.map((set, index) => (
          <div
            key={`${set.performed_at}-${index}`}
            style={{ fontFamily: FONTS.mono, fontSize: 12, color: TOKENS.text, lineHeight: 1.6 }}
          >
            {formatSet(set)}
          </div>
        ))
      )}
    </div>
  );
}

function compareExercise(item: HistoryItem, exercise: HistoryExercise, allItems: HistoryItem[]) {
  const itemIndex = allItems.findIndex((candidate) => candidate.id === item.id);
  const older = allItems
    .slice(itemIndex + 1)
    .flatMap((candidate) => candidate.exercises)
    .filter((candidate) => candidate.slug === exercise.slug && candidate.sets.length > 0);
  const previous = older[0] ?? null;
  const currentTop = topSet(exercise.sets);
  const previousTop = topSet(previous?.sets ?? []);
  if (!currentTop) return { previous, isPr: false, delta: null as string | null };

  const usesLoad = currentTop.weight_lbs !== null;
  const currentMetric = usesLoad ? (currentTop.weight_lbs ?? 0) : (currentTop.reps ?? 0);
  const olderBest = older.reduce((best, candidate) => {
    const top = topSet(candidate.sets);
    const metric = usesLoad ? (top?.weight_lbs ?? 0) : (top?.reps ?? 0);
    return Math.max(best, metric);
  }, 0);
  const isPr = older.length > 0 && currentMetric > olderBest;

  let delta: string | null = null;
  if (previousTop) {
    const changes: string[] = [];
    if (currentTop.weight_lbs !== null && previousTop.weight_lbs !== null) {
      const loadDelta = currentTop.weight_lbs - previousTop.weight_lbs;
      if (Math.abs(loadDelta) >= 0.05)
        changes.push(`${loadDelta > 0 ? '+' : ''}${loadDelta.toFixed(1)} lb`);
    }
    if (currentTop.reps !== null && previousTop.reps !== null) {
      const repDelta = currentTop.reps - previousTop.reps;
      if (repDelta !== 0) changes.push(`${repDelta > 0 ? '+' : ''}${repDelta} reps`);
    }
    delta = changes.length > 0 ? `${changes.join(' · ')} vs previous` : 'Matched previous top set';
  }

  return { previous, isPr, delta };
}

function topSet(sets: HistorySet[]): HistorySet | null {
  if (sets.length === 0) return null;
  return [...sets].sort((a, b) => {
    const load = (b.weight_lbs ?? 0) - (a.weight_lbs ?? 0);
    if (load !== 0) return load;
    return (b.reps ?? 0) - (a.reps ?? 0);
  })[0];
}

// Non-beginner formatting (`135 × 8 @RIR 2` / `BW × 8`) — history is a review
// surface where the logged RIR is always shown. Reuses the canonical set
// formatter so the string matches the logger's history sheet exactly.
function formatSet(set: HistorySet): string {
  return formatHistorySet(set, false);
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span
      style={{
        fontFamily: FONTS.mono,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: TOKENS.textDim,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 4,
        padding: '2px 6px',
        background: TOKENS.surface2,
      }}
    >
      {kind}
    </span>
  );
}

function SkippedBadge() {
  return (
    <span
      style={{
        fontFamily: FONTS.mono,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: TOKENS.warn,
        border: `1px solid ${TOKENS.warn}`,
        borderRadius: 4,
        padding: '2px 6px',
        background: 'rgba(245,181,68,0.12)',
      }}
    >
      Skipped
    </span>
  );
}

function HistorySkeleton({ isMobile }: { isMobile: boolean }) {
  const rows = [0, 1, 2];
  return (
    <div
      role="status"
      aria-label="Loading workout history"
      style={{
        display: isMobile ? 'flex' : 'grid',
        flexDirection: isMobile ? 'column' : undefined,
        gridTemplateColumns: isMobile ? undefined : 'repeat(2, minmax(0, 1fr))',
        gap: 12,
      }}
    >
      <style>
        {'@keyframes repos-history-skeleton { 0%,100% { opacity: 0.35 } 50% { opacity: 0.7 } }'}
      </style>
      {rows.map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            background: TOKENS.surface,
            border: `1px solid ${TOKENS.line}`,
            borderRadius: 12,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            animation: 'repos-history-skeleton 1.3s ease-in-out infinite',
          }}
        >
          <div style={{ height: 14, width: '55%', borderRadius: 4, background: TOKENS.surface3 }} />
          <div style={{ height: 10, width: '35%', borderRadius: 4, background: TOKENS.surface2 }} />
        </div>
      ))}
    </div>
  );
}

const retryBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: `1px solid ${TOKENS.line}`,
  background: TOKENS.bg,
  color: TOKENS.text,
  fontFamily: FONTS.ui,
  fontSize: 12,
  cursor: 'pointer',
};
