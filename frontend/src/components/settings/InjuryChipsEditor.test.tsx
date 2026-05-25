import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { InjuryChipsEditor } from './InjuryChipsEditor';
import * as api from '../../lib/api/userInjuries';

vi.mock('../../lib/api/userInjuries');

describe('<InjuryChipsEditor>', () => {
  it('renders all 7 chip labels', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([]);
    render(<InjuryChipsEditor />);
    await waitFor(() => expect(screen.getByText('shoulder_left')).toBeInTheDocument());
    expect(screen.getByText('shoulder_right')).toBeInTheDocument();
    expect(screen.getByText('low_back')).toBeInTheDocument();
    expect(screen.getByText('knee_left')).toBeInTheDocument();
    expect(screen.getByText('knee_right')).toBeInTheDocument();
    expect(screen.getByText('elbow')).toBeInTheDocument();
    expect(screen.getByText('wrist')).toBeInTheDocument();
  });

  it('toggling an inactive chip calls upsertInjury', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([]);
    vi.mocked(api.upsertInjury).mockResolvedValueOnce({
      joint: 'knee_left', severity: 'mod', notes: '', onset_at: null,
      created_at: '', updated_at: '',
    });
    render(<InjuryChipsEditor />);
    await waitFor(() => screen.getByText('knee_left'));
    fireEvent.click(screen.getByRole('button', { name: /knee_left/i }));
    await waitFor(() =>
      expect(api.upsertInjury).toHaveBeenCalledWith({ joint: 'knee_left' }),
    );
  });

  it('clicking an active chip expands a panel with severity + notes + onset', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([{
      joint: 'knee_left', severity: 'mod', notes: 'meniscus', onset_at: '2026-02-15',
      created_at: '', updated_at: '',
    }]);
    render(<InjuryChipsEditor />);
    await waitFor(() => screen.getByText(/knee_left/));
    fireEvent.click(screen.getByRole('button', { name: /knee_left/i }));
    expect(screen.getByDisplayValue('meniscus')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mod/i, pressed: true })).toBeInTheDocument();
  });

  it('editing severity calls patchInjury', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([{
      joint: 'knee_left', severity: 'mod', notes: '', onset_at: null,
      created_at: '', updated_at: '',
    }]);
    vi.mocked(api.patchInjury).mockResolvedValueOnce({
      joint: 'knee_left', severity: 'high', notes: '', onset_at: null,
      created_at: '', updated_at: '',
    });
    render(<InjuryChipsEditor />);
    await waitFor(() => screen.getByText(/knee_left/));
    fireEvent.click(screen.getByRole('button', { name: /knee_left/i }));
    const panel = screen.getByRole('region', { name: /knee_left/i });
    fireEvent.click(within(panel).getByRole('button', { name: 'high' }));
    await waitFor(() =>
      expect(api.patchInjury).toHaveBeenCalledWith('knee_left', { severity: 'high' }),
    );
  });

  // [FIX-19] rollback path
  it('reverts chip state and surfaces error when PATCH fails', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([{
      joint: 'wrist', severity: 'mod', notes: '', onset_at: null,
      created_at: '', updated_at: '',
    }]);
    vi.mocked(api.patchInjury).mockRejectedValueOnce(new Error('500 server'));
    render(<InjuryChipsEditor />);
    await waitFor(() => screen.getByText(/wrist/));
    fireEvent.click(screen.getByRole('button', { name: /wrist/i }));
    const panel = screen.getByRole('region', { name: /wrist/i });
    fireEvent.click(within(panel).getByRole('button', { name: 'high' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(within(panel).getByRole('button', { name: 'mod', pressed: true })).toBeInTheDocument();
  });

  it('Remove button inside expanded panel calls deleteInjury', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([{
      joint: 'wrist', severity: 'mod', notes: '', onset_at: null,
      created_at: '', updated_at: '',
    }]);
    vi.mocked(api.deleteInjury).mockResolvedValueOnce();
    render(<InjuryChipsEditor />);
    await waitFor(() => screen.getByText(/wrist/));
    fireEvent.click(screen.getByRole('button', { name: /wrist/i }));
    const panel = screen.getByRole('region', { name: /wrist/i });
    fireEvent.click(within(panel).getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(api.deleteInjury).toHaveBeenCalledWith('wrist'));
  });
});
