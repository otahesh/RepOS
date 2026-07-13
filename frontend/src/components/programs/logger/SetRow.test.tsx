import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetRow, type RowInputs, type RowState } from './SetRow';
import type { TodaySet } from '../../../lib/api/mesocycles';

// ---- Fixtures ---------------------------------------------------------------

const REPS_SET: TodaySet = {
  id: 'ps-reps',
  block_idx: 0,
  set_idx: 0,
  exercise: { id: 'e-1', slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
  target_reps_low: 6,
  target_reps_high: 8,
  target_rir: 2,
  rest_sec: 180,
  logged: null,
};

const HOLD_SET: TodaySet = {
  id: 'ps-hold',
  block_idx: 1,
  set_idx: 0,
  exercise: {
    id: 'e-2',
    slug: 'side-plank',
    name: 'Side Plank',
    bodyweight: true,
    measurement: 'duration',
  },
  target_reps_low: null,
  target_reps_high: null,
  target_duration_low_sec: 30,
  target_duration_high_sec: 45,
  target_rir: 2,
  rest_sec: 60,
  logged: null,
};

const emptyInputs = (): RowInputs => ({
  weight: '',
  reps: '',
  durationSec: '',
  rir: 2,
  holdRpe: null,
});

const inputState: RowState = { phase: 'input' };

function renderRow(set: TodaySet, inputs: RowInputs, onInputChange = vi.fn(), onLog = vi.fn()) {
  render(
    <SetRow
      set={set}
      state={inputState}
      inputs={inputs}
      onInputChange={onInputChange}
      onLog={onLog}
      onSkip={vi.fn()}
      weightInputRef={() => {}}
    />,
  );
  return { onInputChange, onLog };
}

describe('<SetRow> duration mode', () => {
  it('renders seconds input + HOLD chip + stopwatch; no reps input, no RIR slider', () => {
    renderRow(HOLD_SET, emptyInputs());
    expect(screen.getByLabelText(/hold seconds/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/reps$/i)).not.toBeInTheDocument();
    expect(screen.getByText('HOLD')).toBeInTheDocument();
    expect(screen.queryByLabelText(/RIR — reps in reserve/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start hold timer/i })).toBeInTheDocument();
  });

  it('renders the duration target range, not a load hint', () => {
    renderRow(HOLD_SET, emptyInputs());
    expect(screen.getByText(/target 30–45s/)).toBeInTheDocument();
  });

  it('legacy in-flight row (duration exercise, reps targets) renders REPS mode', () => {
    const legacy: TodaySet = {
      ...HOLD_SET,
      id: 'ps-legacy',
      target_reps_low: 8,
      target_reps_high: 15,
      target_duration_low_sec: null,
      target_duration_high_sec: null,
    };
    renderRow(legacy, emptyInputs());
    expect(screen.getByLabelText(/reps$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/hold seconds/i)).not.toBeInTheDocument();
    expect(screen.queryByText('HOLD')).not.toBeInTheDocument();
  });

  it('Log gate: seconds required (bodyweight hold unlocks on seconds alone)', () => {
    renderRow(HOLD_SET, emptyInputs());
    expect(screen.getByRole('button', { name: /^log/i })).toBeDisabled();
  });

  it('Log gate opens when seconds are filled', () => {
    renderRow(HOLD_SET, { ...emptyInputs(), durationSec: '40' });
    expect(screen.getByRole('button', { name: /^log/i })).toBeEnabled();
  });

  it('optional RPE control: values 5–10, tap selects, second tap clears; none preselected', async () => {
    const user = userEvent.setup();
    const { onInputChange } = renderRow(HOLD_SET, emptyInputs());
    for (const n of [5, 6, 7, 8, 9, 10]) {
      expect(screen.getByRole('button', { name: `RPE ${n}` })).toBeInTheDocument();
    }
    expect(screen.getByText('—')).toBeInTheDocument(); // nothing preselected
    await user.click(screen.getByRole('button', { name: 'RPE 8' }));
    expect(onInputChange).toHaveBeenLastCalledWith({ holdRpe: 8 });
  });

  it('tapping the selected RPE clears it back to null', async () => {
    const user = userEvent.setup();
    const { onInputChange } = renderRow(HOLD_SET, { ...emptyInputs(), holdRpe: 8 });
    await user.click(screen.getByRole('button', { name: 'RPE 8' }));
    expect(onInputChange).toHaveBeenLastCalledWith({ holdRpe: null });
  });
});

describe('<SetRow> stopwatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start → stop fills the seconds input via onInputChange', () => {
    const onInputChange = vi.fn();
    render(
      <SetRow
        set={HOLD_SET}
        state={inputState}
        inputs={emptyInputs()}
        onInputChange={onInputChange}
        onLog={vi.fn()}
        onSkip={vi.fn()}
        weightInputRef={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /start hold timer/i }));
    for (let i = 0; i < 30; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    fireEvent.click(screen.getByRole('button', { name: /stop hold timer/i }));
    expect(onInputChange).toHaveBeenLastCalledWith({ durationSec: '30' });
  });
});

describe('<SetRow> reps mode (unchanged behavior)', () => {
  it('renders weight + reps + RIR exactly as before', () => {
    renderRow(REPS_SET, emptyInputs());
    expect(screen.getByLabelText(/weight in pounds/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reps$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/RIR — reps in reserve/i)).toBeInTheDocument();
    expect(screen.queryByText('HOLD')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start hold timer/i })).not.toBeInTheDocument();
  });
});
