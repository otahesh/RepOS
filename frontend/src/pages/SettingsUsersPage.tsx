// frontend/src/pages/SettingsUsersPage.tsx
// Beta W9 — /settings/users. Admin-only in the sidebar; the API enforces
// role='admin' server-side regardless, so a member who types the URL gets
// "Not authorized" rather than an empty table.
//
// Q36 governs the two drift surfaces, and they are SEPARATE branches:
//
//   * CONFIRMED divergence (`drift.divergent`) → an alert. Something the
//     operator must repair.
//   * The policy could not be read at all (`drift.checked === false`) → an
//     advisory. Sync state is unknown, which is not a claim of divergence.
//
// There is deliberately NO healthy-case "in sync" banner, and `drift.unknown`
// gets none either — it is per-row SYNC PENDING. Both would be false alarms,
// and a banner an operator learns to ignore is worse than no banner.
import { useCallback, useEffect, useState } from 'react';
import { TOKENS, FONTS } from '../tokens';
import { useCurrentUser } from '../auth';
import { pushToast } from '../components/common/ToastHost';
import { UsersTable, type RowAction } from '../components/settings/UsersTable';
import { InviteUserModal, inviteErrorMessage } from '../components/settings/InviteUserModal';
import {
  listUsers, inviteUser, patchUser, resendInvite, retrySync, deleteUser,
  type AdminUserList, type AdminUserRow, type UserRole,
} from '../lib/api/adminUsers';

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

export default function SettingsUsersPage(): JSX.Element {
  const { user } = useCurrentUser();
  const [data, setData] = useState<AdminUserList | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Refreshing must NOT clear `data` — the table stays on screen while the
  // re-read is in flight rather than flashing back to "Loading…".
  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setData(await listUsers());
    } catch (err) {
      const status = statusOf(err);
      if (status === 401 || status === 403) setDenied(true);
      // Anything else (5xx, network, parse) must surface an actionable,
      // retryable error — never a spinner that never resolves.
      else setError(`Could not load users — GET /api/admin/users${status ? ` returned HTTP ${status}` : ' failed (network)'}.`);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleAction(action: RowAction, row: AdminUserRow): Promise<void> {
    setBusyId(row.id);
    try {
      switch (action) {
        case 'resend':
          await resendInvite(row.id);
          pushToast({ severity: 'success', body: `Invite resent to ${row.email}.` });
          break;
        case 'retry-sync': {
          const out = await retrySync(row.id);
          // A 200 does not mean it worked — the service reports the failure in
          // the body rather than throwing.
          pushToast(out.cf_synced
            ? { severity: 'success', body: `${row.email} reconciled with Cloudflare.` }
            : { severity: 'error', body: `Sync still failing for ${row.email} — ${out.sync_error ?? 'unknown error'}.` });
          break;
        }
        case 'suspend':
          await patchUser(row.id, { status: 'suspended' });
          pushToast({ severity: 'success', body: `${row.email} suspended.` });
          break;
        case 'reinstate':
          await patchUser(row.id, { status: 'active' });
          pushToast({ severity: 'success', body: `${row.email} reinstated.` });
          break;
        case 'delete':
          await deleteUser(row.id);
          pushToast({ severity: 'success', body: `${row.email} deleted.` });
          break;
      }
      await load();
    } catch (err) {
      const status = statusOf(err);
      const code = (err as { body?: { error?: string } } | null)?.body?.error;
      pushToast({
        severity: 'error',
        body: `${action.replace('-', ' ')} failed for ${row.email}${code ? ` — ${code}` : status ? ` — HTTP ${status}` : ''}.`,
      });
      // The row may have changed even on failure (a suspend whose CF half
      // failed still committed the DB half), so re-read rather than guess.
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleInvite(email: string, role: UserRole): Promise<void> {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const out = await inviteUser(email, role);
      setInviteOpen(false);
      // Q7 — a mail failure leaves a real, provisioned invitee. Reporting it
      // as a failed invite would be wrong; they can sign in.
      pushToast(out.mail_error
        ? { severity: 'error', body: `${email} was provisioned, but the email failed (${out.mail_error}). Use Resend.` }
        : { severity: 'success', body: `Invited ${email}.` });
      await load();
    } catch (err) {
      setInviteError(inviteErrorMessage(err));
    } finally {
      setInviteBusy(false);
    }
  }

  if (denied) {
    return <div style={{ padding: 32, color: TOKENS.danger, fontFamily: FONTS.mono }}>Not authorized.</div>;
  }

  const drift = data?.drift;

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontFamily: FONTS.ui, color: TOKENS.text }}>Users</h1>
        {data && (
          <span
            title="Counted cohort: active + invited + deleting"
            style={{
              fontFamily: FONTS.mono, fontSize: 12,
              color: data.cohort.count >= data.cohort.cap ? TOKENS.warn : TOKENS.textDim,
              border: `1px solid ${TOKENS.line}`, borderRadius: 999, padding: '3px 10px',
            }}
          >{data.cohort.count} / {data.cohort.cap}</span>
        )}
        <button
          type="button" onClick={() => { setInviteError(null); setInviteOpen(true); }}
          style={{
            marginLeft: 'auto', padding: '7px 14px', borderRadius: 6,
            border: `1px solid ${TOKENS.accent}`, background: TOKENS.accent, color: '#fff',
            fontFamily: FONTS.ui, fontSize: 12, fontWeight: 600, letterSpacing: 0.5,
            textTransform: 'uppercase', cursor: 'pointer',
          }}
        >Invite user</button>
      </div>

      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, color: TOKENS.danger, fontFamily: FONTS.mono, fontSize: 12 }}>
          <span>{error}</span>
          <button type="button" onClick={() => void load()}
            style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${TOKENS.line}`, background: TOKENS.bg, color: TOKENS.text, fontFamily: FONTS.ui, fontSize: 12, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {/* CONFIRMED divergence only. */}
      {drift && drift.divergent.length > 0 && (
        <div role="alert" style={{
          background: TOKENS.surface, border: `1px solid ${TOKENS.danger}`, borderRadius: 10,
          padding: 14, fontFamily: FONTS.ui, fontSize: 13, color: TOKENS.text,
        }}>
          <strong style={{ color: TOKENS.danger }}>
            The Cloudflare Access policy diverges from RepOS.
          </strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontFamily: FONTS.mono, fontSize: 12 }}>
            {drift.divergent.map((d) => (
              <li key={`${d.email}:${d.reason}`} style={{ marginBottom: 2 }}>
                {d.email} — {d.reason}
              </li>
            ))}
          </ul>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: TOKENS.textDim }}>
            Drift is never auto-corrected. Fix it with Retry sync on the affected row, or in the
            Cloudflare dashboard for an address with no RepOS row.
          </p>
        </div>
      )}

      {/* Separate branch, NOT nested under divergence: an unread policy means
          sync state is unknown for every row, which is not a claim of drift. */}
      {drift && !drift.checked && (
        <div role="status" style={{
          background: TOKENS.surface, border: `1px solid ${TOKENS.warn}`, borderRadius: 10,
          padding: 14, fontFamily: FONTS.ui, fontSize: 13, color: TOKENS.text,
        }}>
          <strong style={{ color: TOKENS.warn }}>Cloudflare policy could not be read</strong>
          <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: TOKENS.textDim }}>
            {' '}({drift.policy_error ?? 'unknown'})
          </span>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: TOKENS.textDim }}>
            Sync state is unknown for every row below. This is not drift — the comparison did not run.
          </p>
        </div>
      )}

      {!error && data === null && (
        <div style={{ color: TOKENS.textMute, fontFamily: FONTS.mono, fontSize: 12 }}>Loading…</div>
      )}

      {data && (
        <UsersTable
          rows={data.users}
          currentUserId={user?.id}
          busyId={busyId}
          onAction={(action, row) => void handleAction(action, row)}
        />
      )}

      <InviteUserModal
        open={inviteOpen}
        busy={inviteBusy}
        error={inviteError}
        onSubmit={(email, role) => void handleInvite(email, role)}
        onCancel={() => setInviteOpen(false)}
      />
    </div>
  );
}
