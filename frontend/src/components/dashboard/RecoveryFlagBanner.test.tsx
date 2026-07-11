import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as api from '../../lib/api/recoveryFlags';

vi.mock('../../lib/api/recoveryFlags');

import { RecoveryFlagBanner } from './RecoveryFlagBanner';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RecoveryFlagBanner', () => {
  it('renders nothing when no flags are active', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({ flags: [] });
    const { container } = render(<RecoveryFlagBanner />);
    await waitFor(() => expect(api.listRecoveryFlags).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one advisory per flag with its message', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [
        { flag: 'overreaching', message: 'Heavy week — consider a deload' },
        {
          flag: 'bodyweight_crash',
          message: 'Weight dropping fast — under-fueling will stall progress.',
          trend_7d_lbs: -4.4,
        },
      ],
    });
    render(<RecoveryFlagBanner />);
    expect(await screen.findByText(/Heavy week/)).toBeInTheDocument();
    expect(screen.getByText(/under-fueling/)).toBeInTheDocument();
    // Advisories are status live-regions, one per flag.
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('dismisses a flag: calls the API with the flag key and removes the card', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [{ flag: 'overreaching', message: 'Heavy week — consider a deload' }],
    });
    (api.dismissRecoveryFlag as any).mockResolvedValue(undefined);
    render(<RecoveryFlagBanner />);
    const dismiss = await screen.findByRole('button', { name: /dismiss.*week/i });
    fireEvent.click(dismiss);
    await waitFor(() => expect(api.dismissRecoveryFlag).toHaveBeenCalledWith('overreaching'));
    await waitFor(() => expect(screen.queryByText(/Heavy week/)).not.toBeInTheDocument());
  });

  it('keeps the card when dismiss fails so the user can retry', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [{ flag: 'overreaching', message: 'Heavy week — consider a deload' }],
    });
    (api.dismissRecoveryFlag as any).mockRejectedValue(new Error('network'));
    render(<RecoveryFlagBanner />);
    const dismiss = await screen.findByRole('button', { name: /dismiss.*week/i });
    fireEvent.click(dismiss);
    await waitFor(() => expect(api.dismissRecoveryFlag).toHaveBeenCalled());
    expect(screen.getByText(/Heavy week/)).toBeInTheDocument();
  });

  it('renders nothing when the flags fetch fails (advisories never break Today)', async () => {
    (api.listRecoveryFlags as any).mockRejectedValue(new Error('boom'));
    const { container } = render(<RecoveryFlagBanner />);
    await waitFor(() => expect(api.listRecoveryFlags).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('explains the deload term on the overreaching advisory', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [{ flag: 'overreaching', message: 'Heavy week — consider a deload' }],
    });
    render(<RecoveryFlagBanner />);
    await screen.findByText(/Heavy week/);
    // The Term popover trigger for 'deload' is present.
    expect(screen.getByRole('button', { name: /deload.*definition/i })).toBeInTheDocument();
  });
});
