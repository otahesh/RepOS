import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TodayLoggerMobile from './TodayLoggerMobile';
import { logBuffer } from '../../lib/logBuffer';
import type { QueueRowStatus } from '../../hooks/useIdbQueueStatus';
import type { TodayDay, TodaySet } from '../../lib/api/mesocycles';
import type { ExerciseGuide } from '../../lib/api/exerciseGuide';
import type { HistorySession } from '../../lib/api/exerciseHistory';

// ---- Mocks ------------------------------------------------------------------

vi.mock('../../auth', () => ({
  useCurrentUser: () => ({
    status: 'authenticated' as const,
    user: {
      id: 'user-1',
      email: 'tester@example.com',
      display_name: 'Tester',
      timezone: 'America/New_York',
    },
    error: null,
  }),
}));

// Force the queue-status hook to return a deterministic value per test so we
// don't couple to its internal 500ms interval. Per-row keyed by clientRequestId
// so W1.3.5 (SyncStatusPill, née LogBufferRecovery) can assert mixed-status rendering.
const __mockedQueueStatuses = new Map<string, QueueRowStatus>();
vi.mock('../../hooks/useIdbQueueStatus', () => ({
  useIdbQueueStatus: (crid: string | null) =>
    crid == null ? 'unknown' : (__mockedQueueStatuses.get(crid) ?? 'pending'),
}));

// History powers prefill + the last-time line; default is "no history".
// Guides power the ⓘ setup card; default is "no guide" (ⓘ hidden) so the
// pre-existing tests are undisturbed.
const {
  getExerciseHistoryMock,
  listExercisesMock,
  getExerciseGuideMock,
  completeDayWorkoutMock,
  getTodayWorkoutMock,
  pushToastMock,
} = vi.hoisted(() => ({
  getExerciseHistoryMock: vi.fn(),
  listExercisesMock: vi.fn(),
  getExerciseGuideMock: vi.fn(),
  completeDayWorkoutMock: vi.fn(),
  getTodayWorkoutMock: vi.fn(),
  pushToastMock: vi.fn(),
}));
vi.mock('../../lib/api/exerciseHistory', () => ({
  getExerciseHistory: getExerciseHistoryMock,
}));
vi.mock('../../lib/api/exercises', () => ({
  listExercises: listExercisesMock,
}));
vi.mock('../../lib/api/exerciseGuide', () => ({
  getExerciseGuide: getExerciseGuideMock,
}));
vi.mock('../../lib/api/dayWorkouts', () => ({
  completeDayWorkout: completeDayWorkoutMock,
}));
// getTodayWorkout is only reached when the logger is rendered WITHOUT the
// `preloaded` test hatch (the load-state branch). preloaded tests never call it.
vi.mock('../../lib/api/mesocycles', () => ({
  getTodayWorkout: getTodayWorkoutMock,
}));
vi.mock('../common/ToastHost', () => ({
  pushToast: pushToastMock,
}));

// ---- Fixtures ---------------------------------------------------------------

const DAY: TodayDay = {
  id: 'dw-1',
  kind: 'strength',
  name: 'Upper Heavy',
  week_idx: 1,
  day_idx: 0,
};

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

const PRELOADED = { run_id: 'mr-1', day: DAY, sets: [SET_1, SET_2] };

const GUIDE: ExerciseGuide = {
  slug: 'barbell-bench-press',
  setup_callout: 'Feet flat, slight arch, shoulder blades pinched together on the bench.',
  setup_facts: {},
  cues: ['Cue A', 'Cue B', 'Cue C'],
  donts: ['Mistake A', 'Mistake B'],
  media: {},
};

function renderLogger(
  preloaded: typeof PRELOADED & { track?: string | null } = PRELOADED,
  initialPath = '/today/mr-1/log',
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        {/* Sentinel for the today screen so completion navigation is observable. */}
        <Route path="/" element={<div>today-screen</div>} />
        <Route
          path="/today/:mesocycleRunId/log"
          element={<TodayLoggerMobile preloaded={preloaded} />}
        />
        <Route
          path="/today/:mesocycleRunId/log/:blockIdx"
          element={<TodayLoggerMobile preloaded={preloaded} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Render straight at the block-0 focus screen. */
function renderFocused(preloaded: typeof PRELOADED & { track?: string | null } = PRELOADED) {
  return renderLogger(preloaded, '/today/mr-1/log/0');
}

/** Render the block-0 focus screen under StrictMode — dev double-invokes
 *  effects (mount → cleanup → re-mount), which is also a proxy for any
 *  prod re-render that re-fires the lazy-fetch effects mid-flight. */
function renderFocusedStrict() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/today/mr-1/log/0']}>
        <Routes>
          <Route
            path="/today/:mesocycleRunId/log/:blockIdx"
            element={<TodayLoggerMobile preloaded={PRELOADED} />}
          />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

/** Flush pending microtasks (history/meta fetch promises) inside act. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

// ---- Tests ------------------------------------------------------------------

describe('<TodayLoggerMobile>', () => {
  beforeEach(() => {
    __mockedQueueStatuses.clear();
    vi.spyOn(logBuffer, 'enqueue').mockResolvedValue('crid-stub');
    getExerciseHistoryMock.mockResolvedValue([]);
    getExerciseGuideMock.mockResolvedValue(null);
    listExercisesMock.mockResolvedValue([
      {
        slug: 'barbell-bench-press',
        primary_muscle: 'chest',
        required_equipment: { _v: 1, requires: [{ type: 'barbell' }] },
      },
    ]);
    completeDayWorkoutMock.mockResolvedValue({
      id: 'dw-1',
      status: 'completed',
      completed_at: '2026-07-05T16:00:00.000Z',
      run_completed: false,
    });
    getTodayWorkoutMock.mockResolvedValue({
      state: 'workout',
      run_id: 'mr-1',
      day: DAY,
      sets: [SET_1, SET_2],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hub', () => {
    it('renders the day name and one hub row per block with set counts', async () => {
      renderLogger();
      expect(screen.getByText(/Upper Heavy/)).toBeInTheDocument();
      const row = screen.getByTestId('hub-row-0');
      expect(row).toHaveTextContent('Barbell Bench Press');
      expect(row).toHaveTextContent('0/2 sets');
      // No set rows on the hub — logging happens in the focus screen.
      expect(screen.queryByTestId('set-row-0')).not.toBeInTheDocument();
      await flush();
    });

    it('counts server-logged sets as done', async () => {
      renderLogger({
        ...PRELOADED,
        sets: [{ ...SET_1, logged: { weight_lbs: 135, reps: 8 } }, SET_2],
      });
      expect(screen.getByTestId('hub-row-0')).toHaveTextContent('1/2 sets');
      await flush();
    });

    it('tapping a hub row opens that block in the focus screen', async () => {
      const user = userEvent.setup();
      renderLogger();
      await user.click(screen.getByTestId('hub-row-0'));
      expect(await screen.findByTestId('set-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('set-row-1')).toBeInTheDocument();
      expect(screen.getByLabelText(/Set 1 weight in pounds/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Set 1 reps/i)).toBeInTheDocument();
      expect(screen.getAllByRole('slider', { name: /RIR/i }).length).toBe(2);
    });

    it('back from the focus screen returns to the hub', async () => {
      const user = userEvent.setup();
      renderFocused();
      await user.click(screen.getByRole('button', { name: /^back to plan$/i }));
      expect(screen.getByTestId('hub-row-0')).toBeInTheDocument();
      expect(screen.queryByTestId('set-row-0')).not.toBeInTheDocument();
    });

    it('history sheet does not auto-reopen when a different block is later focused', async () => {
      const user = userEvent.setup();
      renderLogger({
        ...PRELOADED,
        sets: [SET_1, SET_2, { ...SET_1, id: 'ps-3', block_idx: 1, set_idx: 0 }],
      });

      // Open block 0, open its history sheet.
      await user.click(screen.getByTestId('hub-row-0'));
      await user.click(await screen.findByRole('button', { name: /exercise history/i }));
      expect(screen.getByRole('dialog', { name: /exercise history/i })).toBeInTheDocument();

      // Back to the hub, then open block 1 — the sheet must not follow.
      await user.click(screen.getByRole('button', { name: /^back to plan$/i }));
      expect(screen.queryByRole('dialog', { name: /exercise history/i })).not.toBeInTheDocument();
      await user.click(screen.getByTestId('hub-row-1'));
      expect(await screen.findByTestId('set-row-0')).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: /exercise history/i })).not.toBeInTheDocument();
    });
  });

  describe('focus screen', () => {
    it('beginner track: hides RIR sliders and shows a plain-language effort cue', async () => {
      renderFocused({ ...PRELOADED, track: 'beginner' });
      expect(screen.getByText(/leave 2 reps in the tank/i)).toBeInTheDocument();
      expect(screen.queryAllByRole('slider', { name: /RIR/i }).length).toBe(0);
      expect(screen.queryByText(/RIR/)).not.toBeInTheDocument();
      // Weight/reps logging still fully present.
      expect(screen.getByLabelText(/Set 1 weight in pounds/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Set 1 reps/i)).toBeInTheDocument();
      await flush();
    });

    it('Log button is disabled until weight + reps are filled', async () => {
      const user = userEvent.setup();
      renderFocused();
      const row = within(screen.getByTestId('set-row-0'));
      const logBtn = row.getByRole('button', { name: /^log$/i });
      expect(logBtn).toBeDisabled();

      await user.type(row.getByLabelText(/weight in pounds/i), '185');
      expect(logBtn).toBeDisabled();
      await user.type(row.getByLabelText(/Set 1 reps/i), '7');
      expect(logBtn).not.toBeDisabled();
    });

    it('Log click calls logBuffer.enqueue with weight/reps/RIR and shows logged affordance', async () => {
      const user = userEvent.setup();
      renderFocused();
      const row = within(screen.getByTestId('set-row-0'));

      await user.type(row.getByLabelText(/weight in pounds/i), '185');
      await user.type(row.getByLabelText(/Set 1 reps/i), '7');
      await user.click(row.getByRole('button', { name: /^log$/i }));

      expect(logBuffer.enqueue).toHaveBeenCalledTimes(1);
      const call = (logBuffer.enqueue as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('ps-1'); // planned_set_id
      expect(call[1]).toMatchObject({ weight_lbs: 185, reps: 7, rir: 2 });
      expect(typeof call[1].performed_at).toBe('string');
      expect(call[2]).toBe('user-1'); // queueOwnerUserId

      // Row affordance reflects the mocked queue status ('pending' → "Queued offline").
      expect(
        await within(screen.getByTestId('set-row-0-status') as HTMLElement).findByText(
          /queued offline/i,
        ),
      ).toBeInTheDocument();
    });

    it('shows "Logged · locked" with pointer to Settings when the queue status mock returns "synced"', async () => {
      __mockedQueueStatuses.set('crid-stub', 'synced');
      const user = userEvent.setup();
      renderFocused();
      const row = within(screen.getByTestId('set-row-0'));
      await user.type(row.getByLabelText(/weight in pounds/i), '185');
      await user.type(row.getByLabelText(/Set 1 reps/i), '7');
      await user.click(row.getByRole('button', { name: /^log$/i }));
      // Reviewer Important: "Logged" with no further guidance leaves users
      // confused about why the row's inputs are disabled (the 24h audit
      // window exists but the inline edit UI ships later). Affordance now
      // surfaces the lock + points at the right surface.
      expect(
        await within(screen.getByTestId('set-row-0-status') as HTMLElement).findByText(
          /logged · locked/i,
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId('set-row-0-status')).toHaveTextContent(/edit via settings/i);
    });

    it('Log button is disabled for 500ms after press (debounce window)', async () => {
      // We stay on real timers for the input phase (userEvent) and only test the
      // debounce gate via the second-click contract: a synchronous second click
      // before any awaits must not cause a second logBuffer.enqueue.
      const user = userEvent.setup();
      renderFocused();
      const row = within(screen.getByTestId('set-row-0'));
      await user.type(row.getByLabelText(/weight in pounds/i), '185');
      await user.type(row.getByLabelText(/Set 1 reps/i), '7');

      const logBtn = row.getByRole('button', { name: /^log$/i });
      // First synchronous click — flips internal debounce flag immediately.
      fireEvent.click(logBtn);
      // Second synchronous click in the same tick — must be gated by the
      // debounce flag (the React state for `logged` hasn't committed yet).
      fireEvent.click(logBtn);
      fireEvent.click(logBtn);
      expect(logBuffer.enqueue).toHaveBeenCalledTimes(1);

      // After the row transitions to 'logged' phase the button is also disabled
      // by canLog=false. End state: the button is disabled.
      await act(async () => {
        await Promise.resolve();
      });
      expect(logBtn).toBeDisabled();
    });

    it('RIR slider keyboard: ArrowRight increments, ArrowLeft decrements, Home=0, End=5', async () => {
      renderFocused();
      const slider = screen.getAllByRole('slider', { name: /RIR/i })[0];
      expect(slider).toHaveAttribute('aria-valuenow', '2');

      slider.focus();
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(slider).toHaveAttribute('aria-valuenow', '3');

      fireEvent.keyDown(slider, { key: 'ArrowLeft' });
      expect(slider).toHaveAttribute('aria-valuenow', '2');

      fireEvent.keyDown(slider, { key: 'End' });
      expect(slider).toHaveAttribute('aria-valuenow', '5');
      // Already at max — ArrowRight stays at 5.
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(slider).toHaveAttribute('aria-valuenow', '5');

      fireEvent.keyDown(slider, { key: 'Home' });
      expect(slider).toHaveAttribute('aria-valuenow', '0');
      fireEvent.keyDown(slider, { key: 'ArrowLeft' });
      expect(slider).toHaveAttribute('aria-valuenow', '0');
      await flush();
    });

    it('RIR slider has the right ARIA attributes', async () => {
      renderFocused();
      const slider = screen.getAllByRole('slider', { name: /RIR/i })[0];
      expect(slider).toHaveAttribute('aria-valuemin', '0');
      expect(slider).toHaveAttribute('aria-valuemax', '5');
      expect(slider).toHaveAttribute('aria-valuenow', '2');
      expect(slider).toHaveAttribute('aria-label', expect.stringMatching(/RIR/i));
      await flush();
    });

    it('status region uses aria-live="polite" for SR announcements', async () => {
      renderFocused();
      const status = screen.getByTestId('set-row-0-status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveAttribute('role', 'status');
      await flush();
    });

    it("after a successful Log focus moves to the next set's weight input", async () => {
      const user = userEvent.setup();
      renderFocused();
      const row0 = within(screen.getByTestId('set-row-0'));
      await user.type(row0.getByLabelText(/weight in pounds/i), '185');
      await user.type(row0.getByLabelText(/Set 1 reps/i), '7');
      await user.click(row0.getByRole('button', { name: /^log$/i }));

      // setTimeout 0 in the focus handler — wait a microtask for the focus shift.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(document.activeElement).toBe(screen.getByLabelText(/Set 2 weight in pounds/i));
    });

    it('prefills unlogged sets from last session and shows the last-time line', async () => {
      getExerciseHistoryMock.mockResolvedValue([
        { date: '2026-06-30', sets: [{ weight_lbs: 25, reps: 9, rir: 2 }] },
      ]);
      renderFocused();

      const weight0 = screen.getByLabelText(/Set 1 weight in pounds/i);
      await waitFor(() => expect(weight0).toHaveValue(25));
      expect(screen.getByLabelText(/Set 1 reps/i)).toHaveValue(9);
      // Set 2 has no same-idx history entry — falls back to the session's first set.
      expect(screen.getByLabelText(/Set 2 weight in pounds/i)).toHaveValue(25);
      expect(screen.getByLabelText(/Set 2 reps/i)).toHaveValue(9);
      expect(screen.getByText(/last time: 25 lbs × 9/i)).toBeInTheDocument();
      expect(getExerciseHistoryMock).toHaveBeenCalledWith('barbell-bench-press', 1);
    });

    it('late-resolving history never clobbers input the user typed while it was in flight', async () => {
      // With effect-cancellation removed (StrictMode fix), the empty-inputs
      // guard is the only thing standing between a slow /exercise-history
      // response and silent overwrite of user-typed data. Pin it.
      let resolveHistory!: (v: HistorySession[]) => void;
      getExerciseHistoryMock.mockReturnValue(
        new Promise<HistorySession[]>((r) => {
          resolveHistory = r;
        }),
      );
      const user = userEvent.setup();
      renderFocused();

      // User types into Set 1 while the history fetch is still pending.
      await user.type(screen.getByLabelText(/Set 1 weight in pounds/i), '135');
      await user.type(screen.getByLabelText(/Set 1 reps/i), '5');

      resolveHistory([{ date: '2026-06-30', sets: [{ weight_lbs: 25, reps: 9, rir: 2 }] }]);
      // Untouched Set 2 receives the prefill…
      await waitFor(() => expect(screen.getByLabelText(/Set 2 weight in pounds/i)).toHaveValue(25));
      // …while the user's typed values survive.
      expect(screen.getByLabelText(/Set 1 weight in pounds/i)).toHaveValue(135);
      expect(screen.getByLabelText(/Set 1 reps/i)).toHaveValue(5);
    });

    it('does not prefill server-logged sets and seeds only non-null logged values', async () => {
      getExerciseHistoryMock.mockResolvedValue([
        { date: '2026-06-30', sets: [{ weight_lbs: 25, reps: 9, rir: 2 }] },
      ]);
      renderFocused({
        ...PRELOADED,
        sets: [{ ...SET_1, logged: { weight_lbs: null, reps: 8 } }, SET_2],
      });

      // Unlogged set 2 gets the history prefill…
      await waitFor(() => expect(screen.getByLabelText(/Set 2 weight in pounds/i)).toHaveValue(25));
      // …while the server-logged set keeps its own values: null weight stays
      // an empty input (never the string "null"), reps shows the logged 8, and
      // the row is locked.
      expect(screen.getByLabelText(/Set 1 weight in pounds/i)).toHaveValue(null);
      expect(screen.getByLabelText(/Set 1 reps/i)).toHaveValue(8);
      expect(screen.getByLabelText(/Set 1 reps/i)).toBeDisabled();
    });

    it('logging a set starts the rest timer at the set rest_sec, rendered m:ss', async () => {
      vi.useFakeTimers();
      try {
        renderFocused();
        await flush();
        const row = screen.getByTestId('set-row-0');
        fireEvent.change(within(row).getByLabelText(/weight in pounds/i), {
          target: { value: '185' },
        });
        fireEvent.change(within(row).getByLabelText(/Set 1 reps/i), {
          target: { value: '7' },
        });
        expect(screen.queryByTestId('rest-timer')).not.toBeInTheDocument();
        fireEvent.click(within(row).getByRole('button', { name: /^log$/i }));
        await flush(); // let the enqueue promise resolve → restTimer.start(180)

        expect(screen.getByTestId('rest-timer')).toHaveTextContent('REST 3:00');
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(screen.getByTestId('rest-timer')).toHaveTextContent('REST 2:59');
      } finally {
        vi.useRealTimers();
      }
    });

    it('rest timer started on the focus screen stays visible after navigating back to the hub', async () => {
      vi.useFakeTimers();
      try {
        renderFocused();
        await flush();
        const row = screen.getByTestId('set-row-0');
        fireEvent.change(within(row).getByLabelText(/weight in pounds/i), {
          target: { value: '185' },
        });
        fireEvent.change(within(row).getByLabelText(/Set 1 reps/i), {
          target: { value: '7' },
        });
        fireEvent.click(within(row).getByRole('button', { name: /^log$/i }));
        await flush(); // let the enqueue promise resolve → restTimer.start(180)
        expect(screen.getByTestId('rest-timer')).toHaveTextContent('REST 3:00');

        fireEvent.click(screen.getByRole('button', { name: /^back to plan$/i }));
        expect(screen.getByTestId('hub-row-0')).toBeInTheDocument();
        expect(screen.getByTestId('rest-timer')).toHaveTextContent('REST 3:00');
      } finally {
        vi.useRealTimers();
      }
    });

    it('⟲ history button opens the HistorySheet dialog', async () => {
      const user = userEvent.setup();
      renderFocused();
      expect(screen.queryByRole('dialog', { name: /exercise history/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /exercise history/i }));
      expect(screen.getByRole('dialog', { name: /exercise history/i })).toBeInTheDocument();
    });
  });

  describe('setup card (ⓘ) wiring', () => {
    it('shows ⓘ once the guide loads, and opens the setup card', async () => {
      getExerciseGuideMock.mockResolvedValue(GUIDE);
      renderFocused();
      const btn = await screen.findByRole('button', { name: /how to do this exercise/i });
      fireEvent.click(btn);
      expect(await screen.findByRole('dialog', { name: /how to set up/i })).toBeInTheDocument();
      expect(screen.getByText('Cue A')).toBeInTheDocument();
    });

    it('hides ⓘ when the exercise has no guide (404 → null)', async () => {
      getExerciseGuideMock.mockResolvedValue(null);
      renderFocused();
      await waitFor(() => expect(getExerciseGuideMock).toHaveBeenCalled());
      expect(
        screen.queryByRole('button', { name: /how to do this exercise/i }),
      ).not.toBeInTheDocument();
    });

    it('hides ⓘ when the guide fetch fails — guides are a nicety, logging must not depend on them', async () => {
      getExerciseGuideMock.mockRejectedValue(new Error('network down'));
      renderFocused();
      await waitFor(() => expect(getExerciseGuideMock).toHaveBeenCalled());
      expect(
        screen.queryByRole('button', { name: /how to do this exercise/i }),
      ).not.toBeInTheDocument();
      // Logging UI is intact:
      expect(screen.getAllByRole('button', { name: /^log$/i }).length).toBeGreaterThan(0);
    });

    it('closes the setup card when leaving the focus screen', async () => {
      getExerciseGuideMock.mockResolvedValue(GUIDE);
      renderFocused();
      fireEvent.click(await screen.findByRole('button', { name: /how to do this exercise/i }));
      expect(await screen.findByRole('dialog', { name: /how to set up/i })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^back to plan$/i }));
      expect(screen.queryByRole('dialog', { name: /how to set up/i })).not.toBeInTheDocument();
    });

    it('opening history closes the guide sheet (one sheet at a time)', async () => {
      getExerciseGuideMock.mockResolvedValue(GUIDE);
      renderFocused();
      fireEvent.click(await screen.findByRole('button', { name: /how to do this exercise/i }));
      expect(await screen.findByRole('dialog', { name: /how to set up/i })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /exercise history/i }));
      expect(screen.queryByRole('dialog', { name: /how to set up/i })).not.toBeInTheDocument();
      expect(await screen.findByRole('dialog', { name: /exercise history/i })).toBeInTheDocument();
    });
  });

  describe('StrictMode resilience (effect re-fire mid-fetch must not drop results)', () => {
    it('ⓘ still appears when the guide fetch resolves after an effect re-fire', async () => {
      getExerciseGuideMock.mockResolvedValue(GUIDE);
      renderFocusedStrict();
      expect(
        await screen.findByRole('button', { name: /how to do this exercise/i }),
      ).toBeInTheDocument();
    });

    it('history prefill + last-time line still land after an effect re-fire', async () => {
      getExerciseHistoryMock.mockResolvedValue([
        { date: '2026-06-30', sets: [{ weight_lbs: 25, reps: 9, rir: 2 }] },
      ]);
      renderFocusedStrict();
      await waitFor(() => expect(screen.getByLabelText(/Set 1 weight in pounds/i)).toHaveValue(25));
      expect(screen.getByText(/last time: 25 lbs × 9/i)).toBeInTheDocument();
    });
  });

  // ---- Workout-level completion + backfill mode -----------------------------

  // Both sets logged → the hub reads "all done" and FINISH completes cleanly.
  const ALL_LOGGED = {
    ...PRELOADED,
    sets: [
      { ...SET_1, logged: { weight_lbs: 135, reps: 8 } },
      { ...SET_2, logged: { weight_lbs: 135, reps: 8 } },
    ],
  };

  describe('FINISH WORKOUT (workout-level completion)', () => {
    it('with all sets logged, completes with no date and returns to the today screen', async () => {
      const user = userEvent.setup();
      renderLogger(ALL_LOGGED);
      await user.click(screen.getByRole('button', { name: /finish workout/i }));
      await waitFor(() => expect(completeDayWorkoutMock).toHaveBeenCalledTimes(1));
      expect(completeDayWorkoutMock).toHaveBeenCalledWith('dw-1', { completed_on: undefined });
      expect(await screen.findByText('today-screen')).toBeInTheDocument();
    });

    it('with unlogged sets, confirms before completing and only completes on confirm', async () => {
      const user = userEvent.setup();
      renderLogger(); // both sets unlogged
      await user.click(screen.getByRole('button', { name: /finish workout/i }));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent(/2 sets unlogged/i);
      expect(completeDayWorkoutMock).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: /finish anyway/i }));
      await waitFor(() => expect(completeDayWorkoutMock).toHaveBeenCalledTimes(1));
    });

    it('cancelling the confirm dialog does not complete', async () => {
      const user = userEvent.setup();
      renderLogger();
      await user.click(screen.getByRole('button', { name: /finish workout/i }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(completeDayWorkoutMock).not.toHaveBeenCalled();
    });

    it('celebrates when the response reports the run finished', async () => {
      completeDayWorkoutMock.mockResolvedValue({
        id: 'dw-1',
        status: 'completed',
        completed_at: '2026-07-05T16:00:00.000Z',
        run_completed: true,
      });
      const user = userEvent.setup();
      renderLogger(ALL_LOGGED);
      await user.click(screen.getByRole('button', { name: /finish workout/i }));
      await waitFor(() => expect(pushToastMock).toHaveBeenCalled());
      expect(pushToastMock.mock.calls[0][0]).toMatchObject({ severity: 'success' });
    });

    it('completion failure surfaces the server message and does NOT navigate away', async () => {
      completeDayWorkoutMock.mockRejectedValue(
        new Error('Day already completed on another device.'),
      );
      const user = userEvent.setup();
      renderLogger(ALL_LOGGED);
      await user.click(screen.getByRole('button', { name: /finish workout/i }));
      expect(
        await screen.findByText(/Day already completed on another device/),
      ).toBeInTheDocument();
      expect(screen.queryByText('today-screen')).not.toBeInTheDocument();
      expect(screen.getByTestId('hub-row-0')).toBeInTheDocument();
    });
  });

  describe('backfill mode (?for=YYYY-MM-DD)', () => {
    it('shows the "Logging for <date>" banner on the focus screen and stamps performed_at at noon user-local', async () => {
      const user = userEvent.setup();
      renderLogger(PRELOADED, '/today/mr-1/log/0?for=2026-07-05');
      expect(screen.getByText(/logging for/i)).toBeInTheDocument();
      expect(screen.getByText('Sunday, Jul 5')).toBeInTheDocument();

      const row = within(screen.getByTestId('set-row-0'));
      await user.type(row.getByLabelText(/weight in pounds/i), '185');
      await user.type(row.getByLabelText(/Set 1 reps/i), '7');
      await user.click(row.getByRole('button', { name: /^log$/i }));

      expect(logBuffer.enqueue).toHaveBeenCalledTimes(1);
      const call = (logBuffer.enqueue as ReturnType<typeof vi.fn>).mock.calls[0];
      // noon 2026-07-05 in America/New_York (EDT, UTC-4) === 16:00Z.
      expect(call[1].performed_at).toBe('2026-07-05T16:00:00.000Z');
    });

    it('banner also renders on the hub view (mode persists across hub↔focus)', async () => {
      renderLogger(PRELOADED, '/today/mr-1/log?for=2026-07-05');
      expect(screen.getByText(/logging for/i)).toBeInTheDocument();
      expect(screen.getByText('Sunday, Jul 5')).toBeInTheDocument();
    });

    it('mode survives navigation: tapping a hub row keeps ?for= and the banner', async () => {
      const user = userEvent.setup();
      renderLogger(PRELOADED, '/today/mr-1/log?for=2026-07-05');
      await user.click(screen.getByTestId('hub-row-0'));
      // Now on the focus screen — the backfill banner must still be present.
      expect(await screen.findByTestId('set-row-0')).toBeInTheDocument();
      expect(screen.getByText(/logging for/i)).toBeInTheDocument();
      expect(screen.getByText('Sunday, Jul 5')).toBeInTheDocument();
    });

    it('FINISH passes completed_on = the chosen date', async () => {
      const user = userEvent.setup();
      renderLogger(ALL_LOGGED, '/today/mr-1/log?for=2026-07-05');
      await user.click(screen.getByRole('button', { name: /finish workout/i }));
      await waitFor(() =>
        expect(completeDayWorkoutMock).toHaveBeenCalledWith('dw-1', { completed_on: '2026-07-05' }),
      );
    });
  });

  describe('load-state branch', () => {
    it('mesocycle_complete shows "Program complete." not "Rest day."', async () => {
      getTodayWorkoutMock.mockResolvedValue({ state: 'mesocycle_complete' });
      render(
        <MemoryRouter initialEntries={['/today/mr-1/log']}>
          <Routes>
            <Route path="/" element={<div>today-screen</div>} />
            <Route path="/today/:mesocycleRunId/log" element={<TodayLoggerMobile />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(await screen.findByText(/program complete\./i)).toBeInTheDocument();
      expect(screen.queryByText(/rest day/i)).not.toBeInTheDocument();
    });
  });
});
