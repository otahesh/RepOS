import { useCallback, useEffect, useState } from 'react';
import { rpeFromRir } from '../../lib/effort';
import { Link, useNavigate } from 'react-router-dom';
import { getTodayWorkout, type TodayWorkoutResponse } from '../../lib/api/mesocycles';
import { skipDayWorkout } from '../../lib/api/dayWorkouts';
import { Term } from '../Term';
import { isBeginnerTrack, effortCue } from '../../lib/programTracks';
import { MidSessionSwapSheet } from './MidSessionSwapSheet';
import { BlockOverflowMenu } from './BlockOverflowMenu';
import { MidSessionSwapPicker } from './MidSessionSwapPicker';
import { DeloadThisWeekButton } from './DeloadThisWeekButton';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PacingChip } from './PacingChip';
import { formatSessionDate } from './logger/HistorySheet';
import { pushToast } from '../common/ToastHost';

type SwapTarget = { plannedSetId: string; fromName: string; toId: string; toName: string };

// Local wall-clock "today" (YYYY-MM-DD) — max a past-workout backfill can
// target. Local date, not UTC, so a late-evening user can't pick "tomorrow".
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// onStart is retained for backwards compatibility with existing test fixtures
// and TodayPage's wiring; the actual navigation now uses react-router-dom's
// navigate() to push /today/:runId/log. The onStart callback (if provided) is
// still invoked so callers can attach analytics or other side effects.
export function TodayWorkoutMobile({
  onStart,
}: { onStart?: (runId: string, dayId: string) => void } = {}) {
  const navigate = useNavigate();
  const [data, setData] = useState<TodayWorkoutResponse | null>(null);
  const [swapTarget, setSwapTarget] = useState<SwapTarget | null>(null);
  // W3.3 Task 17/18 — independent from swapTarget (which drives the inline
  // "Suggested sub" flow). pickerTargetBlockIdx drives the "Got a tweak?"
  // picker, which lists ranked candidates before opening the confirm sheet.
  const [pickerTargetBlockIdx, setPickerTargetBlockIdx] = useState<number | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [logPastOpen, setLogPastOpen] = useState(false);
  const [pastDate, setPastDate] = useState('');

  const fetchToday = useCallback(() => {
    getTodayWorkout()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);
  if (!data) return <div style={{ padding: 16, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;
  if (data.state === 'no_active_run')
    return (
      <div style={{ padding: 16, color: 'rgba(255,255,255,0.7)' }}>
        {'No active '}
        <Term k="mesocycle" />
        {'. '}
        <Link to="/programs" style={{ color: '#4D8DFF' }}>
          Browse programs
        </Link>
      </div>
    );
  if (data.state === 'mesocycle_complete')
    return (
      <div style={{ padding: 16, color: '#fff', fontFamily: 'Inter Tight' }}>
        <strong style={{ color: '#6BE28B' }}>Program complete.</strong>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
          {'Review it in '}
          <Link to="/history" style={{ color: '#4D8DFF' }}>
            history
          </Link>
          {'.'}
        </div>
      </div>
    );
  const { day, sets, cardio, pacing, completed_today } = data;
  const behind = pacing?.status === 'behind';

  const handleSkip = async () => {
    setSkipping(true);
    try {
      await skipDayWorkout(day.id);
      setConfirmSkip(false);
      fetchToday();
    } catch (e) {
      pushToast({
        severity: 'error',
        body: `Skip failed — ${e instanceof Error ? e.message : String(e)}.`,
      });
      setConfirmSkip(false);
    } finally {
      setSkipping(false);
    }
  };

  // Group sets by block_idx to show "exercise → N sets"
  const groups = new Map<number, typeof sets>();
  for (const s of sets) {
    if (!groups.has(s.block_idx)) groups.set(s.block_idx, []);
    groups.get(s.block_idx)!.push(s);
  }
  return (
    <div
      style={{
        padding: 16,
        fontFamily: 'Inter Tight',
        color: '#fff',
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      <header
        style={{
          marginBottom: 16,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div
              style={{
                fontFamily: 'JetBrains Mono',
                fontSize: 10,
                letterSpacing: 1,
                color: '#4D8DFF',
                textTransform: 'uppercase',
              }}
            >
              Week {day.week_idx} · Day {day.day_idx + 1}
            </div>
            {pacing?.status ? <PacingChip pacing={pacing} /> : null}
          </div>
          {completed_today ? (
            <>
              <h2 style={{ margin: '4px 0 0', fontSize: 22, color: '#6BE28B' }}>Done for today.</h2>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                Next up: {day.name}
                {pacing?.suggested_date
                  ? ` (suggested ${formatSessionDate(pacing.suggested_date)})`
                  : ''}
              </div>
            </>
          ) : (
            <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>{day.name}</h2>
          )}
        </div>
        {/* W2.6 — session-level manual deload (mobile). */}
        <DeloadThisWeekButton runId={data.run_id} onChanged={fetchToday} />
      </header>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {[...groups.entries()].map(([blockIdx, blockSets]) => {
          const first = blockSets[0];
          return (
            <li
              key={blockIdx}
              style={{
                background: '#10141C',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 15 }}>{first.exercise.name}</div>
                <BlockOverflowMenu
                  blockName={first.exercise.name}
                  blockIdx={blockIdx}
                  onGotATweak={() => setPickerTargetBlockIdx(blockIdx)}
                />
              </div>
              <div
                style={{
                  fontFamily: 'JetBrains Mono',
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.6)',
                  marginTop: 4,
                }}
              >
                {blockSets.length} <Term k="working_set" compact />
                {'s · '}
                {first.target_duration_low_sec != null ? (
                  <>
                    {first.target_duration_low_sec}
                    {'–'}
                    {first.target_duration_high_sec}
                    {'s '}
                    <Term k="hold" compact />
                    {' · '}
                  </>
                ) : (
                  <>
                    {first.target_reps_low}
                    {'–'}
                    {first.target_reps_high}
                    {' reps · '}
                  </>
                )}
                {isBeginnerTrack(data.track) ? (
                  effortCue(
                    first.target_rir,
                    first.target_duration_low_sec != null ? 'duration' : 'reps',
                  )
                ) : first.target_duration_low_sec != null ? (
                  <>
                    <Term k="RPE" compact /> {rpeFromRir(first.target_rir)}
                  </>
                ) : (
                  <>
                    <Term k="RIR" compact /> {first.target_rir}
                  </>
                )}
                {' · '}
                {first.rest_sec}
                {'s rest'}
              </div>
              {first.suggested_substitution ? (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#F5B544' }}>
                    {'Suggested sub: '}
                    {first.suggested_substitution.name}
                    {' ('}
                    {first.suggested_substitution.reason}
                    {')'}
                  </span>
                  <button
                    onClick={() =>
                      setSwapTarget({
                        plannedSetId: first.id,
                        fromName: first.exercise.name,
                        toId: first.suggested_substitution!.id,
                        toName: first.suggested_substitution!.name,
                      })
                    }
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      fontSize: 11,
                      color: '#F5B544',
                      textDecoration: 'underline',
                      fontFamily: 'Inter Tight',
                    }}
                  >
                    {'Swap'}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
        {cardio.map((c) => (
          <li
            key={c.id}
            style={{
              background: '#10141C',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15 }}>{c.exercise.name}</div>
            <div
              style={{
                fontFamily: 'JetBrains Mono',
                fontSize: 11,
                color: 'rgba(255,255,255,0.6)',
                marginTop: 4,
              }}
            >
              {c.target_duration_sec ? `${Math.round(c.target_duration_sec / 60)} min` : null}
              {c.target_distance_m ? ` · ${(c.target_distance_m / 1000).toFixed(1)} km` : null}
              {c.target_zone ? (
                <>
                  {' · '}
                  <Term k={`Z${c.target_zone}` as 'Z2' | 'Z4' | 'Z5'} compact />
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <button
        onClick={() => {
          onStart?.(data.run_id, day.id);
          navigate(`/today/${data.run_id}/log`);
        }}
        style={{
          marginTop: 24,
          padding: '14px',
          width: '100%',
          background: '#4D8DFF',
          border: 'none',
          borderRadius: 8,
          color: '#fff',
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: 'uppercase',
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        {completed_today ? 'Start Anyway' : 'Start Workout'}
      </button>

      <div
        style={{
          display: 'flex',
          gap: 20,
          marginTop: 14,
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button onClick={() => setConfirmSkip(true)} style={textBtn('rgba(255,255,255,0.6)')}>
          Skip
        </button>
        {behind && !logPastOpen ? (
          <button
            onClick={() => {
              setPastDate(pacing.suggested_date);
              setLogPastOpen(true);
            }}
            style={textBtn('#F5B544')}
          >
            Log Past Workout
          </button>
        ) : null}
      </div>

      {behind && logPastOpen ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 12,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <input
            type="date"
            aria-label="Log a past workout — date"
            value={pastDate}
            min={data.start_date}
            max={todayISO()}
            onChange={(e) => setPastDate(e.target.value)}
            style={{
              background: '#0A0D12',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 6,
              color: '#fff',
              fontFamily: 'JetBrains Mono',
              fontSize: 13,
              padding: '8px',
            }}
          />
          <button
            onClick={() => navigate(`/today/${data.run_id}/log?for=${pastDate}`)}
            disabled={!pastDate}
            style={{
              padding: '8px 16px',
              background: pastDate ? '#F5B544' : 'rgba(245,181,68,0.3)',
              border: 'none',
              borderRadius: 6,
              color: '#0A0D12',
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: 'uppercase',
              fontSize: 12,
              cursor: pastDate ? 'pointer' : 'not-allowed',
            }}
          >
            Log
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmSkip}
        tier="medium"
        severity="danger"
        title={`Skip ${day.name}?`}
        body="It won't count toward your program. You can reopen it later from history."
        confirmLabel={skipping ? 'Skipping…' : 'Skip'}
        onConfirm={() => void handleSkip()}
        onCancel={() => setConfirmSkip(false)}
      />

      {swapTarget ? (
        <MidSessionSwapSheet
          plannedSetId={swapTarget.plannedSetId}
          fromName={swapTarget.fromName}
          toId={swapTarget.toId}
          toName={swapTarget.toName}
          onClose={(changed) => {
            setSwapTarget(null);
            if (changed) fetchToday();
          }}
        />
      ) : null}
      {pickerTargetBlockIdx !== null &&
        (() => {
          const blockSets = groups.get(pickerTargetBlockIdx);
          if (!blockSets || blockSets.length === 0) return null;
          const first = blockSets[0];
          return (
            <MidSessionSwapPicker
              plannedSetId={first.id}
              fromName={first.exercise.name}
              fromSlug={first.exercise.slug}
              onClose={(changed) => {
                setPickerTargetBlockIdx(null);
                if (changed) fetchToday();
              }}
            />
          );
        })()}
    </div>
  );
}

function textBtn(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    padding: 0,
    color,
    fontFamily: 'Inter Tight',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase',
    cursor: 'pointer',
  };
}
