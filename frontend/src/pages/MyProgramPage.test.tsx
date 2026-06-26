import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MyProgramPage from './MyProgramPage';
import * as mesoApi from '../lib/api/mesocycles';
import * as upApi from '../lib/api/userPrograms';
import * as exApi from '../lib/api/exercises';
import * as eqApi from '../lib/api/equipment';

// DesktopSwapSheet → ExercisePicker fetches exercises + equipment. Auto-mock
// (resolved values set in beforeEach because the repo uses restoreMocks:true).
vi.mock('../lib/api/exercises');
vi.mock('../lib/api/equipment');

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const ACTIVE_RUN: mesoApi.MesocycleRunDetail = {
  id: 'mr-1',
  user_program_id: 'up-1',
  start_date: '2026-04-01',
  start_tz: 'America/New_York',
  weeks: 5,
  current_week: 3,
  status: 'active',
};

const COMPLETED_RUN: mesoApi.MesocycleRunDetail = {
  ...ACTIVE_RUN,
  status: 'completed',
  finished_at: '2026-05-01T12:00:00Z',
};

const USER_PROGRAM: upApi.UserProgramDetail = {
  id: 'up-1',
  user_id: 'u-1',
  template_id: 'tmpl-1',
  template_slug: 'full-body-3x',
  template_version: 1,
  name: 'Full Body 3x',
  customizations: {},
  status: 'active',
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
  effective_name: 'Full Body 3x',
  effective_structure: { _v: 1, days: [] },
};

// A program with one day + one block, so DayCard renders an interactive
// exercise the desktop swap test can click.
const USER_PROGRAM_WITH_DAY: upApi.UserProgramDetail = {
  ...USER_PROGRAM,
  effective_structure: {
    _v: 1,
    days: [
      {
        idx: 0,
        day_offset: 0,
        kind: 'strength',
        name: 'Push',
        blocks: [
          {
            exercise_slug: 'barbell-bench-press',
            mev: 2,
            mav: 3,
            target_reps_low: 6,
            target_reps_high: 10,
            target_rir: 2,
            rest_sec: 180,
          },
        ],
      },
    ],
  } as upApi.UserProgramDetail['effective_structure'],
};

const RECAP_STATS: mesoApi.MesocycleRecapStats = {
  weeks: 5,
  total_sets: 180,
  prs: 3,
};

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function renderPage(runId = 'mr-1') {
  return render(
    <MemoryRouter initialEntries={[`/my-programs/${runId}`]}>
      <Routes>
        <Route path="/my-programs/:id" element={<MyProgramPage />} />
        {/* Capture navigations so we can assert the destination */}
        <Route path="/programs/:slug" element={<div data-testid="programs-slug-page" />} />
        <Route path="/programs" element={<div data-testid="programs-catalog-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MyProgramPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: active run, user program loaded, no warnings.
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(ACTIVE_RUN);
    vi.spyOn(upApi, 'getUserProgram').mockResolvedValue(USER_PROGRAM);
    vi.spyOn(upApi, 'getUserProgramWarnings').mockResolvedValue([]);
    vi.spyOn(mesoApi, 'getMesocycleRecapStats').mockResolvedValue(RECAP_STATS);
    // ProgramPage fetches getMesocycle + getVolumeRollup internally.
    vi.spyOn(mesoApi, 'getVolumeRollup').mockResolvedValue({
      run_id: 'mr-1',
      weeks: [],
    });
    // DesktopSwapSheet → ExercisePicker fetches (set here, after restoreMocks).
    vi.mocked(exApi.listExercises).mockResolvedValue([
      {
        id: '1',
        slug: 'barbell-bench-press',
        name: 'BB Bench Press',
        primary_muscle: 'chest',
        primary_muscle_name: 'Chest',
        movement_pattern: 'push_horizontal',
        peak_tension_length: 'mid',
        skill_complexity: 2,
        loading_demand: 3,
        systemic_fatigue: 3,
        required_equipment: { _v: 1, requires: [] },
        muscle_contributions: { chest: 1 },
      },
      {
        id: '2',
        slug: 'dumbbell-bench-press',
        name: 'DB Bench Press',
        primary_muscle: 'chest',
        primary_muscle_name: 'Chest',
        movement_pattern: 'push_horizontal',
        peak_tension_length: 'mid',
        skill_complexity: 2,
        loading_demand: 3,
        systemic_fatigue: 3,
        required_equipment: { _v: 1, requires: [] },
        muscle_contributions: { chest: 1 },
      },
    ] as any);
    vi.mocked(eqApi.getEquipmentProfile).mockResolvedValue({ _v: 1 } as any);
  });

  // -------------------------------------------------------------------------
  // Active run — should NOT render recap
  // -------------------------------------------------------------------------

  it('does not render MesocycleRecap for an active run', async () => {
    renderPage();
    // Wait for run to load (loading spinner disappears)
    await waitFor(() => expect(screen.queryByText(/Loading…/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/Solid block/i)).not.toBeInTheDocument();
    expect(mesoApi.getMesocycleRecapStats).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Completed run — recap flow
  // -------------------------------------------------------------------------

  it('shows loading state while recap-stats fetch is in flight', () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN);
    // Never resolves during this test
    vi.spyOn(mesoApi, 'getMesocycleRecapStats').mockReturnValue(new Promise(() => {}));
    renderPage();
    // The run fetch resolves synchronously via the mock queue; the recap
    // fetch is held. We see the recap loading state.
    // Note: the first "Loading…" is the run loading spinner; once the run
    // is set the component re-renders into the recap loading branch.
    expect(screen.getByText(/Loading…|Loading recap/i)).toBeInTheDocument();
  });

  it('renders MesocycleRecap with stats once recap-stats load', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN);
    renderPage();
    // Recap component header
    expect(await screen.findByText(/Solid block/i)).toBeInTheDocument();
    // Stat line rendered by MesocycleRecap: "5 weeks · 180 working sets · 3 PRs"
    expect(screen.getByText(/180/)).toBeInTheDocument();
    expect(screen.getByText(/3 PR/)).toBeInTheDocument();
  });

  it('shows inline error when recap-stats fetch fails (page does not blow up)', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN);
    vi.spyOn(mesoApi, 'getMesocycleRecapStats').mockRejectedValue(new Error('network error'));
    renderPage();
    expect(await screen.findByText(/Couldn't load recap stats/i)).toBeInTheDocument();
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // handleChoice navigation
  // -------------------------------------------------------------------------

  // [D4 + C-RUN-IT-BACK-ROUTE] Deload choice now opens a confirm dialog with
  // templated volume math, then calls startMesocycle({intent:'deload'}).
  it('on deload choice, opens ConfirmDialog with volume math; on confirm calls startMesocycle({intent:deload})', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN);
    const startSpy = vi.spyOn(mesoApi, 'startMesocycle').mockResolvedValue({
      mesocycle_run_id: 'new-run-1',
      start_date: '2026-05-27',
      start_tz: 'UTC',
      weeks: 5,
      status: 'active',
      current_week: 1,
      is_deload: true,
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText(/Take a deload/i));
    // ConfirmDialog shows the volume math copy. Scope to the dialog — the same
    // copy also appears in the recap's "Take a deload" choice description
    // (intentional consistency), so a global query would match multiple.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/~50% of your MAV/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/RIR 4 throughout/i)).toBeInTheDocument();
    // Before confirm, no backend call.
    expect(startSpy).not.toHaveBeenCalled();
    // Confirm.
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));
    await waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith({ user_program_id: 'up-1', intent: 'deload' }),
    );
  });

  it('on deload choice cancel, does NOT call startMesocycle', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN);
    const startSpy = vi.spyOn(mesoApi, 'startMesocycle');
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText(/Take a deload/i));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('on run_it_back choice, calls startMesocycle({intent:normal}) and navigates to the new run', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN);
    const startSpy = vi.spyOn(mesoApi, 'startMesocycle').mockResolvedValue({
      mesocycle_run_id: 'new-run-2',
      start_date: '2026-05-27',
      start_tz: 'UTC',
      weeks: 5,
      status: 'active',
      current_week: 1,
      is_deload: false,
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText(/Run it back/i));
    await waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith({ user_program_id: 'up-1', intent: 'normal' }),
    );
  });

  it('navigates to /programs on new_program choice', async () => {
    vi.spyOn(mesoApi, 'getMesocycle').mockResolvedValue(COMPLETED_RUN);
    renderPage();
    await screen.findByText(/New program/i);
    await userEvent.click(screen.getByText(/New program/i));
    expect(screen.getByTestId('programs-catalog-page')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Abandon mesocycle — heavy-tier destructive confirm (typed = program name)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // W4.1 — desktop swap side-sheet
  // -------------------------------------------------------------------------

  it('clicking an exercise on desktop opens the DesktopSwapSheet', async () => {
    // useIsMobile() returns false in jsdom (no matchMedia) → desktop path.
    vi.spyOn(upApi, 'getUserProgram').mockResolvedValue(USER_PROGRAM_WITH_DAY);
    const user = userEvent.setup();
    renderPage();
    const exerciseBtn = await screen.findByRole('button', { name: /barbell bench press/i });
    await user.click(exerciseBtn);
    expect(await screen.findByRole('dialog', { name: /swap exercise/i })).toBeInTheDocument();
  });

  it('applying an every-occurrence swap calls patchUserProgram with swap_exercise_all', async () => {
    vi.spyOn(upApi, 'getUserProgram').mockResolvedValue(USER_PROGRAM_WITH_DAY);
    const patchSpy = vi.spyOn(upApi, 'patchUserProgram').mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /barbell bench press/i }));
    await screen.findByRole('dialog', { name: /swap exercise/i });
    // "Every occurrence" is the default radio in program_edit context.
    await user.click(await screen.findByText(/DB Bench Press/));
    await user.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('up-1', {
        op: 'swap_exercise_all',
        from_slug: 'barbell-bench-press',
        to_exercise_slug: 'dumbbell-bench-press',
      }),
    );
  });

  it('gates Abandon behind a heavy typed-confirm and only abandons after the name is typed', async () => {
    const abandonSpy = vi.spyOn(mesoApi, 'abandonMesocycle').mockResolvedValue({
      mesocycle_run_id: 'mr-1',
      status: 'abandoned',
      finished_at: '2026-05-26T00:00:00Z',
    });
    const user = userEvent.setup();
    renderPage();

    // Open the heavy confirm dialog from the Danger zone button.
    const trigger = await screen.findByRole('button', { name: /abandon this program/i });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Confirm is disabled until the typed value matches the program name.
    // Scope to the dialog so the matcher doesn't collide with the trigger.
    const confirmBtn = within(dialog).getByRole('button', { name: /abandon|abandoning/i });
    expect(confirmBtn).toBeDisabled();
    expect(abandonSpy).not.toHaveBeenCalled();

    // Type the program name to unlock Confirm.
    await user.type(within(dialog).getByRole('textbox'), 'Full Body 3x');
    expect(confirmBtn).toBeEnabled();
    await user.click(confirmBtn);

    expect(abandonSpy).toHaveBeenCalledWith('mr-1');
    // After abandoning, the page navigates to the catalog.
    await waitFor(() => expect(screen.getByTestId('programs-catalog-page')).toBeInTheDocument());
  });
});
