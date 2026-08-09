import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MyLibrary } from './MyLibrary';
import * as api from '../../lib/api/userPrograms';
import { ApiError } from '../../lib/api/userPrograms';
import * as toast from '../common/ToastHost';

// Capture navigate calls from inside the component.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const ACTIVE_PROGRAM = {
  id: 'up-active',
  name: 'My Full Body',
  status: 'active' as const,
  user_id: 'u1',
  template_id: 't1',
  template_slug: 'full-body-3x',
  template_version: 1,
  customizations: {},
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  has_live_run: true,
};

const ABANDONED_PROGRAM = {
  id: 'up-abandoned',
  name: 'Old Program',
  status: 'abandoned' as const,
  user_id: 'u1',
  template_id: 't1',
  template_slug: 'full-body-3x',
  template_version: 1,
  customizations: {},
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-04-15T10:00:00Z',
  has_live_run: false,
};

const COMPLETED_PROGRAM = {
  id: 'up-done',
  name: 'Finished Block',
  status: 'completed' as const,
  user_id: 'u1',
  template_id: 't1',
  template_slug: 'full-body-3x',
  template_version: 1,
  customizations: {},
  created_at: '2026-02-01T10:00:00Z',
  updated_at: '2026-03-15T10:00:00Z',
  has_live_run: false,
};

const DRAFT_PROGRAM = {
  id: 'up-draft',
  name: 'Draft Block',
  status: 'draft' as const,
  user_id: 'u1',
  template_id: 't1',
  template_slug: 'full-body-3x',
  template_version: 1,
  customizations: {},
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-01T10:00:00Z',
  has_live_run: false,
};

const ARCHIVED_PROGRAM = {
  id: 'up-shelved',
  name: 'Shelved Block',
  status: 'completed' as const,
  user_id: 'u1',
  template_id: 't1',
  template_slug: 'full-body-3x',
  template_version: 1,
  customizations: {},
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-02-01T10:00:00Z',
  has_live_run: false,
};

// The real production shape of a running program: status stays 'draft' (the
// backend never sets 'active'/'paused'), but has_live_run is true. This is the
// shape that un-masks the original status-based gating bug.
const LIVE_PROGRAM = {
  ...ACTIVE_PROGRAM,
  id: 'up-live',
  name: 'Live Block',
  status: 'draft' as const,
  has_live_run: true,
};

function renderLibrary(onRestartProgram = vi.fn()) {
  return render(
    <MemoryRouter>
      <MyLibrary onRestartProgram={onRestartProgram} />
    </MemoryRouter>,
  );
}

// Mounts a real <ToastHost> next to <MyLibrary> so toast bodies render into the
// DOM — used by the error-toast test to assert the user-visible message text.
function renderLibraryWithToasts(onRestartProgram = vi.fn()) {
  return render(
    <MemoryRouter>
      <MyLibrary onRestartProgram={onRestartProgram} />
      <toast.ToastHost />
    </MemoryRouter>,
  );
}

describe('<MyLibrary>', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([ACTIVE_PROGRAM]);
  });

  it('renders the My Programs heading', async () => {
    renderLibrary();
    expect(await screen.findByText('My Programs')).toBeInTheDocument();
  });

  it('Active tab shows active programs', async () => {
    renderLibrary();
    expect(await screen.findByText('My Full Body')).toBeInTheDocument();
  });

  it('Active tab does not show abandoned programs', async () => {
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([ACTIVE_PROGRAM, ABANDONED_PROGRAM]);
    renderLibrary();
    await screen.findByText('My Full Body');
    expect(screen.queryByText('Old Program')).not.toBeInTheDocument();
  });

  it('View on a live-run program navigates to its mesocycle page', async () => {
    vi.spyOn(api, 'getUserProgram').mockResolvedValue({
      ...ACTIVE_PROGRAM,
      effective_name: 'My Full Body',
      effective_structure: { _v: 1, days: [] },
      latest_run_id: 'mr-7',
    } as any);
    renderLibrary();
    await screen.findByText('My Full Body');

    fireEvent.click(screen.getByRole('button', { name: /^View$/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/my-programs/mr-7'));
  });

  it('View on a run-less draft opens its customize wizard route', async () => {
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([DRAFT_PROGRAM]);
    vi.spyOn(api, 'getUserProgram').mockResolvedValue({
      ...DRAFT_PROGRAM,
      effective_name: 'Draft Block',
      effective_structure: { _v: 1, days: [] },
    } as any);
    renderLibrary();
    await screen.findByText('Draft Block');

    fireEvent.click(screen.getByRole('button', { name: /^View$/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/programs/draft/up-draft'));
  });

  it('Past tab triggers a new fetch with includePast=true and shows abandoned programs', async () => {
    const spy = vi
      .spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM]) // initial active fetch
      .mockResolvedValueOnce([ABANDONED_PROGRAM]); // past fetch

    renderLibrary();
    await screen.findByText('My Full Body');

    // Switch to Past tab
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    expect(await screen.findByText('Old Program')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ includePast: true });
  });

  it('Past tab shows a Restart button, not a View button', async () => {
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([ABANDONED_PROGRAM]);

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));
    await screen.findByText('Old Program');

    expect(screen.getByRole('button', { name: /Restart/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View/i })).not.toBeInTheDocument();
  });

  it('Restart button calls onRestartProgram with the template slug', async () => {
    const onRestart = vi.fn();
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([ABANDONED_PROGRAM]);

    renderLibrary(onRestart);
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));
    await screen.findByText('Old Program');

    fireEvent.click(screen.getByRole('button', { name: /Restart/i }));
    expect(onRestart).toHaveBeenCalledWith('full-body-3x');
  });

  it('Restart on a past program routes to the fork wizard at /programs/:slug', async () => {
    // Simulate what ProgramsPage does: navigate to /programs/:slug on restart.
    const onRestart = vi.fn((slug: string) => mockNavigate(`/programs/${slug}`));
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([ABANDONED_PROGRAM]);

    renderLibrary(onRestart);
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));
    await screen.findByText('Old Program');

    fireEvent.click(screen.getByRole('button', { name: /Restart/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/programs/full-body-3x');
  });

  it('Restart button is hidden when template_slug is null (archived template)', async () => {
    const noSlugProgram = { ...ABANDONED_PROGRAM, template_slug: null };
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([noSlugProgram]);

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));
    await screen.findByText('Old Program');

    // No Restart button when template is gone
    expect(screen.queryByRole('button', { name: /Restart/i })).not.toBeInTheDocument();
  });

  it('empty Past tab shows a helpful empty state', async () => {
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([]);

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    await waitFor(() => {
      expect(screen.getByText(/No past programs yet/)).toBeInTheDocument();
    });
  });

  it('shows abandoned status badge on abandoned card', async () => {
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([ABANDONED_PROGRAM]);

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));
    await screen.findByText('Old Program');

    expect(screen.getByText('Abandoned')).toBeInTheDocument();
  });
});

describe('<MyLibrary> — prior-mesocycle recap entry (WS6 / D6 / G7)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('Past tab shows a "View recap" action on a completed program', async () => {
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([COMPLETED_PROGRAM]);

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /^Past$/i }));
    await screen.findByText('Finished Block');

    expect(await screen.findByRole('button', { name: /view recap/i })).toBeInTheDocument();
  });

  it('clicking "View recap" navigates to the latest completed run recap', async () => {
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([COMPLETED_PROGRAM]);
    const listSpy = vi.spyOn(api, 'listProgramMesocycles').mockResolvedValue([
      {
        id: 'run-latest',
        status: 'completed',
        start_date: '2026-03-01',
        finished_at: '2026-04-01T00:00:00Z',
        is_deload: false,
        weeks: 4,
      },
      {
        id: 'run-old',
        status: 'completed',
        start_date: '2026-01-01',
        finished_at: '2026-02-01T00:00:00Z',
        is_deload: false,
        weeks: 4,
      },
    ]);

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /^Past$/i }));
    await screen.findByText('Finished Block');

    fireEvent.click(await screen.findByRole('button', { name: /view recap/i }));

    // Endpoint returns newest-first; the first completed run is the target.
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('up-done'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/my-programs/run-latest'));
  });

  it('surfaces a recap-specific error (not "Couldn\'t load programs") when the run lookup fails', async () => {
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([COMPLETED_PROGRAM]);
    vi.spyOn(api, 'listProgramMesocycles').mockRejectedValue(new Error('boom'));

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /^Past$/i }));
    await screen.findByText('Finished Block');

    fireEvent.click(await screen.findByRole('button', { name: /view recap/i }));

    // The failure is attributed to the recap lookup, not the programs load.
    expect(await screen.findByText(/Couldn't load recap stats: boom/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load programs/)).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows an actionable empty-runs message when a completed program has no runs', async () => {
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([COMPLETED_PROGRAM]);
    vi.spyOn(api, 'listProgramMesocycles').mockResolvedValue([]);

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /^Past$/i }));
    await screen.findByText('Finished Block');

    fireEvent.click(await screen.findByRole('button', { name: /view recap/i }));

    expect(
      await screen.findByText(/No completed mesocycle for this program yet\./),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not show "View recap" on an abandoned program', async () => {
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([ABANDONED_PROGRAM]);

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /^Past$/i }));
    await screen.findByText('Old Program');

    expect(screen.queryByRole('button', { name: /view recap/i })).not.toBeInTheDocument();
  });
});

describe('<MyLibrary> — delete / archive / restore', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('Delete on a program shows a simple confirm (no typed match), then calls deleteUserProgram', async () => {
    const delSpy = vi.spyOn(api, 'deleteUserProgram').mockResolvedValue();
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([ACTIVE_PROGRAM]);

    renderLibrary();
    await screen.findByText('My Full Body');

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
    // Medium confirm: plain are-you-sure — no typed-name friction for gym data.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Delete program/i }));

    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('up-active'));
  });

  it('Archive on a draft program calls archiveUserProgram', async () => {
    const archiveSpy = vi.spyOn(api, 'archiveUserProgram').mockResolvedValue();
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([DRAFT_PROGRAM]) // initial active fetch
      .mockResolvedValueOnce([]); // reload after archive

    renderLibrary();
    await screen.findByText('Draft Block');

    fireEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith('up-draft'));
  });

  it('does not show Archive on an active (live-run) program', async () => {
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([ACTIVE_PROGRAM]);
    renderLibrary();
    await screen.findByText('My Full Body');
    expect(screen.queryByRole('button', { name: /^Archive$/i })).not.toBeInTheDocument();
  });

  it('gates Archive + badge on has_live_run for the real running-program shape (status=draft)', async () => {
    // Production reality: a running program keeps status='draft' but has_live_run=true.
    // Archive must be hidden (else 409) and the badge must read Active, not Draft.
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([LIVE_PROGRAM]);
    renderLibrary();
    await screen.findByText('Live Block');

    expect(screen.queryByRole('button', { name: /^Archive$/i })).not.toBeInTheDocument();
    // The status badge (a <span>, not the "Active" tab <button>) reads Active, not Draft.
    expect(screen.getByText('Active', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Draft', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('reloads the program list after a successful archive', async () => {
    vi.spyOn(api, 'archiveUserProgram').mockResolvedValue();
    const listSpy = vi
      .spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([DRAFT_PROGRAM]) // initial active fetch
      .mockResolvedValueOnce([]); // reload after archive

    renderLibrary();
    await screen.findByText('Draft Block');

    fireEvent.click(screen.getByRole('button', { name: /^Archive$/i }));
    await waitFor(() => expect(api.archiveUserProgram).toHaveBeenCalledWith('up-draft'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it('archive failure shows the server message, not raw JSON', async () => {
    vi.spyOn(api, 'archiveUserProgram').mockRejectedValue(
      new ApiError(
        409,
        { error: 'Finish or abandon the in-progress mesocycle before archiving this program.' },
        '{"error":"Finish or abandon the in-progress mesocycle before archiving this program."}',
      ),
    );
    vi.spyOn(api, 'listMyPrograms').mockResolvedValue([DRAFT_PROGRAM]);

    renderLibraryWithToasts();
    await screen.findByText('Draft Block');

    fireEvent.click(screen.getByRole('button', { name: /^Archive$/i }));

    // The clean server sentence is shown to the user...
    const errToast = await screen.findByRole('alert');
    expect(errToast).toHaveTextContent(/Finish or abandon the in-progress mesocycle/);
    // ...and the raw HTTP prefix / JSON braces never leak into the UI.
    expect(errToast).not.toHaveTextContent('HTTP 409');
    expect(errToast.textContent ?? '').not.toContain('{');
  });

  it('Archived tab fetches with includeArchived and shows a Restore action', async () => {
    const spy = vi
      .spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM]) // active
      .mockResolvedValueOnce([ARCHIVED_PROGRAM]); // archived

    renderLibrary();
    await screen.findByText('My Full Body');

    fireEvent.click(screen.getByRole('button', { name: /^Archived$/i }));

    expect(await screen.findByText('Shelved Block')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Restore$/i })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ includeArchived: true });
  });

  it('Restore calls unarchiveUserProgram', async () => {
    const unSpy = vi.spyOn(api, 'unarchiveUserProgram').mockResolvedValue();
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([ARCHIVED_PROGRAM])
      .mockResolvedValueOnce([]); // reload after restore

    renderLibrary();
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /^Archived$/i }));
    await screen.findByText('Shelved Block');

    fireEvent.click(screen.getByRole('button', { name: /^Restore$/i }));
    await waitFor(() => expect(unSpy).toHaveBeenCalledWith('up-shelved'));
  });
});
