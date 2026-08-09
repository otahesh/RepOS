// frontend/src/components/settings/UsersTable.tsx
// Beta W9 — the admin user list: email · status · role · last seen ·
// invited by · sync state, plus per-row actions.
//
// Two rules this component exists to hold:
//
//   Q13 — NO action may target the signed-in admin. Self-management lives in
//   /settings/account, and the API refuses every self-targeted call with 409
//   `self_target_forbidden` anyway; rendering the buttons would only offer an
//   operation that cannot succeed.
//
//   Q36 — `cf_synced_at === null` means sync state UNKNOWN, not "content
//   differs". It renders as SYNC PENDING on the row and never as drift.
//
// Action weights follow the architecture diagram: light (resend, retry sync)
// fire immediately; medium (suspend, reinstate) take a ConfirmDialog; heavy
// (delete) takes a typed-confirmation ConfirmDialog.
import { useState } from 'react';
import { TOKENS, FONTS } from '../../tokens';
import { ConfirmDialog } from '../common/ConfirmDialog';
import type { AdminUserRow, UserStatus } from '../../lib/api/adminUsers';

export type RowAction = 'resend' | 'retry-sync' | 'suspend' | 'reinstate' | 'delete';

interface Props {
  rows: AdminUserRow[];
  /** From /api/me. Undefined means "unknown", which must NOT unlock actions. */
  currentUserId?: string;
  /** Row id with an in-flight mutation; its actions are disabled. */
  busyId?: string | null;
  onAction: (action: RowAction, row: AdminUserRow) => void;
}

const STATUS_COLOR: Record<UserStatus, string> = {
  active: TOKENS.good,
  invited: TOKENS.accent,
  suspended: TOKENS.warn,
  deleting: TOKENS.danger,
};

/** ISO timestamps arrive as YYYY-MM-DDTHH:MM:SSZ; the date is what an operator reads. */
function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontFamily: FONTS.ui,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: TOKENS.textMute,
  borderBottom: `1px solid ${TOKENS.line}`,
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px',
  fontFamily: FONTS.mono,
  fontSize: 12,
  color: TOKENS.text,
  borderBottom: `1px solid ${TOKENS.line}`,
  whiteSpace: 'nowrap',
};

function actionButton(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '4px 9px',
    borderRadius: 6,
    border: `1px solid ${TOKENS.line}`,
    background: TOKENS.bg,
    color,
    fontFamily: FONTS.ui,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: 'uppercase', // voice: all-caps for CTAs
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

interface Pending {
  action: Extract<RowAction, 'suspend' | 'reinstate' | 'delete'>;
  row: AdminUserRow;
}

const CONFIRM_COPY: Record<
  Pending['action'],
  {
    title: string;
    body: string;
    label: string;
    severity: 'warn' | 'accent' | 'danger';
    tier: 'medium' | 'heavy';
  }
> = {
  suspend: {
    title: 'Suspend this user?',
    // Q7/Q17 — revocations take effect first: the DB transition is the
    // security event, and it is immediate on both auth paths.
    body: 'They are refused on every request immediately, and their address is removed from the Cloudflare Access policy. Reinstating restores both.',
    label: 'Suspend user',
    severity: 'warn',
    tier: 'medium',
  },
  reinstate: {
    title: 'Reinstate this user?',
    body: 'Their address goes back into the Cloudflare Access policy and they can sign in again. This counts against the cohort cap.',
    label: 'Reinstate user',
    severity: 'accent',
    tier: 'medium',
  },
  delete: {
    title: 'Delete this user?',
    body: 'This permanently deletes the account and every byte of data tied to it, and removes the address from the Cloudflare Access policy. This cannot be undone.',
    label: 'Delete user',
    severity: 'danger',
    tier: 'heavy',
  },
};

export function UsersTable({ rows, currentUserId, busyId, onAction }: Props): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = pending ? CONFIRM_COPY[pending.action] : null;

  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Email</th>
            <th style={th}>Status</th>
            <th style={th}>Role</th>
            <th style={th}>Last seen</th>
            <th style={th}>Invited by</th>
            <th style={th}>Sync</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // Q13 — an unknown current user must not unlock actions on every
            // row, so compare only when we actually know who we are.
            const isSelf = currentUserId === undefined || row.id === currentUserId;
            const busy = busyId === row.id;
            const fire = (action: RowAction) => () => onAction(action, row);
            const ask = (action: Pending['action']) => () => setPending({ action, row });

            return (
              <tr key={row.id} data-testid={`user-row-${row.email}`}>
                <td style={td}>
                  {row.email}
                  {row.display_name && (
                    <span style={{ color: TOKENS.textMute }}> · {row.display_name}</span>
                  )}
                </td>
                <td style={{ ...td, color: STATUS_COLOR[row.status], fontWeight: 600 }}>
                  {row.status.toUpperCase()}
                </td>
                <td style={td}>{row.role.toUpperCase()}</td>
                <td style={{ ...td, color: TOKENS.textDim }}>{day(row.last_seen_at)}</td>
                <td style={{ ...td, color: TOKENS.textDim }}>{row.invited_by_email ?? '—'}</td>
                <td style={{ ...td, color: row.cf_synced_at ? TOKENS.good : TOKENS.warn }}>
                  {row.cf_synced_at ? 'SYNCED' : 'SYNC PENDING'}
                </td>
                <td style={td}>
                  {isSelf ? (
                    <span style={{ color: TOKENS.textMute, fontSize: 11 }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {row.status === 'invited' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={fire('resend')}
                          style={actionButton(TOKENS.text, busy)}
                        >
                          Resend
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={fire('retry-sync')}
                        style={actionButton(TOKENS.text, busy)}
                      >
                        Retry sync
                      </button>
                      {(row.status === 'active' || row.status === 'invited') && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={ask('suspend')}
                          style={actionButton(TOKENS.warn, busy)}
                        >
                          Suspend
                        </button>
                      )}
                      {row.status === 'suspended' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={ask('reinstate')}
                          style={actionButton(TOKENS.accent, busy)}
                        >
                          Reinstate
                        </button>
                      )}
                      {/* Also offered on a `deleting` row: Q37 — an interrupted
                          self-deletion can only be completed by an admin, and
                          deleteUser resumes rather than restarting. */}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={ask('delete')}
                        style={actionButton(TOKENS.danger, busy)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmDialog
        open={pending !== null}
        tier={confirm?.tier ?? 'medium'}
        title={confirm?.title ?? ''}
        body={pending ? `${pending.row.email} — ${confirm?.body ?? ''}` : ''}
        requireTyped={pending?.action === 'delete' ? pending.row.email : undefined}
        confirmLabel={confirm?.label ?? 'Confirm'}
        severity={confirm?.severity ?? 'accent'}
        onConfirm={() => {
          if (!pending) return;
          const { action, row } = pending;
          setPending(null);
          onAction(action, row);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
