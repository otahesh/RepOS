import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MyLibrary } from './MyLibrary';
import * as api from '../../lib/api/userPrograms';

const ACTIVE_PROGRAM = {
  id: 'up-active',
  name: 'My Full Body',
  status: 'active' as const,
  user_id: 'u1',
  template_id: 't1',
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
  template_version: 1,
  customizations: {},
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-04-15T10:00:00Z',
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

  it('Restart button calls onRestartProgram with the program id', async () => {
    const onRestart = vi.fn();
    vi.spyOn(api, 'listMyPrograms')
      .mockResolvedValueOnce([ACTIVE_PROGRAM])
      .mockResolvedValueOnce([ABANDONED_PROGRAM]);

    renderLibrary(onRestart);
    await screen.findByText('My Full Body');
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));
    await screen.findByText('Old Program');

    fireEvent.click(screen.getByRole('button', { name: /Restart/i }));
    expect(onRestart).toHaveBeenCalledWith('up-abandoned');
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
