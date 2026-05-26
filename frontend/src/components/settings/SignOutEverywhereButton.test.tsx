// frontend/src/components/settings/SignOutEverywhereButton.test.tsx
//
// Beta W6 Task 15 — component tests for the sign-out-everywhere control.
//
// Covers (spec lines 3454–3490):
//   1. clicking the button opens the medium-tier ConfirmDialog whose accessible
//      name is "End this session on every device?".
//   2. Confirming calls signOutEverywhere(), posts a `{ type: 'signout_everywhere' }`
//      BroadcastChannel('repos-auth') signal, then redirects to the CF Access
//      logout endpoint.
//
// Note: BroadcastChannel is polyfilled in src/test/setup.ts — Node's native
// implementation is incompatible with jsdom's event system (it dispatches a
// Node-internal MessageEvent that jsdom rejects).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../lib/api/account';
import { SignOutEverywhereButton } from './SignOutEverywhereButton';

vi.mock('../../lib/api/account');

describe('SignOutEverywhereButton', () => {
  it('opens medium-tier confirm on click', async () => {
    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    expect(screen.getByRole('dialog', { name: /end this session on every device/i })).toBeInTheDocument();
  });

  it('Confirm calls signOutEverywhere + posts BroadcastChannel signal + redirects', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true, writable: true });
    vi.mocked(api.signOutEverywhere).mockResolvedValue();

    const messages: unknown[] = [];
    const listener = new BroadcastChannel('repos-auth');
    listener.onmessage = (e) => messages.push(e.data);

    render(<SignOutEverywhereButton />);
    await userEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm|signing out/i }));
    await waitFor(() => expect(api.signOutEverywhere).toHaveBeenCalled());
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cdn-cgi/access/logout'));
    await waitFor(() => expect(messages).toContainEqual({ type: 'signout_everywhere' }));
    listener.close();
  });
});
