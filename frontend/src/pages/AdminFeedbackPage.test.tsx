import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminFeedbackPage from './AdminFeedbackPage';

vi.mock('../lib/api/feedback', () => ({ listAdminFeedback: vi.fn(), triageFeedback: vi.fn() }));
import { listAdminFeedback, triageFeedback } from '../lib/api/feedback';

const ITEM = {
  id: '5', body: 'rest timer bug', route: '/today', app_sha: 'abc', user_email_at_submit: 't@x.io',
  created_at: '2026-05-28T00:00:00Z', triaged_at: null, webhook_delivered_at: '2026-05-28T00:00:01Z',
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
    (triageFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ITEM, triaged_at: '2026-05-28T01:00:00Z' });
    render(<AdminFeedbackPage />);
    await screen.findByText(/rest timer bug/);
    await userEvent.click(screen.getByRole('button', { name: /mark triaged/i }));
    await waitFor(() => expect(triageFeedback).toHaveBeenCalledWith('5'));
  });

  it('shows a not-authorized message on 403', async () => {
    (listAdminFeedback as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('HTTP 403'), { status: 403 }));
    render(<AdminFeedbackPage />);
    expect(await screen.findByText(/not authorized/i)).toBeInTheDocument();
  });
});
