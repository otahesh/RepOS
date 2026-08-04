// frontend/src/components/settings/InviteUserModal.tsx
// Beta W9 — email + role → POST /api/admin/users/invite.
//
// The 409s this renders in plain English are all real, distinct API states
// (userLifecycle.ts): the cohort cap, an address that is already active, a
// suspended address that must be reinstated rather than re-invited, and one
// mid-deletion. Showing the raw code would make each of them look like a bug.
import { useId, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { TOKENS, FONTS } from '../../tokens';
import type { UserRole } from '../../lib/api/adminUsers';

interface Props {
  open: boolean;
  busy: boolean;
  /** Set by the page from the rejected invite; cleared on close. */
  error: string | null;
  onSubmit: (email: string, role: UserRole) => void;
  onCancel: () => void;
}

/** Plain-English copy for the 409s the invite path can return. */
export function inviteErrorMessage(err: unknown): string {
  const e = err as { status?: number; body?: { error?: string; count?: number; cap?: number } };
  const code = e?.body?.error;
  if (e?.status === 409) {
    switch (code) {
      case 'cohort_cap_reached':
        return `Cohort is full — ${e.body?.count ?? '?'} / ${e.body?.cap ?? '?'}. Suspend or delete someone first.`;
      case 'already_active':
        return 'That address is already an active user.';
      case 'suspended_use_reinstate':
        return 'That address is suspended. Reinstate them from the table instead of re-inviting.';
      case 'deletion_in_progress':
        return 'That address is being deleted. Wait for the deletion to finish.';
      case 'self_target_forbidden':
        return 'That is your own address. Manage yourself in Settings → Account.';
      default:
        return `Invite refused${code ? ` — ${code}` : ''}.`;
    }
  }
  if (e?.status === 502 && code === 'cf_sync_failed') {
    return 'Cloudflare rejected the access grant. The invitation was not sent; retry.';
  }
  if (e?.status === 400) return 'That does not look like a valid email address.';
  return `Invite failed${e?.status ? ` — HTTP ${e.status}` : ' (network)'}.`;
}

export function InviteUserModal({ open, busy, error, onSubmit, onCancel }: Props): JSX.Element | null {
  const emailId = useId();
  const roleId = useId();
  const titleId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');

  // The page keeps this component mounted and toggles `open`, so closing does
  // NOT discard the fields. Reset them on the closed→open transition instead
  // of on close: an in-modal API error (the 409 branch below) keeps `open`
  // true, so the address the admin typed survives the failure it caused.
  // Resetting only here also stops a retained `admin` role from being applied
  // to whatever address is typed next. Same render-phase pattern as
  // ConfirmDialog's typed-confirm reset.
  const wasOpen = useRef(open);
  if (open && !wasOpen.current) {
    if (email !== '') setEmail('');
    if (role !== 'member') setRole('member');
  }
  wasOpen.current = open;

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: TOKENS.surface2,
    border: `1px solid ${TOKENS.lineStrong}`,
    borderRadius: 6,
    color: TOKENS.text,
    fontFamily: FONTS.mono,
    fontSize: 13,
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontFamily: FONTS.mono,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: TOKENS.textMute,
    marginBottom: 6,
  };

  return (
    <FocusTrap
      focusTrapOptions={{
        escapeDeactivates: true,
        clickOutsideDeactivates: false,
        allowOutsideClick: true,
        onDeactivate: onCancel,
        returnFocusOnDeactivate: true,
        tabbableOptions: { displayCheck: 'none' },
        delayInitialFocus: false,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}
      >
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(email.trim(), role); }}
          style={{
            background: TOKENS.surface, border: `1px solid ${TOKENS.line}`, borderRadius: 12,
            padding: 24, width: '100%', maxWidth: 440, margin: '0 16px',
            color: TOKENS.text, fontFamily: FONTS.ui, boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
          }}
        >
          <h3 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Invite a user</h3>
          <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.5, color: TOKENS.textDim }}>
            They are added to the Cloudflare Access policy and emailed a sign-in link. They become
            active on first sign-in.
          </p>

          <div style={{ marginTop: 16 }}>
            <label htmlFor={emailId} style={labelStyle}>Email</label>
            <input
              id={emailId} type="email" value={email} autoComplete="off" spellCheck={false}
              onChange={(e) => setEmail(e.target.value)} style={inputStyle}
            />
          </div>

          <div style={{ marginTop: 14 }}>
            <label htmlFor={roleId} style={labelStyle}>Role</label>
            <select
              id={roleId} value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              style={inputStyle}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>

          {error && (
            <p style={{ margin: '14px 0 0', fontSize: 12, fontFamily: FONTS.mono, color: TOKENS.danger }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button
              type="button" onClick={onCancel}
              style={{
                padding: '8px 14px', background: 'transparent',
                border: `1px solid ${TOKENS.lineStrong}`, borderRadius: 6,
                color: TOKENS.text, fontFamily: FONTS.ui, fontSize: 13, cursor: 'pointer',
              }}
            >Cancel</button>
            <button
              type="submit" disabled={busy || email.trim() === ''}
              style={{
                padding: '8px 14px',
                background: busy || email.trim() === '' ? 'transparent' : TOKENS.accent,
                border: `1px solid ${busy || email.trim() === '' ? TOKENS.line : TOKENS.accent}`,
                borderRadius: 6,
                color: busy || email.trim() === '' ? TOKENS.textMute : '#fff',
                fontFamily: FONTS.ui, fontSize: 13, fontWeight: 600,
                cursor: busy || email.trim() === '' ? 'not-allowed' : 'pointer',
              }}
            >{busy ? 'Sending…' : 'Send invite'}</button>
          </div>
        </form>
      </div>
    </FocusTrap>
  );
}
