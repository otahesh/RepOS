import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MyLibrary } from './MyLibrary';
import * as api from '../../lib/api/userPrograms';

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
};

function renderLibrary(onRestartProgram = vi.fn()) {
  return render(
    <MemoryRouter>
      <MyLibrary onRestartProgram={onRestartProgram} />
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

  it('View button on an active program navigates to /today', async () => {
    renderLibrary();
    await screen.findByText('My Full Body');

    fireEvent.click(screen.getByRole('button', { name: /View/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/today');
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
      { id: 'run-latest', status: 'completed', start_date: '2026-03-01', finished_at: '2026-04-01T00:00:00Z', is_deload: false, weeks: 4 },
      { id: 'run-old', status: 'completed', start_date: '2026-01-01', finished_at: '2026-02-01T00:00:00Z', is_deload: false, weeks: 4 },
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

    expect(await screen.findByText(/No completed mesocycle for this program yet\./)).toBeInTheDocument();
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
