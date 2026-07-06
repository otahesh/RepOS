import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TodayLoggerMobile from './TodayLoggerMobile';
import { logBuffer } from '../../lib/logBuffer';
import type { QueueRowStatus } from '../../hooks/useIdbQueueStatus';
import type { TodayDay, TodaySet } from '../../lib/api/mesocycles';

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
// so W1.3.5 (LogBufferRecovery banner) can assert mixed-status rendering.
const __mockedQueueStatuses = new Map<string, QueueRowStatus>();
vi.mock('../../hooks/useIdbQueueStatus', () => ({
  useIdbQueueStatus: (crid: string | null) =>
    crid == null ? 'unknown' : (__mockedQueueStatuses.get(crid) ?? 'pending'),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

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

function renderLogger(preloaded: typeof PRELOADED & { track?: string | null } = PRELOADED) {
  return render(
    <MemoryRouter initialEntries={['/today/mr-1/log']}>
      <TodayLoggerMobile preloaded={preloaded} />
    </MemoryRouter>,
  );
}

// ---- Tests ------------------------------------------------------------------

describe('<TodayLoggerMobile>', () => {
  beforeEach(() => {
    __mockedQueueStatuses.clear();
    vi.spyOn(logBuffer, 'enqueue').mockResolvedValue('crid-stub');
    navigateMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the day name + per-set weight/reps/RIR controls', () => {
    renderLogger();
    expect(screen.getByText(/Upper Heavy/)).toBeInTheDocument();
    // Two set rows
    expect(screen.getByTestId('set-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('set-row-1')).toBeInTheDocument();
    // Each row has a weight + reps input + RIR slider
    expect(screen.getByLabelText(/Set 1 weight in pounds/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Set 1 reps/i)).toBeInTheDocument();
    const sliders = screen.getAllByRole('slider', { name: /RIR/i });
    expect(sliders.length).toBe(2);
  });

  it('beginner track: hides RIR sliders and shows a plain-language effort cue', () => {
    renderLogger({ ...PRELOADED, track: 'beginner' });
    expect(screen.getByText(/leave 2 reps in the tank/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('slider', { name: /RIR/i }).length).toBe(0);
    expect(screen.queryByText(/RIR/)).not.toBeInTheDocument();
    // Weight/reps logging still fully present.
    expect(screen.getByLabelText(/Set 1 weight in pounds/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Set 1 reps/i)).toBeInTheDocument();
  });

  it('Log button is disabled until weight + reps are filled', async () => {
    const user = userEvent.setup();
    renderLogger();
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
    renderLogger();
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
    renderLogger();
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
    renderLogger();
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
    renderLogger();
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
  });

  it('RIR slider has the right ARIA attributes', () => {
    renderLogger();
    const slider = screen.getAllByRole('slider', { name: /RIR/i })[0];
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '5');
    expect(slider).toHaveAttribute('aria-valuenow', '2');
    expect(slider).toHaveAttribute('aria-label', expect.stringMatching(/RIR/i));
  });

  it('status region uses aria-live="polite" for SR announcements', () => {
    renderLogger();
    const status = screen.getByTestId('set-row-0-status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('role', 'status');
  });

  it("after a successful Log focus moves to the next set's weight input", async () => {
    const user = userEvent.setup();
    renderLogger();
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
});
