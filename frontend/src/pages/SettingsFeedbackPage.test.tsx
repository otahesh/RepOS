import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsFeedbackPage from './SettingsFeedbackPage';

vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth');
  return { ...actual, useCurrentUser: vi.fn() };
});
import { useCurrentUser } from '../auth';

function renderWith(is_admin: boolean) {
  (useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({
    status: 'authenticated',
    user: { id: '1', email: 'a@b.c', display_name: null, timezone: 'UTC', is_admin },
    error: null,
  });
  render(
    <MemoryRouter>
      <SettingsFeedbackPage />
    </MemoryRouter>,
  );
}

describe('SettingsFeedbackPage', () => {
  it('renders the feedback form', () => {
    renderWith(false);
    expect(screen.getByRole('textbox', { name: /feedback/i })).toBeInTheDocument();
  });
  it('shows the admin link only for admins', () => {
    renderWith(true);
    expect(screen.getByRole('link', { name: /view all feedback/i })).toHaveAttribute(
      'href',
      '/admin/feedback',
    );
  });
  it('hides the admin link for non-admins', () => {
    renderWith(false);
    expect(screen.queryByRole('link', { name: /view all feedback/i })).toBeNull();
  });
});
