import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as api from '../lib/api/backups';

vi.mock('../lib/api/backups');

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('SettingsBackupsPage', () => {
  it('lets the user trigger a manual backup', async () => {
    vi.doMock('../lib/useIsMobile', () => ({
      useIsMobile: () => false,
      useIsBelowTablet: () => false,
    }));
    (api.listBackups as any).mockResolvedValue({ items: [] });
    (api.createBackup as any).mockResolvedValue({
      id: 'repos-NEW.dump.gz',
      trigger: 'manual',
      size_bytes: 100,
      verified_restorable: 'good',
      created_at: 'now',
    });
    const { default: SettingsBackupsPage } = await import('./SettingsBackupsPage');
    render(<SettingsBackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: /backup now/i }));
    await waitFor(() => expect(api.createBackup).toHaveBeenCalled());
  });

  it('preserves backup creation on mobile', async () => {
    vi.doMock('../lib/useIsMobile', () => ({
      useIsMobile: () => true,
      useIsBelowTablet: () => true,
    }));
    (api.listBackups as any).mockResolvedValue({ items: [] });
    (api.createBackup as any).mockResolvedValue({
      id: 'repos-MOBILE.dump.gz',
      trigger: 'manual',
      size_bytes: 100,
      verified_restorable: 'good',
      created_at: 'now',
    });
    const { default: SettingsBackupsPage } = await import('./SettingsBackupsPage');
    render(<SettingsBackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: /backup now/i }));
    await waitFor(() => expect(api.createBackup).toHaveBeenCalled());
    expect(screen.queryByText(/manage.*from desktop|on desktop/i)).toBeNull();
  });
});
