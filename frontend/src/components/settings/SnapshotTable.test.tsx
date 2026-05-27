import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SnapshotTable } from './SnapshotTable';
import * as api from '../../lib/api/backups';

vi.mock('../../lib/api/backups');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SnapshotTable', () => {
  it('renders the list with verified-restorable badges', async () => {
    (api.listBackups as any).mockResolvedValue({
      items: [
        {
          id: 'repos-A.dump.gz',
          trigger: 'manual',
          size_bytes: 1024,
          verified_restorable: 'good',
          created_at: '2026-05-25T10:00:00Z',
        },
        {
          id: 'repos-B.dump.gz',
          trigger: 'auto',
          size_bytes: 2048,
          verified_restorable: 'warn',
          created_at: '2026-05-24T03:00:00Z',
        },
        {
          id: 'repos-C.dump.gz',
          trigger: 'auto',
          size_bytes: 512,
          verified_restorable: 'danger',
          created_at: '2026-05-23T03:00:00Z',
        },
      ],
    });
    render(<SnapshotTable />);
    await waitFor(() => screen.getByText('repos-A.dump.gz'));
    expect(screen.getByText('repos-A.dump.gz')).toBeInTheDocument();
    expect(screen.getByLabelText('Verified restorable')).toBeInTheDocument(); // good
    expect(screen.getByLabelText('Snapshot file missing on disk')).toBeInTheDocument(); // warn
    expect(
      screen.getByLabelText('Integrity check failed — not safe to restore'),
    ).toBeInTheDocument(); // danger
  });

  it('disables Restore button when badge is danger', async () => {
    (api.listBackups as any).mockResolvedValue({
      items: [
        {
          id: 'repos-C.dump.gz',
          trigger: 'auto',
          size_bytes: 512,
          verified_restorable: 'danger',
          created_at: '2026-05-23T03:00:00Z',
        },
      ],
    });
    render(<SnapshotTable />);
    await waitFor(() => screen.getByText('repos-C.dump.gz'));
    const restoreBtn = screen.getByRole('button', { name: /restore/i });
    expect(restoreBtn).toBeDisabled();
  });

  it('opens the typed-RESTORE confirm dialog (no window.prompt) and restores on confirm', async () => {
    (api.listBackups as any).mockResolvedValue({
      items: [
        {
          id: 'repos-A.dump.gz',
          trigger: 'manual',
          size_bytes: 1024,
          verified_restorable: 'good',
          created_at: '2026-05-25T10:00:00Z',
        },
      ],
    });
    (api.restoreBackup as any).mockResolvedValue(undefined);
    render(<SnapshotTable />);
    await waitFor(() => screen.getByText('repos-A.dump.gz'));
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    // ConfirmDialog (heavy tier) opens with a typed-RESTORE input.
    const input = await screen.findByRole('textbox');
    expect(screen.getByText(/to confirm/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /confirm restore/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'RESTORE' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.restoreBackup).toHaveBeenCalledWith('repos-A.dump.gz'));
  });
});
