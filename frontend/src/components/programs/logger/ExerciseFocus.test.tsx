import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseFocus } from './ExerciseFocus';
import type { RowState, RowInputs } from './SetRow';
import type { TodaySet } from '../../../lib/api/mesocycles';
import type { HistorySession } from '../../../lib/api/exerciseHistory';

// ---- Fixtures ---------------------------------------------------------------

const SET_1: TodaySet = {
  id: 'ps-1',
  block_idx: 0,
  set_idx: 0,
  exercise: { id: 'e-1', slug: 'barbell-bench-press', name: 'Barbell Bench Press' },
  target_reps_low: 6,
  target_reps_high: 8,
  target_rir: 2,
  rest_sec: 180,
  logged: null,
};

const SET_2: TodaySet = {
  ...SET_1,
  id: 'ps-2',
  set_idx: 1,
};

const SETS = [SET_1, SET_2];

const EXERCISE = {
  name: 'Barbell Bench Press',
  muscle: 'chest',
  equipmentLabel: 'Barbell',
  slug: 'barbell-bench-press',
};

function rowStates(): Record<string, RowState> {
  return {
    'ps-1': { phase: 'input' },
    'ps-2': { phase: 'input' },
  };
}

function rowInputs(): Record<string, RowInputs> {
  return {
    'ps-1': { weight: '185', reps: '7', durationSec: '', rir: 2, holdRpe: null },
    'ps-2': { weight: '', reps: '', durationSec: '', rir: 2, holdRpe: null },
  };
}

function baseProps(overrides: Partial<Parameters<typeof ExerciseFocus>[0]> = {}) {
  return {
    position: { current: 2, total: 5 },
    exercise: EXERCISE,
    sets: SETS,
    track: null as string | null,
    rowStates: rowStates(),
    rowInputs: rowInputs(),
    onInputChange: vi.fn(),
    onLog: vi.fn(),
    onSkip: vi.fn(),
    lastSession: null as HistorySession | null,
    onOpenHistory: vi.fn(),
    onBack: vi.fn(),
    onDone: vi.fn(),
    onOpenGuide: null as (() => void) | null,
    ...overrides,
  };
}

describe('<ExerciseFocus>', () => {
  it('renders header with position, chip, equipment subtitle and history button', () => {
    render(<ExerciseFocus {...baseProps()} />);
    expect(screen.getByText(/2 OF 5/i)).toBeInTheDocument();
    expect(screen.getByText(/chest/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Barbell Bench Press' })).toBeInTheDocument();
    expect(screen.getByText('Barbell')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exercise history/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /how to do this exercise/i }),
    ).not.toBeInTheDocument();
  });

  it('renders a SetRow per set with prefilled inputs from rowInputs', () => {
    render(<ExerciseFocus {...baseProps()} />);
    expect(screen.getByTestId('set-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('set-row-1')).toBeInTheDocument();
    const row0 = within(screen.getByTestId('set-row-0'));
    expect(row0.getByLabelText(/weight in pounds/i)).toHaveValue(185);
    expect(row0.getByLabelText(/Set 1 reps/i)).toHaveValue(7);
  });

  it('shows the last-time line from lastSession', () => {
    const lastSession: HistorySession = {
      date: '2026-06-30',
      sets: [
        { weight_lbs: 25, reps: 9, rir: 2 },
        { weight_lbs: 25, reps: 9, rir: 2 },
      ],
    };
    render(<ExerciseFocus {...baseProps({ lastSession })} />);
    expect(screen.getByText(/last time: 25 lbs × 9, 9/i)).toBeInTheDocument();
  });

  it('beginner track shows plain-language cue and no RIR text', () => {
    render(<ExerciseFocus {...baseProps({ track: 'beginner' })} />);
    expect(screen.getByText(/leave 2 reps in the tank/i)).toBeInTheDocument();
    expect(screen.queryByText(/RIR/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('slider', { name: /RIR/i }).length).toBe(0);
  });

  it('DONE calls onDone; back calls onBack; history calls onOpenHistory', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<ExerciseFocus {...props} />);

    await user.click(screen.getByRole('button', { name: /done, back to plan/i }));
    expect(props.onDone).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /^back to plan$/i }));
    expect(props.onBack).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /exercise history/i }));
    expect(props.onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('does not render an empty muscle chip when metadata has not loaded yet', () => {
    render(<ExerciseFocus {...baseProps({ exercise: { ...EXERCISE, muscle: '' } })} />);
    expect(screen.queryByTestId('muscle-chip')).not.toBeInTheDocument();
  });
});

describe('ⓘ how-to button', () => {
  it('renders and fires when onOpenGuide is provided', () => {
    const onOpenGuide = vi.fn();
    render(<ExerciseFocus {...baseProps({ onOpenGuide })} />);
    const btn = screen.getByRole('button', { name: /how to do this exercise/i });
    fireEvent.click(btn);
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });

  it('is absent when onOpenGuide is null (no guide → hide ⓘ, per spec)', () => {
    render(<ExerciseFocus {...baseProps({ onOpenGuide: null })} />);
    expect(
      screen.queryByRole('button', { name: /how to do this exercise/i }),
    ).not.toBeInTheDocument();
  });

  it('history button still renders alongside ⓘ', () => {
    render(<ExerciseFocus {...baseProps({ onOpenGuide: vi.fn() })} />);
    expect(screen.getByRole('button', { name: /exercise history/i })).toBeInTheDocument();
  });
});
