import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsHealthPage from '../SettingsHealthPage';
import * as parQApi from '../../lib/api/parQ';
import * as toast from '../../components/common/ToastHost';

beforeEach(() => {
  vi.spyOn(toast, 'pushToast').mockReturnValue('id');
});

describe('<SettingsHealthPage>', () => {
  it('shows current vs acknowledged PAR-Q version', async () => {
    vi.spyOn(parQApi, 'getParQStatus').mockResolvedValue({
      current_version: 2,
      acknowledged_version: 2,
      needs_prompt: false,
      questions: [],
      advisory_active: false,
    });
    render(<SettingsHealthPage />);
    expect(await screen.findByText('READINESS SCREEN')).toBeInTheDocument();
    expect(screen.getByText(/Re-review questionnaire/)).toBeInTheDocument();
  });

  it('shows the Mark cleared affordance only when advisory_active', async () => {
    vi.spyOn(parQApi, 'getParQStatus').mockResolvedValue({
      current_version: 2,
      acknowledged_version: 2,
      needs_prompt: false,
      questions: [],
      advisory_active: true,
    });
    render(<SettingsHealthPage />);
    expect(await screen.findByText('ADVISORY ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Mark cleared')).toBeInTheDocument();
  });

  it('Mark cleared POSTs and reloads status', async () => {
    const getStatus = vi
      .spyOn(parQApi, 'getParQStatus')
      .mockResolvedValueOnce({
        current_version: 2,
        acknowledged_version: 2,
        needs_prompt: false,
        questions: [],
        advisory_active: true,
      })
      .mockResolvedValue({
        current_version: 2,
        acknowledged_version: 2,
        needs_prompt: false,
        questions: [],
        advisory_active: false,
      });
    const clear = vi
      .spyOn(parQApi, 'markPARQCleared')
      .mockResolvedValue({ advisory_active: false });
    render(<SettingsHealthPage />);
    fireEvent.click(await screen.findByText('Mark cleared'));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('ADVISORY ACTIVE')).not.toBeInTheDocument());
  });

  it('Re-review opens the ParQGate in forceReview mode', async () => {
    vi.spyOn(parQApi, 'getParQStatus').mockResolvedValue({
      current_version: 2,
      acknowledged_version: 2,
      needs_prompt: false,
      questions: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'],
      advisory_active: false,
    });
    render(<SettingsHealthPage />);
    fireEvent.click(await screen.findByText('Re-review questionnaire'));
    // Even though needs_prompt=false, forceReview renders the question list.
    expect(await screen.findByTestId('parq-questions')).toBeInTheDocument();
  });
});
