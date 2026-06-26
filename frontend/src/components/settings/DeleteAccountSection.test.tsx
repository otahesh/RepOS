// frontend/src/components/settings/DeleteAccountSection.test.tsx
//
// Beta W6 Task 16 — component tests for the irreversible account-delete control.
//
// Covers (spec lines 3615–3619):
//   1. Clicking "Delete account" opens the HEAVY-tier ConfirmDialog — the
//      typed-confirm input is present and Confirm stays disabled until the
//      exact phrase is typed.
//   2. Typing the phrase + Confirm calls deleteAccount(PHRASE) then redirects
//      to the CF Access logout endpoint.
//   3. On deleteAccount rejection: an error toast is pushed and the window is
//      NOT redirected (user stays signed in to read the error + retry).
//
// window.location.assign is replaced with a spy like Task 15 (SignOutEverywhere).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../lib/api/account';
import { pushToast } from '../common/ToastHost';
import { CONFIRM_DELETE_ACCOUNT_PHRASE } from '../../lib/constants/accountConfirmPhrases';
import { DeleteAccountSection } from './DeleteAccountSection';

vi.mock('../../lib/api/account');
vi.mock('../common/ToastHost', () => ({ pushToast: vi.fn() }));

describe('DeleteAccountSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the heavy-tier dialog with a disabled Confirm until the phrase is typed', async () => {
    render(<DeleteAccountSection email="a@b.com" />);
    await userEvent.click(screen.getByRole('button', { name: /delete account/i }));

    const dialog = screen.getByRole('dialog', { name: /delete your account/i });
    expect(dialog).toBeInTheDocument();

    // Heavy tier → typed-confirm text input present.
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();

    // Confirm is disabled until the exact phrase is typed. Scope to the dialog
    // since the trigger button also reads "Delete account".
    const confirm = within(dialog).getByRole('button', {
      name: /^delete account$/i,
    });
    expect(confirm).toBeDisabled();
  });

  it('typing the phrase + Confirm calls deleteAccount then redirects to CF Access logout', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { assign },
      configurable: true,
      writable: true,
    });
    vi.mocked(api.deleteAccount).mockResolvedValue();

    render(<DeleteAccountSection email="a@b.com" />);
    await userEvent.click(screen.getByRole('button', { name: /delete account/i }));
    const dialog = screen.getByRole('dialog', { name: /delete your account/i });
    await userEvent.type(screen.getByRole('textbox'), CONFIRM_DELETE_ACCOUNT_PHRASE);
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete account$/i }));

    await waitFor(() =>
      expect(api.deleteAccount).toHaveBeenCalledWith(CONFIRM_DELETE_ACCOUNT_PHRASE),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cdn-cgi/access/logout'));
  });

  it('on rejection shows an error toast and does NOT redirect', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { assign },
      configurable: true,
      writable: true,
    });
    vi.mocked(api.deleteAccount).mockRejectedValue(new Error('HTTP 500'));

    render(<DeleteAccountSection email="a@b.com" />);
    await userEvent.click(screen.getByRole('button', { name: /delete account/i }));
    const dialog = screen.getByRole('dialog', { name: /delete your account/i });
    await userEvent.type(screen.getByRole('textbox'), CONFIRM_DELETE_ACCOUNT_PHRASE);
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete account$/i }));

    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' })),
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
