import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BetaDisclaimer } from '../BetaDisclaimer';
import * as api from '../../../lib/api/onboarding';

vi.mock('../../../lib/api/onboarding');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('<BetaDisclaimer>', () => {
  it('states Beta software, not-medical-advice, and the feedback contact path', () => {
    render(<BetaDisclaimer onComplete={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/beta software/i)).toBeInTheDocument();
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
    expect(screen.getAllByText(/send feedback/i).length).toBeGreaterThan(0);
  });

  it('acks via the API and calls onComplete', async () => {
    (api.ackBetaDisclaimer as any).mockResolvedValue({
      beta_disclaimer_ack_at: '2026-07-11T18:00:00.000Z',
    });
    const onComplete = vi.fn();
    render(<BetaDisclaimer onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    await waitFor(() => expect(api.ackBetaDisclaimer).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('keeps the gate up and re-enables the button when the ack fails', async () => {
    (api.ackBetaDisclaimer as any).mockRejectedValue(new Error('network'));
    const onComplete = vi.fn();
    render(<BetaDisclaimer onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    await waitFor(() => expect(api.ackBetaDisclaimer).toHaveBeenCalled());
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /i understand/i })).toBeEnabled();
    expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
  });
});
