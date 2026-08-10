import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getTodayWorkout, type TodayWorkoutResponse } from '../../lib/api/mesocycles';
import { skipDayWorkout } from '../../lib/api/dayWorkouts';
import { Term } from '../Term';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PacingChip } from './PacingChip';
import { formatSessionDate } from './logger/HistorySheet';
import { pushToast } from '../common/ToastHost';
import { Button, DataState } from '../ui';

export function TodayCard({ onStart }: { onStart?: (runId: string, dayId: string) => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<TodayWorkoutResponse | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [logPastOpen, setLogPastOpen] = useState(false);
  const [pastDate, setPastDate] = useState('');
  const [loadError, setLoadError] = useState(false);

  const fetchToday = useCallback(() => {
    setLoadError(false);
    getTodayWorkout()
      .then(setData)
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  if (loadError)
    return (
      <DataState
        compact
        kind="error"
        title="Today's workout could not be loaded"
        body="Your training plan was not changed."
        action={
          <Button variant="secondary" onClick={fetchToday}>
            Retry
          </Button>
        }
      />
    );
  if (!data) return <DataState kind="loading" title="Loading…" />;
  if (data.state === 'no_active_run')
    return <div style={card('rgba(255,255,255,0.5)')}>Pick a program to get started.</div>;
  if (data.state === 'mesocycle_complete')
    return (
      <div style={card('#6BE28B')}>
        <strong>Program complete.</strong>
        <br />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
          {'Review it in '}
          <Link to="/history" style={{ color: '#4D8DFF' }}>
            history
          </Link>
          {'.'}
        </span>
      </div>
    );

  const { day, sets, pacing, completed_today, run_id } = data;
  const behind = pacing?.status === 'behind';

  async function handleSkip() {
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
  }

  return (
    <div style={card('#4D8DFF')}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
            letterSpacing: 1,
            color: '#4D8DFF',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Week {day.week_idx} · Day {day.day_idx + 1}
        </div>
        {pacing?.status ? <PacingChip pacing={pacing} /> : null}
      </div>

      {completed_today ? (
        <>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, color: '#6BE28B' }}>Done for today.</h3>
          <div
            style={{
              fontSize: 13,
              color: 'rgba(255,255,255,0.7)',
              marginBottom: 12,
            }}
          >
            Next up: {day.name}
            {pacing?.suggested_date
              ? ` (suggested ${formatSessionDate(pacing.suggested_date)})`
              : ''}
          </div>
        </>
      ) : (
        <>
          <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#fff' }}>{day.name}</h3>
          <div
            style={{
              fontFamily: 'JetBrains Mono',
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
              marginBottom: 12,
            }}
          >
            {sets.length} <Term k="working_set" compact />
            {'s'}
          </div>
        </>
      )}

      <button
        onClick={() => {
          if (onStart) onStart(run_id, day.id);
          else navigate(`/today/${run_id}/log`);
        }}
        style={primaryBtn}
      >
        {completed_today ? 'Start Anyway' : 'Start Workout'}
      </button>

      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setConfirmSkip(true)} style={textBtn('rgba(255,255,255,0.6)')}>
          Skip
        </button>
        {behind ? (
          <button onClick={() => setLogPastOpen((open) => !open)} style={textBtn('#F5B544')}>
            Log Past Workout
          </button>
        ) : null}
      </div>

      {behind && logPastOpen ? (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: '1px solid rgba(245,181,68,0.45)',
            borderRadius: 8,
            background: 'rgba(245,181,68,0.07)',
            display: 'flex',
            alignItems: 'end',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <label style={{ display: 'grid', gap: 5, color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
            Workout date
            <input
              type="date"
              value={pastDate}
              min={data.start_date}
              max={todayISO()}
              onChange={(event) => setPastDate(event.target.value)}
              style={{
                minHeight: 44,
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 7,
                background: '#0A0D12',
                color: '#E8EEF7',
                padding: '0 10px',
                colorScheme: 'dark',
              }}
            />
          </label>
          <button
            type="button"
            disabled={!pastDate}
            onClick={() => navigate(`/today/${run_id}/log?for=${pastDate}`)}
            style={{ ...primaryBtn, width: 'auto', minHeight: 44, opacity: pastDate ? 1 : 0.5 }}
          >
            Open logger
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
    </div>
  );
}

function todayISO(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

const primaryBtn: React.CSSProperties = {
  padding: '12px 18px',
  width: '100%',
  background: '#4D8DFF',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  fontWeight: 600,
  letterSpacing: 1,
  textTransform: 'uppercase',
  cursor: 'pointer',
};

function textBtn(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    minWidth: 44,
    minHeight: 44,
    padding: '0 8px',
    color,
    fontFamily: 'Inter Tight',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase',
    cursor: 'pointer',
  };
}

function card(accent: string): React.CSSProperties {
  return {
    background: '#10141C',
    border: `1px solid ${accent}`,
    borderRadius: 12,
    padding: 16,
    fontFamily: 'Inter Tight',
    color: '#fff',
  };
}
