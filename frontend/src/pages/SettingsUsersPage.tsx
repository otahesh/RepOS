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
import type { ToastSpec } from '../components/common/ToastHost';
import { UsersTable, type RowAction } from '../components/settings/UsersTable';
import { InviteUserModal, inviteErrorMessage } from '../components/settings/InviteUserModal';
import {
  listUsers,
  inviteUser,
  patchUser,
  resendInvite,
  retrySync,
  deleteUser,
  type AdminUserList,
  type AdminUserRow,
  type UserRole,
  type InviteOutcome,
  type PatchOutcome,
} from '../lib/api/adminUsers';
import { Button, DataState, Page, PageHeader, StatusBadge } from '../components/ui';

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

/**
 * A 2xx from the invite path does NOT mean the invitation happened.
 * `provisionAndMail` (userLifecycle.ts) *returns* both partial failures rather
 * than throwing, because each leaves a durable row that must not roll back:
 *
 *   cf_synced=false — the row exists but is absent from the Cloudflare policy
 *                     and unstamped, so Q17b refuses activation. No email was
 *                     attempted. They cannot sign in.
 *   invite_sent=false — provisioned and able to sign in; only the mail failed.
 *
 * The two are opposite instructions to the operator, so they cannot share
 * copy, and neither may be reported as plain success.
 */
function inviteOutcomeToast(out: InviteOutcome, email: string, success: string): ToastSpec {
  if (!out.cf_synced) {
    return {
      severity: 'error',
      body: `${email} was created but NOT added to the Cloudflare policy (${out.sync_error ?? 'unknown error'}). No invitation was sent and they cannot sign in — use Retry sync, then Resend.`,
    };
  }
  if (!out.invite_sent) {
    return {
      severity: 'error',
      body: `${email} is provisioned and can sign in, but the invitation email failed (${out.mail_error ?? 'unknown error'}). Use Resend.`,
    };
  }
  return { severity: 'success', body: success };
}

/**
 * Suspend commits the DB revocation and then attempts the policy removal,
 * reporting a failed removal in the body rather than throwing (patchUser).
 * That is a WARNING, not an error: per the governing model the DB transition
 * IS the security event — the user is already refused on both auth paths — and
 * what remains is a stale policy entry to reconcile.
 *
 * Reinstate cannot reach the false branch today (Q34 makes a failed CF add a
 * thrown 502), but it shares this helper so it can never silently gain a
 * success-shaped lie either.
 */
function patchOutcomeToast(out: PatchOutcome, email: string, success: string): ToastSpec {
  if (out.cf_synced) return { severity: 'success', body: success };
  return {
    severity: 'warn',
    body: `${email} is now ${out.status} and the change is enforced on every request, but the Cloudflare policy update failed (${out.sync_error ?? 'unknown error'}). Sync is pending — use Retry sync.`,
  };
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
      else
        setError(
          `Could not load users — GET /api/admin/users${status ? ` returned HTTP ${status}` : ' failed (network)'}.`,
        );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAction(action: RowAction, row: AdminUserRow): Promise<void> {
    setBusyId(row.id);
    try {
      switch (action) {
        case 'resend':
          pushToast(
            inviteOutcomeToast(
              await resendInvite(row.id),
              row.email,
              `Invite resent to ${row.email}.`,
            ),
          );
          break;
        case 'retry-sync': {
          const out = await retrySync(row.id);
          // A 200 does not mean it worked — the service reports the failure in
          // the body rather than throwing.
          pushToast(
            out.cf_synced
              ? { severity: 'success', body: `${row.email} reconciled with Cloudflare.` }
              : {
                  severity: 'error',
                  body: `Sync still failing for ${row.email} — ${out.sync_error ?? 'unknown error'}.`,
                },
          );
          break;
        }
        case 'suspend':
          pushToast(
            patchOutcomeToast(
              await patchUser(row.id, { status: 'suspended' }),
              row.email,
              `${row.email} suspended.`,
            ),
          );
          break;
        case 'reinstate':
          pushToast(
            patchOutcomeToast(
              await patchUser(row.id, { status: 'active' }),
              row.email,
              `${row.email} reinstated.`,
            ),
          );
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
      // Q7/Q8 — the row is durable on every 2xx path, but "durable" is not
      // "invited": both partial failures arrive here as a 201, not a throw.
      pushToast(inviteOutcomeToast(out, email, `Invited ${email}.`));
      await load();
    } catch (err) {
      setInviteError(inviteErrorMessage(err));
    } finally {
      setInviteBusy(false);
    }
  }

  if (denied) {
    return (
      <Page width="wide">
        <DataState
          kind="error"
          title="Not authorized"
          body="Your account does not have permission to manage RepOS users."
        />
      </Page>
    );
  }

  const drift = data?.drift;

  return (
    <Page
      width="data"
      style={{ display: 'flex', flexDirection: 'column', gap: 14, color: TOKENS.text }}
    >
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Manage access, roles, synchronization, and account recovery."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {data ? (
              <StatusBadge tone={data.cohort.count >= data.cohort.cap ? 'warning' : 'neutral'}>
                {data.cohort.count} / {data.cohort.cap} seats
              </StatusBadge>
            ) : null}
            <Button
              variant="primary"
              type="button"
              onClick={() => {
                setInviteError(null);
                setInviteOpen(true);
              }}
            >
              Invite user
            </Button>
          </div>
        }
      />

      {error && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 10,
            color: TOKENS.danger,
            fontFamily: FONTS.mono,
            fontSize: 12,
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${TOKENS.line}`,
              background: TOKENS.bg,
              color: TOKENS.text,
              fontFamily: FONTS.ui,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* CONFIRMED divergence only. */}
      {drift && drift.divergent.length > 0 && (
        <div
          role="alert"
          style={{
            background: TOKENS.surface,
            border: `1px solid ${TOKENS.danger}`,
            borderRadius: 10,
            padding: 14,
            fontFamily: FONTS.ui,
            fontSize: 13,
            color: TOKENS.text,
          }}
        >
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
        <div
          role="status"
          style={{
            background: TOKENS.surface,
            border: `1px solid ${TOKENS.warn}`,
            borderRadius: 10,
            padding: 14,
            fontFamily: FONTS.ui,
            fontSize: 13,
            color: TOKENS.text,
          }}
        >
          <strong style={{ color: TOKENS.warn }}>Cloudflare policy could not be read</strong>
          <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: TOKENS.textDim }}>
            {' '}
            ({drift.policy_error ?? 'unknown'})
          </span>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: TOKENS.textDim }}>
            Sync state is unknown for every row below. This is not drift — the comparison did not
            run.
          </p>
        </div>
      )}

      {!error && data === null && <DataState kind="loading" title="Loading users" />}

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
    </Page>
  );
}
