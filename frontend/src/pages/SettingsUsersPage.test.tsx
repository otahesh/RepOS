import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SettingsUsersPage from './SettingsUsersPage';
import * as api from '../lib/api/adminUsers';
import * as auth from '../auth';
import * as toast from '../components/common/ToastHost';

// Fully-shaped success envelopes. A partial `{ id } as never` cast would hide
// exactly the defect these fixtures exist to expose: every field below can
// come back false on a 2xx, and the UI has to read them.
const inviteOk = (email: string, id = '9'): api.InviteOutcome => ({
  id, email, status: 'invited', created: true,
  cf_synced: true, invite_sent: true, sync_error: null, mail_error: null,
});
const patchOk = (id: string, email: string, status: 'active' | 'suspended'): api.PatchOutcome => ({
  id, email, role: 'member', status, cf_synced: true, sync_error: null,
});
const spyToast = () => vi.spyOn(toast, 'pushToast').mockReturnValue('toast-id');
const lastToast = (s: ReturnType<typeof spyToast>) => s.mock.calls[s.mock.calls.length - 1][0];

const baseResponse = {
  users: [
    { id: '1', email: 'admin@repos.test', display_name: 'Admin', role: 'admin', status: 'active',
      invited_at: null, activated_at: '2026-07-01T00:00:00Z', last_seen_at: '2026-07-26T00:00:00Z',
      cf_synced_at: '2026-07-26T00:00:00Z', invite_sent_at: null, invited_by_email: null },
    { id: '2', email: 'pending@repos.test', display_name: null, role: 'member', status: 'invited',
      invited_at: '2026-07-25T00:00:00Z', activated_at: null, last_seen_at: null,
      cf_synced_at: null, invite_sent_at: null, invited_by_email: 'admin@repos.test' },
  ],
  cohort: { count: 2, cap: 10 },
  drift: { checked: true, policy_error: null, divergent: [], unknown: ['pending@repos.test'] },
};

beforeEach(() => vi.restoreAllMocks());

// The page reads `useCurrentUser()` for `is_admin` and for the Q13 self-action
// rule (`row.id !== currentUserId`). `AuthContext`'s default value is
// `{ status:'loading', user:null }`, so rendering without a provider or a mock
// leaves `currentUserId` undefined — every row then compares unequal, the
// signed-in admin's row grows a full action set, and both the self-action test
// and the delete test (which indexes [0] of the DELETE buttons) fail.
// `renderPage` mocks the hook so the signed-in user is row id '1'.
function renderPage(user: Partial<auth.User> = {}) {
  vi.spyOn(auth, 'useCurrentUser').mockReturnValue({
    status: 'authenticated',
    user: {
      id: '1',                       // matches baseResponse's admin row
      email: 'admin@repos.test',
      display_name: 'Admin',
      timezone: 'America/New_York',
      is_admin: true,
      ...user,
    },
    error: null,
  });
  return render(<MemoryRouter><SettingsUsersPage /></MemoryRouter>);
}

/**
 * The <tr> for a given user. Keyed by testid rather than by
 * `getByText(email).closest('tr')` because an address appears in BOTH its
 * owner's email cell and in some other row's "invited by" cell, so the text
 * query matches two elements and throws.
 */
function rowFor(email: string): HTMLElement {
  return screen.getByTestId(`user-row-${email}`);
}

describe('SettingsUsersPage', () => {
  it('renders email, status, role, last seen, invited by and sync state', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    renderPage();
    // NB: `findByText('admin@repos.test')` matches TWO nodes — that row's own
    // email cell and the "invited by" cell of the row it invited.
    expect(await screen.findByTestId('user-row-admin@repos.test')).toBeInTheDocument();
    expect(screen.getByText('pending@repos.test')).toBeInTheDocument();
    // Asserted per-row, not as a page-wide /invited/i match: the "Invited by"
    // COLUMN HEADER also matches that regex, so a page rendering no status at
    // all would have satisfied it.
    expect(within(rowFor('pending@repos.test')).getByText('INVITED')).toBeInTheDocument();
    expect(within(rowFor('admin@repos.test')).getByText('ACTIVE')).toBeInTheDocument();
    expect(within(rowFor('pending@repos.test')).getByText('MEMBER')).toBeInTheDocument();
    expect(within(rowFor('admin@repos.test')).getByText('ADMIN')).toBeInTheDocument();
    // last seen + invited by
    expect(within(rowFor('admin@repos.test')).getByText(/2026-07-26/)).toBeInTheDocument();
    expect(within(rowFor('pending@repos.test')).getByText('admin@repos.test')).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 10/)).toBeInTheDocument();
  });

  it('shows SYNC PENDING for a row with no stamp, not a drift error', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    renderPage();
    expect(await screen.findByText(/sync pending/i)).toBeInTheDocument();
    expect(within(rowFor('admin@repos.test')).getByText('SYNCED')).toBeInTheDocument();
    // Q36 — `unknown` is sync-pending, NOT divergence. No banner, no advisory.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the drift banner only for CONFIRMED divergence', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue({
      ...baseResponse,
      drift: { checked: true, policy_error: null, unknown: [],
        divergent: [{ email: 'ghost@repos.test', reason: 'in_policy_no_row' }] },
    } as never);
    renderPage();
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/diverge/i);
    expect(banner).toHaveTextContent('ghost@repos.test');
    expect(banner).toHaveTextContent(/in_policy_no_row/);
  });

  it('surfaces a policy read failure without hiding the table', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue({
      ...baseResponse,
      drift: { checked: false, policy_error: 'app_count_not_one', divergent: [], unknown: [] },
    } as never);
    renderPage();
    expect(await screen.findByTestId('user-row-admin@repos.test')).toBeInTheDocument();
    const advisory = screen.getByRole('status');
    expect(advisory).toHaveTextContent(/app_count_not_one/);
    // An unread policy is UNKNOWN, not divergence — it must not claim drift.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('403 renders "Not authorized" rather than an empty table', async () => {
    vi.spyOn(api, 'listUsers').mockRejectedValue({ status: 403 });
    renderPage();
    expect(await screen.findByText(/not authorized/i)).toBeInTheDocument();
  });

  it('invite modal posts the email and role, then refreshes', async () => {
    const list = vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    const invite = vi.spyOn(api, 'inviteUser').mockResolvedValue(inviteOk('new@repos.test'));
    const toasted = spyToast();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'new@repos.test');
    await userEvent.click(screen.getByRole('button', { name: /^send invite$/i }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith('new@repos.test', 'member'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(lastToast(toasted).severity).toBe('success');
  });

  // A 201 whose CF sync failed: no policy grant, no stamp, no email attempted.
  // Reporting "Invited" here tells the admin to wait for someone who was never
  // asked and could not act on it if they had been.
  it('a 201 with cf_synced=false is NOT reported as an invitation', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    vi.spyOn(api, 'inviteUser').mockResolvedValue({
      ...inviteOk('new@repos.test'),
      cf_synced: false, invite_sent: false, sync_error: 'cf_http_403',
    });
    const toasted = spyToast();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'new@repos.test');
    await userEvent.click(screen.getByRole('button', { name: /^send invite$/i }));
    await waitFor(() => expect(toasted).toHaveBeenCalled());
    const t = lastToast(toasted);
    expect(t.severity).toBe('error');
    expect(t.body).toMatch(/cf_http_403/);
    expect(t.body).toMatch(/cannot sign in/i);
  });

  // The opposite partial failure, and the opposite instruction: provisioned,
  // so they CAN sign in — only the email failed.
  it('a 201 with invite_sent=false says they can sign in but must be resent', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    vi.spyOn(api, 'inviteUser').mockResolvedValue({
      ...inviteOk('new@repos.test'),
      invite_sent: false, mail_error: 'mail_http_error',
    });
    const toasted = spyToast();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'new@repos.test');
    await userEvent.click(screen.getByRole('button', { name: /^send invite$/i }));
    await waitFor(() => expect(toasted).toHaveBeenCalled());
    const t = lastToast(toasted);
    expect(t.severity).toBe('error');
    expect(t.body).toMatch(/mail_http_error/);
    expect(t.body).toMatch(/can sign in/i);
  });

  it('a resend that did not deliver is not reported as resent', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    vi.spyOn(api, 'resendInvite').mockResolvedValue({
      ...inviteOk('pending@repos.test', '2'),
      created: false, invite_sent: false, mail_error: 'mail_http_error',
    });
    const toasted = spyToast();
    renderPage();
    await userEvent.click(
      within(await screen.findByTestId('user-row-pending@repos.test')).getByRole('button', { name: /^resend$/i }),
    );
    await waitFor(() => expect(toasted).toHaveBeenCalled());
    expect(lastToast(toasted).severity).toBe('error');
    expect(lastToast(toasted).body).toMatch(/mail_http_error/);
  });

  it('surfaces a 409 cohort_cap_reached with the count', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    vi.spyOn(api, 'inviteUser').mockRejectedValue({ status: 409, body: { error: 'cohort_cap_reached', count: 10, cap: 10 } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'new@repos.test');
    await userEvent.click(screen.getByRole('button', { name: /^send invite$/i }));
    expect(await screen.findByText(/10 \/ 10/)).toBeInTheDocument();
    // The modal stays open on an in-modal error, and the address that caused
    // it must survive — retyping it to read the error is not a fix workflow.
    expect(screen.getByLabelText(/email/i)).toHaveValue('new@repos.test');
  });

  it('clears the invite form between openings', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    const invite = vi.spyOn(api, 'inviteUser').mockResolvedValue(inviteOk('first@repos.test'));
    spyToast();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'first@repos.test');
    await userEvent.selectOptions(screen.getByLabelText(/role/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /^send invite$/i }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith('first@repos.test', 'admin'));

    // Reopening must not re-offer the previous address (resubmitting it hits
    // the duplicate-invite path) or the previous role (which would silently
    // make the NEXT address an admin).
    await userEvent.click(screen.getByRole('button', { name: /invite user/i }));
    expect(screen.getByLabelText(/email/i)).toHaveValue('');
    expect(screen.getByLabelText(/role/i)).toHaveValue('member');
  });

  it('clears the invite form after a cancel', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /invite user/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'typo@repos.test');
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await userEvent.click(screen.getByRole('button', { name: /invite user/i }));
    expect(screen.getByLabelText(/email/i)).toHaveValue('');
  });

  it('delete requires typed confirmation (heavy action)', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    const del = vi.spyOn(api, 'deleteUser').mockResolvedValue(undefined as never);
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: /^delete$/i }))[0]);
    const confirmBtn = screen.getByRole('button', { name: /delete user/i });
    expect(confirmBtn).toBeDisabled();
    // ConfirmDialog's heavy tier owns the typed-confirm input (one textbox).
    await userEvent.type(screen.getByRole('textbox'), 'pending@repos.test');
    expect(confirmBtn).toBeEnabled();
    await userEvent.click(confirmBtn);
    await waitFor(() => expect(del).toHaveBeenCalledWith('2'));
  });

  it('light actions fire without a confirmation step', async () => {
    const list = vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    const resend = vi.spyOn(api, 'resendInvite').mockResolvedValue({
      ...inviteOk('pending@repos.test', '2'), created: false, resent: true,
    });
    const retry = vi.spyOn(api, 'retrySync').mockResolvedValue({ id: '2', cf_synced: true, sync_error: null, direction: 'present' });
    renderPage();
    const row = () => within(rowFor('pending@repos.test'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await userEvent.click(row().getByRole('button', { name: /^resend$/i }));
    await waitFor(() => expect(resend).toHaveBeenCalledWith('2'));
    await userEvent.click(row().getByRole('button', { name: /^retry sync$/i }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith('2'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  });

  it('suspend is a medium action — confirmed, then PATCHed', async () => {
    const list = vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    const patch = vi.spyOn(api, 'patchUser').mockResolvedValue(patchOk('2', 'pending@repos.test', 'suspended'));
    const toasted = spyToast();
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: /^suspend$/i }))[0]);
    expect(patch).not.toHaveBeenCalled();          // the dialog gates the call
    await userEvent.click(screen.getByRole('button', { name: /suspend user/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('2', { status: 'suspended' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(lastToast(toasted).severity).toBe('success');
  });

  // The DB revocation committed — they are already refused on both auth paths
  // — but the policy still lists them. That is a warning with follow-up work,
  // not an error, and certainly not plain success.
  it('a suspend whose policy removal failed warns that sync is pending', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    vi.spyOn(api, 'patchUser').mockResolvedValue({
      ...patchOk('2', 'pending@repos.test', 'suspended'),
      cf_synced: false, sync_error: 'cf_http_500',
    });
    const toasted = spyToast();
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: /^suspend$/i }))[0]);
    await userEvent.click(screen.getByRole('button', { name: /suspend user/i }));
    await waitFor(() => expect(toasted).toHaveBeenCalled());
    const t = lastToast(toasted);
    expect(t.severity).toBe('warn');
    expect(t.body).toMatch(/cf_http_500/);
    expect(t.body).toMatch(/retry sync/i);
  });

  it('reinstate PATCHes a suspended row back to active', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue({
      ...baseResponse,
      users: [
        baseResponse.users[0],
        { ...baseResponse.users[1], id: '3', email: 'gone@repos.test', status: 'suspended' },
      ],
    } as never);
    const patch = vi.spyOn(api, 'patchUser').mockResolvedValue(patchOk('3', 'gone@repos.test', 'active'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^reinstate$/i }));
    await userEvent.click(screen.getByRole('button', { name: /reinstate user/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('3', { status: 'active' }));
  });

  it('offers no row action that targets the signed-in admin', async () => {
    vi.spyOn(api, 'listUsers').mockResolvedValue(baseResponse as never);
    renderPage();
    await screen.findByTestId('user-row-admin@repos.test');
    // Self-management lives in /settings/account (Q13).
    expect(rowFor('admin@repos.test').querySelectorAll('button')).toHaveLength(0);
    // Positive control: the assertion above is only meaningful if OTHER rows
    // do carry actions. Without this a page that renders no buttons at all
    // passes.
    expect(rowFor('pending@repos.test').querySelectorAll('button').length).toBeGreaterThan(0);
  });
});
