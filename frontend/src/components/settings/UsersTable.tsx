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
import { useIsBelowTablet } from '../../lib/useIsMobile';
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

const ACTION_LABEL: Record<RowAction, string> = {
  resend: 'Resend',
  'retry-sync': 'Retry sync',
  suspend: 'Suspend',
  reinstate: 'Reinstate',
  delete: 'Delete',
};

function actionsFor(row: AdminUserRow): RowAction[] {
  return [
    ...(row.status === 'invited' ? (['resend'] as const) : []),
    'retry-sync',
    ...(row.status === 'active' || row.status === 'invited' ? (['suspend'] as const) : []),
    ...(row.status === 'suspended' ? (['reinstate'] as const) : []),
    'delete',
  ];
}

function primaryActionFor(row: AdminUserRow): RowAction {
  if (row.status === 'invited') return 'resend';
  if (row.status === 'suspended') return 'reinstate';
  if (row.status === 'deleting') return 'delete';
  return row.cf_synced_at ? 'suspend' : 'retry-sync';
}

function colorFor(action: RowAction): string {
  if (action === 'delete') return TOKENS.danger;
  if (action === 'suspend') return TOKENS.warn;
  if (action === 'reinstate') return TOKENS.accent;
  return TOKENS.text;
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
  const isMobile = useIsBelowTablet();

  const confirm = pending ? CONFIRM_COPY[pending.action] : null;

  const trigger = (action: RowAction, row: AdminUserRow): void => {
    if (action === 'suspend' || action === 'reinstate' || action === 'delete') {
      setPending({ action, row });
    } else {
      onAction(action, row);
    }
  };

  return (
    <>
      {isMobile ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((row) => {
            const isSelf = currentUserId === undefined || row.id === currentUserId;
            const busy = busyId === row.id;
            const primary = primaryActionFor(row);
            const overflow = actionsFor(row).filter((action) => action !== primary);
            return (
              <article
                key={row.id}
                data-testid={`user-row-${row.email}`}
                style={{
                  border: `1px solid ${TOKENS.line}`,
                  borderRadius: 12,
                  background: TOKENS.surface,
                  padding: 16,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: TOKENS.text,
                      fontWeight: 650,
                      fontSize: 15,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {row.email}
                  </div>
                  {row.display_name && (
                    <div style={{ color: TOKENS.textDim, fontSize: 13, marginTop: 3 }}>
                      {row.display_name}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <span
                    style={{
                      border: `1px solid ${STATUS_COLOR[row.status]}55`,
                      borderRadius: 999,
                      color: STATUS_COLOR[row.status],
                      padding: '4px 8px',
                      font: `700 10px ${FONTS.mono}`,
                      letterSpacing: 0.7,
                    }}
                  >
                    {row.status.toUpperCase()}
                  </span>
                  <span
                    style={{
                      border: `1px solid ${TOKENS.line}`,
                      borderRadius: 999,
                      color: TOKENS.textDim,
                      padding: '4px 8px',
                      font: `700 10px ${FONTS.mono}`,
                      letterSpacing: 0.7,
                    }}
                  >
                    {row.role.toUpperCase()}
                  </span>
                  <span
                    style={{
                      border: `1px solid ${TOKENS.line}`,
                      borderRadius: 999,
                      color: row.cf_synced_at ? TOKENS.good : TOKENS.warn,
                      padding: '4px 8px',
                      font: `700 10px ${FONTS.mono}`,
                      letterSpacing: 0.7,
                    }}
                  >
                    {row.cf_synced_at ? 'SYNCED' : 'SYNC PENDING'}
                  </span>
                </div>

                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '88px minmax(0, 1fr)',
                    gap: '7px 12px',
                    marginTop: 14,
                    fontSize: 12,
                  }}
                >
                  <dt style={{ color: TOKENS.textMute }}>Last seen</dt>
                  <dd style={{ color: TOKENS.textDim, fontFamily: FONTS.mono }}>
                    {day(row.last_seen_at)}
                  </dd>
                  <dt style={{ color: TOKENS.textMute }}>Invited by</dt>
                  <dd style={{ color: TOKENS.textDim, overflowWrap: 'anywhere' }}>
                    {row.invited_by_email ?? '—'}
                  </dd>
                </dl>

                {!isSelf && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: overflow.length > 0 ? '1fr 48px' : '1fr',
                      gap: 8,
                      marginTop: 16,
                    }}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => trigger(primary, row)}
                      style={{
                        minHeight: 44,
                        borderRadius: 8,
                        border: `1px solid ${colorFor(primary)}`,
                        background: primary === 'delete' ? 'transparent' : TOKENS.surface2,
                        color: colorFor(primary),
                        fontWeight: 700,
                        fontSize: 13,
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      {busy ? 'Working…' : ACTION_LABEL[primary]}
                    </button>
                    {overflow.length > 0 && (
                      <details style={{ position: 'relative' }}>
                        <summary
                          aria-label={`More actions for ${row.email}`}
                          style={{
                            minWidth: 48,
                            minHeight: 44,
                            listStyle: 'none',
                            borderRadius: 8,
                            border: `1px solid ${TOKENS.line}`,
                            background: TOKENS.surface2,
                            color: TOKENS.text,
                            display: 'grid',
                            placeItems: 'center',
                            cursor: 'pointer',
                            fontSize: 20,
                          }}
                        >
                          ⋯
                        </summary>
                        <div
                          style={{
                            position: 'absolute',
                            zIndex: 5,
                            right: 0,
                            bottom: 50,
                            width: 180,
                            padding: 6,
                            borderRadius: 10,
                            border: `1px solid ${TOKENS.lineStrong}`,
                            background: TOKENS.surface3,
                            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                            display: 'grid',
                            gap: 2,
                          }}
                        >
                          {overflow.map((action) => (
                            <button
                              key={action}
                              type="button"
                              disabled={busy}
                              onClick={() => trigger(action, row)}
                              style={{
                                minHeight: 44,
                                border: 0,
                                borderRadius: 7,
                                background: 'transparent',
                                color: colorFor(action),
                                textAlign: 'left',
                                padding: '0 12px',
                                fontSize: 13,
                              }}
                            >
                              {ACTION_LABEL[action]}
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
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
              const isSelf = currentUserId === undefined || row.id === currentUserId;
              const busy = busyId === row.id;
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
                        {actionsFor(row).map((action) => (
                          <button
                            key={action}
                            type="button"
                            disabled={busy}
                            onClick={() => trigger(action, row)}
                            style={actionButton(colorFor(action), busy)}
                          >
                            {ACTION_LABEL[action]}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

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
