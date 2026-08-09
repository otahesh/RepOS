import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminFeedbackPage from './AdminFeedbackPage';

vi.mock('../lib/api/feedback', () => ({ listAdminFeedback: vi.fn(), triageFeedback: vi.fn() }));
import { listAdminFeedback, triageFeedback } from '../lib/api/feedback';

const ITEM = {
  id: '5',
  body: 'rest timer bug',
  route: '/today',
  app_sha: 'abc',
  user_email_at_submit: 't@x.io',
  created_at: '2026-05-28T00:00:00Z',
  triaged_at: null,
  webhook_delivered_at: '2026-05-28T00:00:01Z',
};

describe('AdminFeedbackPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders feedback rows from the API', async () => {
    (listAdminFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [ITEM] });
    render(<AdminFeedbackPage />);
    expect(await screen.findByText(/rest timer bug/)).toBeInTheDocument();
  });

  it('marks an item triaged on button click', async () => {
    (listAdminFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [ITEM] });
    (triageFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ITEM,
      triaged_at: '2026-05-28T01:00:00Z',
    });
    render(<AdminFeedbackPage />);
    await screen.findByText(/rest timer bug/);
    await userEvent.click(screen.getByRole('button', { name: /mark triaged/i }));
    await waitFor(() => expect(triageFeedback).toHaveBeenCalledWith('5'));
    // The optimistic state update must remove the action (row now triaged).
    await waitFor(() => expect(screen.queryByRole('button', { name: /mark triaged/i })).toBeNull());
  });

  it('shows a not-authorized message on 403', async () => {
    (listAdminFeedback as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('HTTP 403'), { status: 403 }),
    );
    render(<AdminFeedbackPage />);
    expect(await screen.findByText(/not authorized/i)).toBeInTheDocument();
  });

  it('shows an actionable, retryable error (not a stuck spinner) on a non-authz failure', async () => {
    (listAdminFeedback as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 500'), { status: 500 }))
      .mockResolvedValueOnce({ items: [ITEM] });
    render(<AdminFeedbackPage />);
    // Error surfaces the endpoint + status and a Retry control; no permanent "Loading…".
    expect(await screen.findByText(/HTTP 500/)).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(/rest timer bug/)).toBeInTheDocument();
  });
});
