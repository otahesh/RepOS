import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as api from '../../lib/api/recoveryFlags';

vi.mock('../../lib/api/recoveryFlags');
vi.mock('../common/ToastHost', () => ({
  pushToast: vi.fn(),
}));

import { pushToast } from '../common/ToastHost';
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

  it('dismisses a flag: calls the API with the flag key and removes only that card', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [
        { flag: 'overreaching', message: 'Heavy week — consider a deload' },
        {
          flag: 'bodyweight_crash',
          message: 'Weight dropping fast — under-fueling will stall progress.',
        },
      ],
    });
    (api.dismissRecoveryFlag as any).mockResolvedValue(undefined);
    render(<RecoveryFlagBanner />);
    const dismiss = await screen.findByRole('button', { name: /dismiss.*heavy week/i });
    fireEvent.click(dismiss);
    await waitFor(() => expect(api.dismissRecoveryFlag).toHaveBeenCalledWith('overreaching'));
    await waitFor(() => expect(screen.queryByText(/Heavy week/)).not.toBeInTheDocument());
    // The other advisory must survive.
    expect(screen.getByText(/under-fueling/)).toBeInTheDocument();
  });

  it('surfaces a toast and keeps the card when dismiss fails', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [{ flag: 'overreaching', message: 'Heavy week — consider a deload' }],
    });
    (api.dismissRecoveryFlag as any).mockRejectedValue(new Error('network'));
    render(<RecoveryFlagBanner />);
    const dismiss = await screen.findByRole('button', { name: /dismiss.*heavy week/i });
    fireEvent.click(dismiss);
    await waitFor(() => expect(api.dismissRecoveryFlag).toHaveBeenCalled());
    expect(screen.getByText(/Heavy week/)).toBeInTheDocument();
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', body: expect.stringMatching(/dismiss/i) }),
    );
    // Button re-enabled so the user can retry.
    expect(screen.getByRole('button', { name: /dismiss.*heavy week/i })).toBeEnabled();
  });

  it('disables the dismiss button while the request is in flight', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [{ flag: 'overreaching', message: 'Heavy week — consider a deload' }],
    });
    let resolveDismiss!: () => void;
    (api.dismissRecoveryFlag as any).mockImplementation(
      () => new Promise<void>((res) => (resolveDismiss = res)),
    );
    render(<RecoveryFlagBanner />);
    const dismiss = await screen.findByRole('button', { name: /dismiss.*heavy week/i });
    fireEvent.click(dismiss);
    expect(dismiss).toBeDisabled();
    resolveDismiss();
    await waitFor(() => expect(screen.queryByText(/Heavy week/)).not.toBeInTheDocument());
  });

  it('renders nothing when the flags fetch fails (advisories never break Today)', async () => {
    (api.listRecoveryFlags as any).mockRejectedValue(new Error('boom'));
    const { container } = render(<RecoveryFlagBanner />);
    await waitFor(() => expect(api.listRecoveryFlags).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('wraps the deload term in the overreaching message without duplicating the word', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [{ flag: 'overreaching', message: 'Heavy week — consider a deload' }],
    });
    render(<RecoveryFlagBanner />);
    await screen.findByText(/Heavy week/);
    const card = screen.getByRole('status');
    // The word appears exactly once — as the Term trigger, not appended after it.
    expect(card.textContent).not.toMatch(/deload\s*deload/i);
    expect(screen.getByRole('button', { name: /deload.*definition/i })).toBeInTheDocument();
  });

  it('wraps the PR acronym in the stalled-PR message with a definition', async () => {
    (api.listRecoveryFlags as any).mockResolvedValue({
      flags: [
        { flag: 'stalled_pr', message: 'Stalled PR — consider a load drop or rep adjustment' },
      ],
    });
    render(<RecoveryFlagBanner />);
    await screen.findByText(/Stalled/);
    expect(
      screen.getByRole('button', { name: /personal record.*definition/i }),
    ).toBeInTheDocument();
  });
});
