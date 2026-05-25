import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('toggling an active chip calls deleteInjury', async () => {
    vi.mocked(api.listInjuries).mockResolvedValueOnce([{
      joint: 'wrist', severity: 'mod', notes: '', onset_at: null,
      created_at: '', updated_at: '',
    }]);
    vi.mocked(api.deleteInjury).mockResolvedValueOnce();
    render(<InjuryChipsEditor />);
    await waitFor(() => screen.getByText('wrist'));
    fireEvent.click(screen.getByRole('button', { name: /wrist/i }));
    await waitFor(() => expect(api.deleteInjury).toHaveBeenCalledWith('wrist'));
  });
});
