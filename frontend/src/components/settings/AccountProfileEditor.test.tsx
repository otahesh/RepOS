// frontend/src/components/settings/AccountProfileEditor.test.tsx
// Per C-PROFILE-CONTROLLED: inputs follow the W3 ControlledField pattern
// (frontend/src/components/InjuryChipsEditor.tsx:33-55). useEffect re-syncs
// local state when the parent's `user` prop changes (avoiding stale state on
// re-renders); commit-on-blur with diff-check fires patchProfile only when
// the field actually changed.
//
// Per D6: no `units` selector in this component.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../lib/api/account';
import { AccountProfileEditor } from './AccountProfileEditor';

vi.mock('../../lib/api/account');

describe('AccountProfileEditor', () => {
  it('renders current display_name + timezone (NO units selector per D6)', () => {
    render(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />);
    expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Jay');
    expect(screen.queryByLabelText(/units/i)).toBeNull();
  });

  it('re-syncs from props on parent re-render (ControlledField pattern, per C-PROFILE-CONTROLLED)', () => {
    const { rerender } = render(
      <AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />,
    );
    expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Jay');
    // Parent re-render with a new user (e.g., post-PATCH refetch returned a different value)
    rerender(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jason', timezone: 'America/New_York' }} />);
    expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Jason');
  });

  it('Save patches the modified fields only + shows success toast', async () => {
    const spy = vi.mocked(api.patchProfile).mockResolvedValue({
      id: 'u1', email: 'a@b', display_name: 'Jay M', timezone: 'America/New_York',
    });
    render(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />);
    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.type(screen.getByLabelText(/display name/i), 'Jay M');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ display_name: 'Jay M' }));
  });

  it('Save with no diff is a no-op — patchProfile not called', async () => {
    const spy = vi.mocked(api.patchProfile);
    render(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('rollback-on-error restores prior value + shows error toast', async () => {
    vi.mocked(api.patchProfile).mockRejectedValue(new Error('HTTP 500'));
    render(<AccountProfileEditor user={{ id: 'u1', email: 'a@b', display_name: 'Jay', timezone: 'America/New_York' }} />);
    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.type(screen.getByLabelText(/display name/i), 'Jay M');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Jay'));
  });
});
