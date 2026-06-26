import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackForm } from './FeedbackForm';

vi.mock('../../lib/api/feedback', () => ({ submitFeedback: vi.fn() }));
vi.mock('../common/ToastHost', () => ({ pushToast: vi.fn() }));
import { submitFeedback } from '../../lib/api/feedback';
import { pushToast } from '../common/ToastHost';

describe('FeedbackForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables Send until the textarea has non-whitespace content', async () => {
    render(<FeedbackForm />);
    const send = screen.getByRole('button', { name: /send/i });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'something is off');
    expect(send).toBeEnabled();
  });

  it('submits the body + route, toasts success, clears, and calls onSubmitted', async () => {
    (submitFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '7' });
    const onSubmitted = vi.fn();
    render(<FeedbackForm initialRoute="/today/x/log" onSubmitted={onSubmitted} />);
    await userEvent.type(screen.getByRole('textbox'), 'bug here');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({ body: 'bug here', route: '/today/x/log' }),
    );
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect(onSubmitted).toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('toasts an error on failure and keeps the text', async () => {
    (submitFeedback as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('HTTP 500'));
    render(<FeedbackForm />);
    await userEvent.type(screen.getByRole('textbox'), 'keep me');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' })),
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('keep me');
  });
});
