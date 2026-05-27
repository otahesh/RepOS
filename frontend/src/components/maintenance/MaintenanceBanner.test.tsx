import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as api from '../../lib/api/backups';

vi.mock('../../lib/api/backups');

// idbQueue singleton — default: empty queue. Individual tests override
// peekSyncing via the mocked module.
vi.mock('../../lib/idbQueue', () => ({
  idbQueue: {
    peekPending: vi.fn(async () => []),
    peekSyncing: vi.fn(async () => []),
  },
}));

import { idbQueue } from '../../lib/idbQueue';
import { MaintenanceBanner } from './MaintenanceBanner';

beforeEach(() => {
  vi.clearAllMocks();
  (idbQueue.peekPending as any).mockResolvedValue([]);
  (idbQueue.peekSyncing as any).mockResolvedValue([]);
});

function stubLocation(pathname: string): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { reload, pathname, assign: vi.fn() },
    writable: true,
    configurable: true,
  });
  return reload;
}

describe('MaintenanceBanner', () => {
  it('renders nothing when maintenance is inactive', async () => {
    (api.getMaintenanceStatus as any).mockResolvedValue({
      active: false,
      restore: null,
      recovery_available: false,
    });
    const { container } = render(<MaintenanceBanner />);
    await waitFor(() => expect(api.getMaintenanceStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('shows running-restore copy', async () => {
    (api.getMaintenanceStatus as any).mockResolvedValue({
      active: true,
      restore: { status: 'running' },
      recovery_available: false,
    });
    render(<MaintenanceBanner />);
    await waitFor(() => screen.getByText(/RepOS is down for a database restore/));
    expect(screen.getByText(/Your last set is queued locally/)).toBeInTheDocument();
  });

  it('shows failed-restore copy with Roll back button when recovery available', async () => {
    (api.getMaintenanceStatus as any).mockResolvedValue({
      active: true,
      restore: { status: 'failed', error_message: 'migration 49 failed' },
      recovery_available: true,
    });
    (api.restorePreSnapshot as any).mockResolvedValue(undefined);
    render(<MaintenanceBanner />);
    await waitFor(() => screen.getByText(/Restore failed/));
    expect(screen.getByText(/migration 49 failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /roll back/i }));
    await waitFor(() => expect(api.restorePreSnapshot).toHaveBeenCalled());
  });

  it('reloads when transitioning from active to inactive', async () => {
    const reload = stubLocation('/settings/backups');
    (api.getMaintenanceStatus as any)
      .mockResolvedValueOnce({ active: true, restore: { status: 'running' }, recovery_available: false })
      .mockResolvedValue({ active: false, restore: { status: 'ok' }, recovery_available: false });
    render(<MaintenanceBanner pollIntervalMs={10} />);
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 1000 });
  });

  // C-MOBILE-MAINTENANCE — suppress reload when user is on /today/:runId/log.
  it('does NOT auto-reload on /today/:runId/log; shows Reload CTA instead', async () => {
    const reload = stubLocation('/today/abc-123/log');
    (api.getMaintenanceStatus as any)
      .mockResolvedValueOnce({ active: true, restore: { status: 'running' }, recovery_available: false })
      .mockResolvedValue({ active: false, restore: { status: 'ok' }, recovery_available: false });
    render(<MaintenanceBanner pollIntervalMs={10} />);
    await waitFor(() => screen.getByText(/Restore complete — reload to continue/), { timeout: 1000 });
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalled();
  });

  // C-MOBILE-MAINTENANCE — also suppress when idbQueue has syncing rows.
  it('does NOT auto-reload when idbQueue.peekSyncing() returns rows', async () => {
    const reload = stubLocation('/settings/backups');
    (idbQueue.peekSyncing as any).mockResolvedValue([{ client_request_id: 'q-1' }]);
    (api.getMaintenanceStatus as any)
      .mockResolvedValueOnce({ active: true, restore: { status: 'running' }, recovery_available: false })
      .mockResolvedValue({ active: false, restore: { status: 'ok' }, recovery_available: false });
    render(<MaintenanceBanner pollIntervalMs={10} />);
    await waitFor(() => screen.getByText(/Restore complete — reload to continue/), { timeout: 1000 });
    expect(reload).not.toHaveBeenCalled();
  });
});
